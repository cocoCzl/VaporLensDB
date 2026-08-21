use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::io::Write;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;
#[cfg(target_os = "linux")]
use std::process::Stdio;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::models::error::AppError;

const KEY_FILE: &str = "dev-secret.key";
#[cfg(target_os = "windows")]
const WINDOWS_KEY_FILE: &str = "os-secret.key";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "com.vaporlensdb.encryption-key";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "VaporLensDB";

pub fn key_backend_label() -> &'static str {
    if use_dev_key() {
        return "local development key file";
    }
    #[cfg(target_os = "macos")]
    {
        "macOS Keychain"
    }
    #[cfg(target_os = "windows")]
    {
        "Windows DPAPI"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux Secret Service"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unsupported platform credential store"
    }
}

pub fn encrypt_password(config_dir: &Path, plaintext: &str) -> Result<String, AppError> {
    let cipher = cipher(config_dir)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|error| AppError::AuthError(format!("encrypt password failed: {error}")))?;

    Ok(format!(
        "{}:{}",
        STANDARD.encode(nonce.as_slice()),
        STANDARD.encode(ciphertext)
    ))
}

pub fn decrypt_password(config_dir: &Path, encrypted: &str) -> Result<String, AppError> {
    let (nonce, ciphertext) = encrypted
        .split_once(':')
        .ok_or_else(|| AppError::AuthError("invalid encrypted password payload".to_string()))?;
    let nonce = STANDARD
        .decode(nonce)
        .map_err(|error| AppError::AuthError(format!("decode password nonce failed: {error}")))?;
    let ciphertext = STANDARD.decode(ciphertext).map_err(|error| {
        AppError::AuthError(format!("decode encrypted password failed: {error}"))
    })?;

    let cipher = cipher(config_dir)?;
    let plaintext = cipher
        .decrypt(nonce.as_slice().into(), ciphertext.as_ref())
        .map_err(|error| AppError::AuthError(format!("decrypt password failed: {error}")))?;

    String::from_utf8(plaintext)
        .map_err(|error| AppError::AuthError(format!("password is not valid UTF-8: {error}")))
}

fn cipher(config_dir: &Path) -> Result<Aes256Gcm, AppError> {
    let key = load_or_create_key(config_dir)?;
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)))
}

fn load_or_create_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    if use_dev_key() {
        return load_or_create_dev_key(config_dir);
    }
    #[cfg(target_os = "macos")]
    {
        load_or_create_macos_keychain_key(config_dir)
    }
    #[cfg(target_os = "windows")]
    {
        load_or_create_windows_key(config_dir)
    }
    #[cfg(target_os = "linux")]
    {
        load_or_create_linux_secret_service_key(config_dir)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(AppError::AuthError(
            "no production credential store is available on this platform".to_string(),
        ))
    }
}

fn use_dev_key() -> bool {
    std::env::var("VAPORLENSDB_USE_DEV_KEY").as_deref() == Ok("1")
}

#[cfg(target_os = "macos")]
fn load_or_create_macos_keychain_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    match read_macos_keychain_secret()? {
        Some(secret) => decode_key(&secret, "macOS Keychain"),
        None => {
            let key = migrated_or_new_key(config_dir)?;
            let encoded = STANDARD.encode(key);
            write_macos_keychain_secret(&encoded)?;
            remove_legacy_dev_key(config_dir)?;
            Ok(key)
        }
    }
}

#[cfg(target_os = "macos")]
fn read_macos_keychain_secret() -> Result<Option<String>, AppError> {
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ])
        .output()?;

    if output.status.success() {
        let secret = String::from_utf8(output.stdout).map_err(|error| {
            AppError::AuthError(format!("macOS Keychain value is not valid UTF-8: {error}"))
        })?;
        return Ok(Some(secret.trim().to_string()));
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
fn write_macos_keychain_secret(secret: &str) -> Result<(), AppError> {
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
            secret,
            "-U",
        ])
        .output()?;

    if output.status.success() {
        Ok(())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(AppError::AuthError(format!(
            "write macOS Keychain secret failed: {message}"
        )))
    }
}

#[cfg(target_os = "linux")]
fn load_or_create_linux_secret_service_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    if let Some(secret) = read_linux_secret_service_secret()? {
        return decode_key(&secret, "Linux Secret Service");
    }
    let key = migrated_or_new_key(config_dir)?;
    write_linux_secret_service_secret(&STANDARD.encode(key))?;
    remove_legacy_dev_key(config_dir)?;
    Ok(key)
}

#[cfg(target_os = "linux")]
fn read_linux_secret_service_secret() -> Result<Option<String>, AppError> {
    let output = Command::new("secret-tool")
        .args([
            "lookup",
            "service",
            "com.vaporlensdb.encryption-key",
            "account",
            "VaporLensDB",
        ])
        .output()
        .map_err(|error| {
            AppError::AuthError(format!(
                "Linux password storage requires secret-tool and an active Secret Service session (install libsecret-tools on Debian/Ubuntu): {error}"
            ))
        })?;
    if output.status.success() {
        let secret = String::from_utf8(output.stdout).map_err(|error| {
            AppError::AuthError(format!("Secret Service value is not UTF-8: {error}"))
        })?;
        return Ok((!secret.trim().is_empty()).then(|| secret.trim().to_string()));
    }
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    Err(AppError::AuthError(format!(
        "read Linux Secret Service failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

#[cfg(target_os = "linux")]
fn write_linux_secret_service_secret(secret: &str) -> Result<(), AppError> {
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label=VaporLensDB encryption key",
            "service",
            "com.vaporlensdb.encryption-key",
            "account",
            "VaporLensDB",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::AuthError(format!(
                "Linux password storage requires secret-tool and an active Secret Service session (install libsecret-tools on Debian/Ubuntu): {error}"
            ))
        })?;
    child
        .stdin
        .take()
        .ok_or_else(|| AppError::AuthError("open secret-tool stdin failed".to_string()))?
        .write_all(secret.as_bytes())?;
    let output = child.wait_with_output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::AuthError(format!(
            "write Linux Secret Service failed; verify that the desktop Secret Service session is active: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}

#[cfg(target_os = "windows")]
fn load_or_create_windows_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    let path = config_dir.join(WINDOWS_KEY_FILE);
    if path.exists() {
        return windows_unprotect_key(&fs::read(path)?);
    }
    fs::create_dir_all(config_dir)?;
    let key = migrated_or_new_key(config_dir)?;
    fs::write(&path, windows_protect_key(&key)?)?;
    remove_legacy_dev_key(config_dir)?;
    Ok(key)
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct DpapiOutputBlob(windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB);

#[cfg(target_os = "windows")]
impl DpapiOutputBlob {
    fn as_mut_ptr(
        &mut self,
    ) -> *mut windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
        &mut self.0
    }

    fn to_vec(&self) -> Result<Vec<u8>, AppError> {
        if self.0.cbData == 0 {
            return Ok(Vec::new());
        }
        if self.0.pbData.is_null() {
            return Err(AppError::AuthError(
                "Windows DPAPI returned an invalid output buffer".to_string(),
            ));
        }

        // SAFETY: DPAPI returned a non-null buffer containing exactly cbData bytes.
        // The buffer remains owned by this wrapper until Drop calls LocalFree.
        Ok(unsafe { std::slice::from_raw_parts(self.0.pbData, self.0.cbData as usize).to_vec() })
    }
}

#[cfg(target_os = "windows")]
impl Drop for DpapiOutputBlob {
    fn drop(&mut self) {
        if self.0.pbData.is_null() {
            return;
        }
        // SAFETY: CryptProtectData/CryptUnprotectData allocate pbData with LocalAlloc,
        // and this wrapper is the sole owner responsible for releasing it once.
        unsafe {
            windows_sys::Win32::Foundation::LocalFree(self.0.pbData.cast());
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_protect_key(key: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: key.len() as u32,
        pbData: key.as_ptr() as *mut u8,
    };
    let mut output = DpapiOutputBlob::default();
    // SAFETY: input references the 32-byte key for the duration of the call;
    // all optional pointers are null as allowed by CryptProtectData, and output
    // points to writable storage owned by DpapiOutputBlob.
    let success = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            output.as_mut_ptr(),
        )
    };
    if success == 0 {
        return Err(AppError::AuthError(format!(
            "Windows DPAPI encryption failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    output.to_vec()
}

#[cfg(target_os = "windows")]
fn windows_unprotect_key(encrypted: &[u8]) -> Result<[u8; 32], AppError> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = DpapiOutputBlob::default();
    // SAFETY: input references the encrypted slice for the duration of the call;
    // all optional pointers are null as allowed by CryptUnprotectData, and output
    // points to writable storage owned by DpapiOutputBlob.
    let success = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            output.as_mut_ptr(),
        )
    };
    if success == 0 {
        return Err(AppError::AuthError(format!(
            "Windows DPAPI decryption failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    output
        .to_vec()?
        .try_into()
        .map_err(|_| AppError::AuthError("Windows DPAPI key must be 32 bytes".to_string()))
}

fn load_or_create_dev_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    fs::create_dir_all(config_dir)?;
    let path = key_path(config_dir);

    if path.exists() {
        let encoded = fs::read_to_string(&path)?;
        return decode_key(encoded.trim(), "development key");
    }

    let key = Aes256Gcm::generate_key(&mut OsRng);
    write_dev_key(&path, &STANDARD.encode(key.as_slice()))?;

    let mut key_bytes = [0_u8; 32];
    key_bytes.copy_from_slice(key.as_slice());
    Ok(key_bytes)
}

fn migrated_or_new_key(config_dir: &Path) -> Result<[u8; 32], AppError> {
    let legacy = key_path(config_dir);
    if legacy.exists() {
        return decode_key(fs::read_to_string(legacy)?.trim(), "legacy development key");
    }
    let key = Aes256Gcm::generate_key(&mut OsRng);
    let mut bytes = [0_u8; 32];
    bytes.copy_from_slice(key.as_slice());
    Ok(bytes)
}

fn remove_legacy_dev_key(config_dir: &Path) -> Result<(), AppError> {
    let path = key_path(config_dir);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn write_dev_key(path: &Path, encoded: &str) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt};
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(encoded.as_bytes())?;
        Ok(())
    }
    #[cfg(not(unix))]
    fs::write(path, encoded).map_err(AppError::from)
}

fn key_path(config_dir: &Path) -> PathBuf {
    config_dir.join(KEY_FILE)
}

fn decode_key(encoded: &str, source: &str) -> Result<[u8; 32], AppError> {
    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|error| AppError::AuthError(format!("decode {source} failed: {error}")))?;

    bytes
        .try_into()
        .map_err(|_| AppError::AuthError(format!("{source} must be 32 bytes")))
}

#[cfg(test)]
mod tests {
    use std::fs;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use super::{decrypt_password, encrypt_password, key_path};

    #[test]
    fn encrypts_and_decrypts_password() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir =
            std::env::temp_dir().join(format!("vaporlensdb-crypto-test-{}", uuid::Uuid::new_v4()));

        let encrypted = encrypt_password(&dir, "postgres123").expect("encrypt password");
        assert!(!encrypted.contains("postgres123"));

        let decrypted = decrypt_password(&dir, &encrypted).expect("decrypt password");
        assert_eq!(decrypted, "postgres123");

        fs::remove_dir_all(dir).expect("remove crypto test directory");
    }

    #[cfg(unix)]
    #[test]
    fn development_key_file_is_owner_only() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let dir = std::env::temp_dir().join(format!(
            "vaporlensdb-key-permissions-test-{}",
            uuid::Uuid::new_v4()
        ));

        encrypt_password(&dir, "secret").expect("create development key");

        let mode = fs::metadata(key_path(&dir))
            .expect("read development key metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);

        fs::remove_dir_all(dir).expect("remove key permission test directory");
    }
}
