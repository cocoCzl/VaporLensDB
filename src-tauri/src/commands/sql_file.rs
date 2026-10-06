use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: u64 = 16 * 1024 * 1024;
#[derive(Default)]
pub struct SqlFileGrants(Mutex<HashMap<String, PathBuf>>);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlFileInput {
    action: String,
    token: Option<String>,
    suggested: Option<String>,
    text: Option<String>,
    fingerprint: Option<String>,
    bom: Option<bool>,
    eol: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlFileDocument {
    token: String,
    path: String,
    name: String,
    text: String,
    fingerprint: String,
    bom: bool,
    eol: String,
    conflict: bool,
}
fn bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("fileAccess".into()),
    };
    if !file.metadata().map_err(|_| "fileAccess")?.is_file() {
        return Err("fileAccess".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "fileAccess")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("tooLarge".into());
    }
    Ok(Some(bytes))
}
fn fingerprint(bytes: Option<&[u8]>) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hash);
    format!("{:016x}", hash.finish())
}
fn document(
    path: &Path,
    token: &str,
    data: Option<&[u8]>,
    decode: bool,
) -> Result<SqlFileDocument, String> {
    let bom = data.is_some_and(|bytes| bytes.starts_with(&[0xef, 0xbb, 0xbf]));
    let text = if decode {
        let raw = data.ok_or("missing")?;
        std::str::from_utf8(if bom { &raw[3..] } else { raw }).map_err(|_| "encoding")?
    } else {
        ""
    };
    Ok(SqlFileDocument {
        token: token.into(),
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .ok_or("fileAccess")?
            .to_string_lossy()
            .into_owned(),
        text: text.replace("\r\n", "\n"),
        fingerprint: fingerprint(data),
        bom,
        eol: if text.contains("\r\n") { "crlf" } else { "lf" }.into(),
        conflict: false,
    })
}
fn read_document(path: &Path, token: &str) -> Result<SqlFileDocument, String> {
    let data = bytes(path)?;
    document(path, token, data.as_deref(), true)
}
fn write_document(
    path: &Path,
    token: &str,
    text: &str,
    expected: &str,
    bom: bool,
    eol: &str,
) -> Result<SqlFileDocument, String> {
    let old = bytes(path)?;
    if fingerprint(old.as_deref()) != expected {
        let mut changed = document(path, token, old.as_deref(), false)?;
        changed.conflict = true;
        return Ok(changed);
    }
    let normalized = text.replace("\r\n", "\n");
    let encoded = if eol == "crlf" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };
    let mut data = if bom {
        vec![0xef, 0xbb, 0xbf]
    } else {
        Vec::new()
    };
    data.extend_from_slice(encoded.as_bytes());
    if data.len() as u64 > MAX_BYTES {
        return Err("tooLarge".into());
    }
    let temp = path
        .parent()
        .ok_or("fileAccess")?
        .join(format!(".vaporlens-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "fileAccess")?;
        if let Ok(metadata) = fs::metadata(path) {
            if metadata.permissions().readonly() {
                return Err("fileAccess".into());
            }
            file.set_permissions(metadata.permissions())
                .map_err(|_| "fileAccess")?;
        }
        file.write_all(&data).map_err(|_| "fileAccess")?;
        file.sync_all().map_err(|_| "fileAccess")?;
        drop(file);
        // Best-effort concurrent-edit guard, rechecked immediately before replacement.
        if fingerprint(bytes(path)?.as_deref()) != expected {
            return Err("changedDuringSave".into());
        }
        fs::rename(&temp, path).map_err(|_| "fileAccess")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    document(path, token, Some(&data), true)
}
fn selected_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("sql"))
    {
        return Err("extension".into());
    }
    if path.exists() {
        fs::canonicalize(path).map_err(|_| "fileAccess".into())
    } else {
        Ok(fs::canonicalize(path.parent().ok_or("fileAccess")?)
            .map_err(|_| "fileAccess")?
            .join(path.file_name().ok_or("fileAccess")?))
    }
}

/// No caller-supplied path is accepted for I/O. Only native dialog grants work.
#[tauri::command]
pub async fn sql_file(
    app: tauri::AppHandle,
    input: SqlFileInput,
) -> Result<Option<SqlFileDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if input.action == "open" || input.action == "select" {
            let mut dialog = app.dialog().file().add_filter("SQL", &["sql", "SQL"]);
            if let Some(suggested) = input.suggested.as_deref() {
                let path = Path::new(suggested);
                if let Some(name) = path.file_name() {
                    dialog = dialog.set_file_name(name.to_string_lossy());
                }
                if let Some(parent) = path.parent().filter(|parent| parent.is_absolute()) {
                    dialog = dialog.set_directory(parent);
                }
            }
            let chosen = if input.action == "open" {
                dialog.blocking_pick_file()
            } else {
                dialog.blocking_save_file()
            };
            let Some(chosen) = chosen else {
                return Ok(None);
            };
            let path = selected_path(chosen.into_path().map_err(|_| "fileAccess")?)?;
            let token = uuid::Uuid::new_v4().to_string();
            let data = bytes(&path)?;
            let doc = document(&path, &token, data.as_deref(), input.action == "open")?;
            app.state::<SqlFileGrants>()
                .0
                .lock()
                .map_err(|_| "fileAccess")?
                .insert(token, path);
            return Ok(Some(doc));
        }
        let grants = app.state::<SqlFileGrants>();
        let grants = grants.0.lock().map_err(|_| "fileAccess")?;
        let token = input.token.as_deref().ok_or("authorization")?;
        let path = grants.get(token).ok_or("authorization")?;
        // Refuse a path replaced with a symlink after selection; a fresh dialog can authorize it.
        if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err("authorization".into());
        }
        match input.action.as_str() {
            "read" => read_document(path, token).map(Some),
            "write" => write_document(
                path,
                token,
                input.text.as_deref().ok_or("fileAccess")?,
                input.fingerprint.as_deref().unwrap_or(""),
                input.bom.unwrap_or(false),
                input.eol.as_deref().unwrap_or("lf"),
            )
            .map(Some),
            _ => Err("fileAccess".into()),
        }
    })
    .await
    .map_err(|_| "fileAccess".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf8_bom_crlf_round_trip_and_invalid_encoding() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("query.sql");
        std::fs::write(&path, b"\xef\xbb\xbfSELECT 1;\r\n").unwrap();
        let doc = read_document(&path, "token").unwrap();
        assert_eq!(doc.text, "SELECT 1;\n");
        assert!(doc.bom);
        assert_eq!(doc.eol, "crlf");
        let saved = write_document(
            &path,
            "token",
            "SELECT 2;\n",
            &doc.fingerprint,
            true,
            "crlf",
        )
        .unwrap();
        assert!(!saved.conflict);
        assert_eq!(std::fs::read(&path).unwrap(), b"\xef\xbb\xbfSELECT 2;\r\n");
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_document(&path, "token").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn conflict_cancel_overwrite_delete_and_save_as_preserve_disk_contents() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let path = dir.join("source.sql");
        fs::write(&path, "original").unwrap();
        let doc = read_document(&path, "source").unwrap();
        fs::write(&path, "external").unwrap();
        let conflict =
            write_document(&path, "source", "local", &doc.fingerprint, false, "lf").unwrap();
        assert!(conflict.conflict);
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        let saved =
            write_document(&path, "source", "local", &conflict.fingerprint, false, "lf").unwrap();
        assert!(!saved.conflict);
        let other = dir.join("copy.SQL");
        let empty = fingerprint(None);
        assert!(
            !write_document(&other, "copy", "copy", &empty, false, "lf")
                .unwrap()
                .conflict
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "local");
        assert_eq!(fs::read_to_string(&other).unwrap(), "copy");
        fs::remove_file(&path).unwrap();
        let missing =
            write_document(&path, "source", "local", &saved.fingerprint, false, "lf").unwrap();
        assert!(missing.conflict);
        assert!(!path.exists());
        assert!(read_document(&path, "source").is_err());
        assert!(
            !write_document(
                &path,
                "source",
                "recreated",
                &missing.fingerprint,
                false,
                "lf"
            )
            .unwrap()
            .conflict
        );
        assert!(selected_path(dir.join("wrong.txt")).is_err());
        assert_eq!(
            selected_path(other.clone()).unwrap(),
            fs::canonicalize(&other).unwrap()
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_replacement_keeps_target_and_removes_temporary_file() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let path = dir.join("readonly.sql");
        fs::write(&path, "untouched").unwrap();
        let doc = read_document(&path, "token").unwrap();
        let original = fs::metadata(&path).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&path, readonly).unwrap();
        assert!(
            write_document(&path, "token", "replacement", &doc.fingerprint, false, "lf").is_err()
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "untouched");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::set_permissions(&path, original).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn oversized_files_are_rejected_without_unbounded_read_or_replacement() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let path = dir.join("large.sql");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert_eq!(read_document(&path, "token").unwrap_err(), "tooLarge");
        assert!(write_document(&path, "token", "small", "old", false, "lf").is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), MAX_BYTES + 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
