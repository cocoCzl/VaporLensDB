use chrono::Utc;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::{
    models::connection::{ConnectionConfig, ConnectionStatus, DriverType},
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<Uuid>,
    pub name: String,
    pub driver_type: DriverType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub connection_url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub driver_class: Option<String>,
    pub driver_paths: Option<Vec<String>>,
    pub ssl_mode: Option<String>,
    pub group: Option<String>,
    pub color_tag: Option<String>,
}

#[tauri::command]
pub fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    let password = input.password.clone();
    let config = input_to_config(input, Uuid::new_v4());
    state
        .config_store
        .create_connection(config, password)
        .map_err(Into::into)
}

#[tauri::command]
pub fn update_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    let id = input
        .id
        .ok_or_else(|| "connection id is required".to_string())?;
    let password = input.password.clone();
    let config = input_to_config(input, id);
    state
        .config_store
        .update_connection(config, password)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: Uuid) -> Result<(), String> {
    state.connection_manager.lock().await.disconnect(id).ok();
    state.metadata_service.clear_connection(id).await;
    state.config_store.delete_connection(id).map_err(Into::into)
}

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionConfig>, String> {
    state.config_store.list_connections().map_err(Into::into)
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<(), String> {
    let password = input.password.clone();
    let config = input_to_config(input, Uuid::new_v4());
    state
        .connection_manager
        .lock()
        .await
        .test_connection(&config, password.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn connect(state: State<'_, AppState>, id: Uuid) -> Result<ConnectionStatus, String> {
    let config = state
        .config_store
        .get_connection(id)
        .map_err(String::from)?
        .ok_or_else(|| format!("connection not found: {id}"))?;
    let password = state
        .config_store
        .decrypt_password(&config)
        .map_err(String::from)?;

    state.metadata_service.clear_connection(id).await;

    state
        .connection_manager
        .lock()
        .await
        .connect(&config, password.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, id: Uuid) -> Result<ConnectionStatus, String> {
    let status = state
        .connection_manager
        .lock()
        .await
        .disconnect(id)
        .map_err(String::from)?;
    state.metadata_service.clear_connection(id).await;
    Ok(status)
}

#[tauri::command]
pub async fn connection_status(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<ConnectionStatus, String> {
    Ok(state.connection_manager.lock().await.status(id))
}

#[tauri::command]
pub async fn list_connection_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionStatus>, String> {
    Ok(state.connection_manager.lock().await.statuses())
}

fn input_to_config(input: ConnectionInput, id: Uuid) -> ConnectionConfig {
    let now = Utc::now();
    ConnectionConfig {
        id,
        name: input.name,
        driver_type: input.driver_type,
        host: input.host,
        port: input.port,
        database: input.database,
        connection_url: input.connection_url,
        username: input.username,
        password_encrypted: None,
        driver_class: input.driver_class,
        driver_paths: input.driver_paths.unwrap_or_default(),
        ssl_mode: input.ssl_mode,
        group: input.group,
        color_tag: input.color_tag,
        created_at: now,
        updated_at: now,
    }
}
