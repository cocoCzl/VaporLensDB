use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

use crate::{
    models::{
        connection::{ConnectionConfig, DriverType},
        driver_catalog::{
            DatabaseProduct, DriverArtifact, DriverBackend, DriverDefinition, DriverInstallation,
            InstallationSource,
        },
    },
    services::external_driver::validate_jdbc_driver_class,
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
    pub label: Option<String>,
}

#[tauri::command]
pub fn import_jdbc_driver_artifacts(
    state: State<'_, AppState>,
    input: ImportJdbcDriverArtifactsInput,
) -> Result<DriverDefinition, String> {
    import_artifacts(&state.config_store, input)
}

fn import_artifacts(
    store: &crate::services::config_store::ConfigStore,
    input: ImportJdbcDriverArtifactsInput,
) -> Result<DriverDefinition, String> {
    import_artifacts_with(store, input, |source, target| fs::copy(source, target))
}

fn import_artifacts_with(
    store: &crate::services::config_store::ConfigStore,
    input: ImportJdbcDriverArtifactsInput,
    mut copy: impl FnMut(&Path, &Path) -> std::io::Result<u64>,
) -> Result<DriverDefinition, String> {
    let definition = store
        .get_driver_definition(&input.driver_definition_id)
        .map_err(String::from)?
        .ok_or_else(|| {
            format!(
                "driver definition not found: {}",
                input.driver_definition_id
            )
        })?;
    ensure_managed_jdbc_artifacts_supported(&definition)?;

    if input.paths.is_empty() {
        return Err("at least one JDBC driver jar path is required".to_string());
    }

    let installation_id = format!("installation-{}", uuid::Uuid::new_v4());
    let target_dir = store
        .config_dir()
        .join("driver-artifacts")
        .join(&installation_id);
    // Validate the complete selection before copying. Never merge old main versions.
    for source in &input.paths {
        validate_jar_path(Path::new(source))?;
    }
    let staged_dir = target_dir.with_file_name(format!(".import-{installation_id}"));
    fs::create_dir_all(&staged_dir).map_err(|e| e.to_string())?;
    let prepared = (|| {
        let mut artifacts = Vec::new();
        for (index, source) in input.paths.iter().enumerate() {
            let source = Path::new(source);
            let file_name = source
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or("Invalid JAR file name")?;
            let target = staged_dir.join(format!("{index}-{file_name}"));
            copy(source, &target).map_err(|e| e.to_string())?;
            let path = target.to_string_lossy().into_owned();
            artifacts.push(DriverArtifact {
                sha256: Some(
                    crate::services::driver_registry::artifact_hash(&path).map_err(String::from)?,
                ),
                path: target_dir
                    .join(format!("{index}-{file_name}"))
                    .to_string_lossy()
                    .into_owned(),
                role: if index == 0 { "primary" } else { "dependency" }.into(),
            });
        }
        let version = artifacts
            .first()
            .and_then(|a| Path::new(&a.path).file_name())
            .and_then(|file| {
                crate::services::driver_download::local_version(&staged_dir.join(file))
            });
        let installation = DriverInstallation {
            version: version.clone(),
            source: Some(InstallationSource {
                kind: "localImport".into(),
                urls: vec![],
                checksum_sources: vec!["Local file fingerprint; publisher unverified".into()],
                license: None,
            }),
            id: installation_id,
            driver_definition_id: definition.id.clone(),
            label: input
                .label
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| {
                    version
                        .map(|v| format!("Local JAR {v}"))
                        .unwrap_or_else(|| "Imported dependency set (version unverified)".into())
                }),
            artifacts,
            java_requirement: "Java 21+ (bridge); driver requirements unverified".into(),
            validation: None,
        };
        crate::services::driver_download::publish_staged(
            store,
            &staged_dir,
            &target_dir,
            &installation,
        )
    })();
    if let Err(error) = prepared {
        let _ = fs::remove_dir_all(&staged_dir);
        return Err(error);
    }
    store
        .get_driver_definition(&definition.id)
        .map_err(String::from)?
        .ok_or_else(|| "Driver definition missing".into())
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
    ensure_managed_jdbc_artifacts_supported(&definition)?;

    state
        .config_store
        .ensure_artifact_unreferenced(&input.path)
        .map_err(String::from)?;
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
        .update_driver_definition_artifacts(
            &definition.id,
            definition.driver_artifacts,
            definition.driver_artifact,
        )
        .map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateExternalDriverInput {
    pub installation_id: Option<String>,
    pub driver_type: DriverType,
    pub connection_url: Option<String>,
    pub driver_class: Option<String>,
    pub driver_paths: Option<Vec<String>>,
}

fn ensure_managed_jdbc_artifacts_supported(definition: &DriverDefinition) -> Result<(), String> {
    if matches!(definition.backend, DriverBackend::Jdbc) {
        return Ok(());
    }
    Err("managed JDBC artifacts are supported only for JDBC driver definitions".to_string())
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
    state: State<'_, AppState>,
    input: ValidateExternalDriverInput,
) -> Result<ExternalDriverValidation, String> {
    let installation = input
        .installation_id
        .as_ref()
        .map(|id| {
            state
                .config_store
                .list_driver_installations()
                .map_err(String::from)?
                .into_iter()
                .find(|i| &i.id == id)
                .ok_or_else(|| "Selected installation is missing".to_string())
        })
        .transpose()?;
    let definition = installation
        .as_ref()
        .map(|i| {
            state
                .config_store
                .get_driver_definition(&i.driver_definition_id)
                .map_err(String::from)?
                .ok_or_else(|| "Selected driver definition is missing".to_string())
        })
        .transpose()?;
    let config = ConnectionConfig {
        id: uuid::Uuid::new_v4(),
        name: "external driver validation".to_string(),
        driver_definition_id: None,
        product_id: None,
        driver_installation_id: None,
        connection_mode: None,
        driver_properties: Vec::new(),
        driver_type: input.driver_type,
        driver_dialect: None,
        host: None,
        port: None,
        database: None,
        connection_url: input.connection_url,
        username: None,
        password_encrypted: None,
        has_saved_password: false,
        driver_class: definition
            .as_ref()
            .and_then(|d| d.jdbc_driver_class.clone())
            .or(input.driver_class),
        driver_paths: installation
            .as_ref()
            .map(|i| i.artifacts.iter().map(|a| a.path.clone()).collect())
            .unwrap_or_else(|| input.driver_paths.unwrap_or_default()),
        ssl_mode: None,
        group_id: None,
        group: None,
        color_tag: None,
        ssh_tunnel: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let fingerprint = crate::services::external_driver::installation_runtime_fingerprint(&config)
        .await
        .map_err(String::from)?;
    let result = validate_jdbc_driver_class(&config).await;
    if let Some(mut installation) = installation {
        installation.validation = Some(crate::models::driver_catalog::InstallationValidation {
            fingerprint,
            checked_at: chrono::Utc::now().to_rfc3339(),
            class_loaded: result.is_ok(),
        });
        state
            .config_store
            .record_installation_validation(&installation)
            .map_err(String::from)?;
    }

    match result {
        Ok(()) => Ok(ExternalDriverValidation {
            valid: true,
            message: "Driver class loaded; database connectivity has not been tested".to_string(),
        }),
        Err(error) => Err(String::from(error)),
    }
}

#[tauri::command]
pub fn list_database_products(state: State<'_, AppState>) -> Result<Vec<DatabaseProduct>, String> {
    state
        .config_store
        .list_database_products()
        .map_err(Into::into)
}
#[tauri::command]
pub fn save_database_product(
    state: State<'_, AppState>,
    input: DatabaseProduct,
) -> Result<DatabaseProduct, String> {
    state
        .config_store
        .save_database_product(input)
        .map_err(Into::into)
}
#[tauri::command]
pub fn list_driver_installations(
    state: State<'_, AppState>,
) -> Result<Vec<DriverInstallation>, String> {
    state
        .config_store
        .list_driver_installations()
        .map_err(Into::into)
}
#[tauri::command]
pub fn delete_driver_installation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .config_store
        .delete_driver_installation(&id)
        .map_err(Into::into)
}

#[cfg(test)]
mod installation_tests {
    use super::*;
    #[test]
    fn multi_file_failure_does_not_publish_half_installation_or_replace_previous() {
        let store = crate::services::config_store::ConfigStore::new(
            std::env::temp_dir().join(format!("vapor-import-install-{}", uuid::Uuid::new_v4())),
        )
        .unwrap();
        let source = store.config_dir().join("primary.jar");
        std::fs::write(&source, b"jar fixture").unwrap();
        let first = import_artifacts(
            &store,
            ImportJdbcDriverArtifactsInput {
                driver_definition_id: "jdbc-postgresql".into(),
                paths: vec![source.to_string_lossy().into_owned()],
                label: Some("Original".into()),
            },
        )
        .unwrap();
        let installs = store.list_driver_installations().unwrap().len();
        let dependency = store.config_dir().join("dependency.jar");
        std::fs::write(&dependency, b"dependency fixture").unwrap();
        let mut copied = 0;
        let failed = import_artifacts_with(
            &store,
            ImportJdbcDriverArtifactsInput {
                driver_definition_id: first.id.clone(),
                paths: vec![
                    source.to_string_lossy().into_owned(),
                    dependency.to_string_lossy().into_owned(),
                ],
                label: Some("Broken".into()),
            },
            |source, target| {
                copied += 1;
                if copied == 2 {
                    return Err(std::io::Error::other("injected second-copy I/O failure"));
                }
                fs::copy(source, target)
            },
        );
        assert_eq!(copied, 2);
        assert!(failed.is_err());
        assert_eq!(store.list_driver_installations().unwrap().len(), installs);
        assert_eq!(
            store
                .get_driver_definition(&first.id)
                .unwrap()
                .unwrap()
                .default_installation_id,
            first.default_installation_id
        );
        assert_eq!(
            std::fs::read_dir(store.config_dir().join("driver-artifacts"))
                .unwrap()
                .count(),
            1
        );
    }
}

#[tauri::command]
pub fn export_driver_configuration(
    state: State<'_, AppState>,
) -> Result<crate::services::driver_config::DriverConfigurationBundle, String> {
    state
        .config_store
        .export_driver_configuration()
        .map_err(Into::into)
}
#[tauri::command]
pub fn import_driver_configuration(
    state: State<'_, AppState>,
    input: crate::services::driver_config::DriverConfigurationBundle,
) -> Result<usize, String> {
    state
        .config_store
        .import_driver_configuration(input)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_jdbc_downloads() -> Vec<crate::services::driver_download::DownloadRecipe> {
    crate::services::driver_download::recipes()
}

#[tauri::command]
pub async fn download_jdbc_driver(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    driver_definition_id: String,
) -> Result<crate::services::task_manager::TaskInfo, String> {
    use crate::services::{driver_download, task_manager::TaskStatus};
    let definition = state
        .config_store
        .get_driver_definition(&driver_definition_id)
        .map_err(String::from)?
        .ok_or("Driver definition missing")?;
    ensure_managed_jdbc_artifacts_supported(&definition)?;
    if !definition.built_in {
        return Err("Custom products use local JAR import".into());
    }
    let recipe = driver_download::recipes()
        .into_iter()
        .find(|r| r.driver_definition_id == definition.id)
        .ok_or("No reviewed download for this driver; use official website and local import")?;
    driver_download::validate_recipe(&recipe)?;
    let client = driver_download::client()?;
    let manager = state.task_manager.clone();
    let store = state.config_store.clone();
    let task = manager
        .create_task(
            &format!("driver.download:{}", definition.id),
            &format!("{} {}", definition.name, recipe.version),
            Some(recipe.files.iter().map(|f| f.size).sum()),
        )
        .await;
    let id = task.id;
    tauri::async_runtime::spawn(async move {
        let result =
            driver_download::download(store, manager.clone(), id, recipe, client, |info| {
                crate::commands::task::emit_task_update(&app, info)
            })
            .await;
        let finished = match result {
            Ok(()) => manager.finish_success(id, "Files installed; Java, class loading and database connectivity require separate checks").await,
            Err(error) => {
                if manager.handle(id).await.is_ok_and(|h|h.is_cancel_requested()) {
                    manager.finish_cancelled(id, "Download cancelled; no installation published").await
                } else { manager.finish_failed(id, error).await }
            }
        };
        if let Ok(info) = finished {
            debug_assert!(matches!(
                info.status,
                TaskStatus::Succeeded | TaskStatus::Cancelled | TaskStatus::Failed
            ));
            crate::commands::task::emit_task_update(&app, &info);
        }
    });
    Ok(task)
}

#[tauri::command]
pub async fn check_jdbc_runtime() -> Result<(), String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        crate::services::external_driver::validate_java_runtime(),
    )
    .await
    .map_err(|_| "Java runtime check timed out".to_string())?
    .map_err(String::from)
}
