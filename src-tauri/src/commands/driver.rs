use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

use crate::{
    models::{
        connection::{ConnectionConfig, DriverType},
        driver_catalog::DriverDefinition,
        error::AppError,
    },
    services::external_driver::validate_jdbc_prerequisites,
    AppState,
};

#[tauri::command]
pub fn list_driver_definitions(
    state: State<'_, AppState>,
) -> Result<Vec<DriverDefinition>, String> {
    state
        .config_store
        .list_driver_definitions()
        .map_err(Into::into)
}

#[tauri::command]
pub fn save_custom_driver_definition(
    state: State<'_, AppState>,
    input: DriverDefinition,
) -> Result<DriverDefinition, String> {
    state
        .config_store
        .save_custom_driver_definition(input)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_custom_driver_definition(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state
        .config_store
        .delete_custom_driver_definition(&id)
        .map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJdbcDriverArtifactsInput {
    pub driver_definition_id: String,
    pub paths: Vec<String>,
}

#[tauri::command]
pub fn import_jdbc_driver_artifacts(
    state: State<'_, AppState>,
    input: ImportJdbcDriverArtifactsInput,
) -> Result<DriverDefinition, String> {
    let mut definition = state
        .config_store
        .get_driver_definition(&input.driver_definition_id)
        .map_err(String::from)?
        .ok_or_else(|| {
            format!(
                "driver definition not found: {}",
                input.driver_definition_id
            )
        })?;
    ensure_custom_jdbc_definition(&definition)?;

    if input.paths.is_empty() {
        return Err("at least one JDBC driver jar path is required".to_string());
    }

    let target_dir = state
        .config_store
        .config_dir()
        .join("driver-artifacts")
        .join(safe_path_segment(&definition.id));
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;

    let mut artifacts = definition
        .driver_artifacts
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    for source in input.paths {
        let source = PathBuf::from(source);
        validate_jar_path(&source)?;
        let file_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("invalid JDBC driver file name: {}", source.display()))?;
        let target = unique_target_path(&target_dir, file_name);
        fs::copy(&source, &target).map_err(|error| {
            format!(
                "failed to copy JDBC driver jar from {} to {}: {error}",
                source.display(),
                target.display()
            )
        })?;
        artifacts.insert(target.display().to_string());
    }

    definition.driver_artifacts = artifacts.into_iter().collect();
    definition.driver_artifact = Some(
        definition
            .driver_artifacts
            .iter()
            .map(|path| display_file_name(path))
            .collect::<Vec<_>>()
            .join(", "),
    );
    state
        .config_store
        .save_custom_driver_definition(definition)
        .map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveJdbcDriverArtifactInput {
    pub driver_definition_id: String,
    pub path: String,
}

#[tauri::command]
pub fn remove_jdbc_driver_artifact(
    state: State<'_, AppState>,
    input: RemoveJdbcDriverArtifactInput,
) -> Result<DriverDefinition, String> {
    let mut definition = state
        .config_store
        .get_driver_definition(&input.driver_definition_id)
        .map_err(String::from)?
        .ok_or_else(|| {
            format!(
                "driver definition not found: {}",
                input.driver_definition_id
            )
        })?;
    ensure_custom_jdbc_definition(&definition)?;

    definition
        .driver_artifacts
        .retain(|path| path != &input.path);
    let path = PathBuf::from(&input.path);
    if is_managed_artifact_path(state.config_store.config_dir(), &path) && path.is_file() {
        fs::remove_file(&path).map_err(|error| {
            format!(
                "failed to remove managed JDBC driver jar {}: {error}",
                path.display()
            )
        })?;
    }
    definition.driver_artifact = if definition.driver_artifacts.is_empty() {
        Some("*.jar".to_string())
    } else {
        Some(
            definition
                .driver_artifacts
                .iter()
                .map(|path| display_file_name(path))
                .collect::<Vec<_>>()
                .join(", "),
        )
    };

    state
        .config_store
        .save_custom_driver_definition(definition)
        .map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateExternalDriverInput {
    pub driver_type: DriverType,
    pub connection_url: Option<String>,
    pub driver_class: Option<String>,
    pub driver_paths: Option<Vec<String>>,
}

fn ensure_custom_jdbc_definition(definition: &DriverDefinition) -> Result<(), String> {
    if definition.built_in || definition.driver_type != DriverType::Jdbc {
        return Err(
            "managed JDBC artifacts are supported only for custom JDBC driver definitions"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_jar_path(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!(
            "JDBC driver file does not exist: {}",
            path.display()
        ));
    }
    if path.extension().and_then(|value| value.to_str()) != Some("jar") {
        return Err(format!(
            "JDBC driver file must be a .jar: {}",
            path.display()
        ));
    }
    Ok(())
}

fn unique_target_path(dir: &Path, file_name: &str) -> PathBuf {
    let initial = dir.join(file_name);
    if !initial.exists() {
        return initial;
    }

    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("driver");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jar");
    for index in 1.. {
        let candidate = dir.join(format!("{stem}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("unique target path loop must return")
}

fn safe_path_segment(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn display_file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn is_managed_artifact_path(config_dir: &Path, path: &Path) -> bool {
    let managed_root = config_dir.join("driver-artifacts");
    path.starts_with(managed_root)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDriverValidation {
    pub valid: bool,
    pub message: String,
}

#[tauri::command]
pub async fn validate_external_driver(
    input: ValidateExternalDriverInput,
) -> Result<ExternalDriverValidation, String> {
    let config = ConnectionConfig {
        id: uuid::Uuid::new_v4(),
        name: "external driver validation".to_string(),
        driver_definition_id: None,
        driver_type: input.driver_type,
        host: None,
        port: None,
        database: None,
        connection_url: input.connection_url,
        username: None,
        password_encrypted: None,
        driver_class: input.driver_class,
        driver_paths: input.driver_paths.unwrap_or_default(),
        ssl_mode: None,
        group: None,
        color_tag: None,
        ssh_tunnel: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let result = match config.driver_type {
        DriverType::Oracle | DriverType::Jdbc => validate_jdbc_prerequisites(&config).await,
        _ => Err(AppError::UnsupportedOperation {
            driver: config.driver_type.to_string(),
            operation: "external driver validation".to_string(),
        }),
    };

    match result {
        Ok(()) => Ok(ExternalDriverValidation {
            valid: true,
            message: "external driver configuration is valid".to_string(),
        }),
        Err(error) => Err(String::from(error)),
    }
}
