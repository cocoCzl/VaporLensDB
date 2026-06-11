use chrono::Utc;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::{
    models::connection::{
        ConnectionConfig, ConnectionStatus, DriverType, SshAuthMethod, SshTunnelConfig,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<Uuid>,
    pub name: String,
    pub driver_definition_id: Option<String>,
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
    pub ssh_tunnel: Option<SshTunnelInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelInput {
    pub enabled: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub auth_method: Option<SshAuthMethod>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub local_host: Option<String>,
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
    state.metadata_index.clear_connection(id).await;
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
    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();
    state
        .connection_manager
        .lock()
        .await
        .test_connection(&config, password.as_deref(), definition.as_ref())
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
    state.metadata_index.clear_connection(id).await;

    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();

    let ssh_tunnel = state
        .config_store
        .decrypt_ssh_tunnel(&config)
        .map_err(String::from)?;
    let mut runtime_config = config.clone();
    runtime_config.ssh_tunnel = ssh_tunnel;

    state
        .connection_manager
        .lock()
        .await
        .connect(&runtime_config, password.as_deref(), definition.as_ref())
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
    state.metadata_index.clear_connection(id).await;
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
        driver_definition_id: input.driver_definition_id,
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
        ssh_tunnel: input.ssh_tunnel.and_then(input_to_ssh_tunnel),
        created_at: now,
        updated_at: now,
    }
}

fn input_to_ssh_tunnel(input: SshTunnelInput) -> Option<SshTunnelConfig> {
    if !input.enabled {
        return Some(SshTunnelConfig {
            enabled: false,
            host: String::new(),
            port: 22,
            username: String::new(),
            auth_method: SshAuthMethod::PrivateKey,
            password_encrypted: None,
            private_key_path: None,
            private_key_passphrase_encrypted: None,
            remote_host: None,
            remote_port: None,
            local_host: None,
        });
    }

    Some(SshTunnelConfig {
        enabled: true,
        host: input.host.unwrap_or_default(),
        port: input.port.unwrap_or(22),
        username: input.username.unwrap_or_default(),
        auth_method: input.auth_method.unwrap_or(SshAuthMethod::PrivateKey),
        password_encrypted: input.password,
        private_key_path: input.private_key_path,
        private_key_passphrase_encrypted: input.private_key_passphrase,
        remote_host: input.remote_host,
        remote_port: input.remote_port,
        local_host: input.local_host,
    })
}
