use serde::Serialize;
use tauri::State;

use crate::{utils::crypto, AppState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResponse {
    pub status: &'static str,
    pub app: &'static str,
    pub version: &'static str,
    pub config_path: String,
    pub config_schema_version: i64,
    pub password_storage: &'static str,
    pub key_backend: &'static str,
}

#[tauri::command]
pub fn health_check(state: State<'_, AppState>) -> Result<HealthCheckResponse, String> {
    let config_schema_version = state
        .config_store
        .applied_schema_version()
        .map_err(String::from)?;

    Ok(HealthCheckResponse {
        status: "ok",
        app: "VaporLensDB",
        version: env!("CARGO_PKG_VERSION"),
        config_path: state.config_store.db_path().to_string_lossy().to_string(),
        config_schema_version,
        password_storage: "AES-GCM encrypted at rest",
        key_backend: crypto::key_backend_label(),
    })
}
