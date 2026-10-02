use chrono::Utc;
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;
use uuid::Uuid;

use crate::{
    models::connection::{
        ConnectionConfig, ConnectionStatus, DriverType, SshAuthMethod, SshTunnelConfig,
    },
    models::metadata::DriverCapabilities,
    services::connection_manager::{
        create_active_connection, test_connection as test_connection_service,
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
    pub driver_dialect: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub connection_url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    #[serde(default = "default_save_password")]
    pub save_password: bool,
    pub driver_class: Option<String>,
    pub driver_paths: Option<Vec<String>>,
    pub ssl_mode: Option<String>,
    pub group_id: Option<Uuid>,
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
pub async fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    create_connection_state(&state, input).await
}

async fn create_connection_state(
    state: &AppState,
    mut input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    extract_url_credentials(&mut input)?;
    let password = input.password.clone();
    let save_password = input.save_password;
    let config = input_to_config(input, Uuid::new_v4());
    // Explicitly creating a new SQLite datasource retains the product's
    // create-on-open contract. Reconnects use the separate saved-file guard.
    if config.driver_type == DriverType::Sqlite {
        test_connection_service(&config, None, None)
            .await
            .map_err(String::from)?;
    }
    state
        .config_store
        .create_connection(config, password, save_password)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn update_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    update_connection_state(&state, input).await
}

async fn update_connection_state(
    state: &AppState,
    mut input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    extract_url_credentials(&mut input)?;
    let id = input
        .id
        .ok_or_else(|| "connection id is required".to_string())?;
    let password = input.password.clone();
    let save_password = input.save_password;
    let config = input_to_config(input, id);
    let mut manager = state.connection_manager.lock().await;
    let existing = state
        .config_store
        .get_connection(id)
        .map_err(String::from)?
        .ok_or_else(|| format!("connection not found: {id}"))?;
    let refresh = requires_runtime_invalidation(&existing, &config, password.as_deref());
    if refresh {
        manager
            .preflight_configuration_change(id)
            .map_err(String::from)?;
        manager.disconnect(id).map_err(String::from)?;
        state.metadata_service.clear_connection(id).await;
        state.metadata_index.clear_connection(id).await;
    }
    let updated = state
        .config_store
        .update_connection(config, password, save_password)
        .map_err(String::from)?;

    Ok(updated)
}

fn requires_runtime_invalidation(
    existing: &ConnectionConfig,
    updated: &ConnectionConfig,
    password: Option<&str>,
) -> bool {
    let normalize_tunnel = |tunnel: &Option<SshTunnelConfig>| {
        tunnel.clone().map(|mut tunnel| {
            tunnel.password_encrypted = None;
            tunnel.private_key_passphrase_encrypted = None;
            tunnel
        })
    };
    existing.driver_definition_id != updated.driver_definition_id
        || existing.driver_type != updated.driver_type
        || existing.driver_dialect != updated.driver_dialect
        || existing.host != updated.host
        || existing.port != updated.port
        || existing.database != updated.database
        || existing.connection_url != updated.connection_url
        || existing.username != updated.username
        || existing.driver_class != updated.driver_class
        || existing.driver_paths != updated.driver_paths
        || existing.ssl_mode != updated.ssl_mode
        || normalize_tunnel(&existing.ssh_tunnel) != normalize_tunnel(&updated.ssh_tunnel)
        || updated.ssh_tunnel.as_ref().is_some_and(|tunnel| {
            tunnel
                .password_encrypted
                .as_ref()
                .is_some_and(|value| !value.is_empty())
                || tunnel
                    .private_key_passphrase_encrypted
                    .as_ref()
                    .is_some_and(|value| !value.is_empty())
        })
        || password.is_some_and(|value| !value.is_empty())
}

/// Changes only the datasource display name. It intentionally preserves live
/// sessions and does not read, update, or remove saved credentials.
#[tauri::command]
pub fn rename_connection(
    state: State<'_, AppState>,
    id: Uuid,
    name: String,
) -> Result<ConnectionConfig, String> {
    state
        .config_store
        .rename_connection(id, &name)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: Uuid) -> Result<(), String> {
    delete_connection_state(&state, id).await
}

async fn delete_connection_state(state: &AppState, id: Uuid) -> Result<(), String> {
    let mut manager = state.connection_manager.lock().await;
    manager.disconnect(id).map_err(String::from)?;
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
    mut input: ConnectionInput,
) -> Result<(), String> {
    extract_url_credentials(&mut input)?;
    let password = input.password.clone();
    let config = input_to_config(input, Uuid::new_v4());
    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();
    if config.driver_type == DriverType::Sqlite {
        test_sqlite_connection(&config, password.as_deref(), definition.as_ref())
            .await
            .map_err(Into::into)
    } else {
        test_connection_service(&config, password.as_deref(), definition.as_ref())
            .await
            .map_err(Into::into)
    }
}

/// Tests an unsaved SQLite path without materializing the final database.
///
/// SQLite's normal read-write connection intentionally carries CREATE for the
/// actual save/connect workflow. For Test Connection, an existing file is
/// opened normally, while a missing path is validated with a disposable
/// SQLite file in the same parent directory. That proves the driver can
/// create and open a database there without leaving a user-visible database
/// behind when the connection dialog is cancelled.
async fn test_sqlite_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
    definition: Option<&crate::models::driver_catalog::DriverDefinition>,
) -> Result<(), crate::models::error::AppError> {
    let path = config.connection_url.as_deref().ok_or_else(|| {
        crate::models::error::AppError::ConfigError("SQLite database path is required".to_string())
    })?;
    let target = Path::new(path);

    if path == ":memory:" || target.exists() {
        return test_connection_service(config, password, definition).await;
    }

    let parent = target
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(crate::models::error::AppError::ConfigError(format!(
            "SQLite parent directory does not exist: {}",
            parent.display()
        )));
    }

    let probe = sqlite_test_probe_path(parent);
    let mut probe_config = config.clone();
    probe_config.connection_url = Some(probe.to_string_lossy().into_owned());
    let result = test_connection_service(&probe_config, password, definition).await;
    let cleanup = remove_sqlite_test_probe(&probe);

    match (result, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Ok(()), Err(error)) => Err(crate::models::error::AppError::IoError(format!(
            "SQLite path validation succeeded but temporary probe cleanup failed: {error}"
        ))),
        (Err(error), _) => Err(error),
    }
}

fn sqlite_test_probe_path(parent: &Path) -> PathBuf {
    parent.join(format!(
        ".vaporlensdb-sqlite-test-{}.sqlite",
        Uuid::new_v4()
    ))
}

fn remove_sqlite_test_probe(path: &Path) -> Result<(), std::io::Error> {
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let candidate = PathBuf::from(format!("{}{}", path.display(), suffix));
        match fs::remove_file(candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    id: Uuid,
    password: Option<String>,
) -> Result<ConnectionStatus, String> {
    connect_state(&state, id, password).await
}

async fn connect_state(
    state: &AppState,
    id: Uuid,
    password: Option<String>,
) -> Result<ConnectionStatus, String> {
    let cleanup_gate = state.idle_reclaim_gate.lock().await;
    // A status of Connected only means the runtime entry exists. JDBC and
    // native drivers can lose their underlying session independently. Verify
    // an existing entry before reusing it; a failed health check is retired so
    // the normal connection path below creates a fresh driver/session.
    let existing_driver = {
        let manager = state.connection_manager.lock().await;
        manager
            .driver(id)
            .ok()
            .zip(manager.connection_generation(id).ok())
    };
    if let Some((driver, generation)) = existing_driver {
        match driver.ping().await {
            Ok(()) => {
                let manager = state.connection_manager.lock().await;
                if manager.connection_generation(id).ok() == Some(generation) {
                    return Ok(manager.status(id));
                }
            }
            Err(_) => {
                log::debug!(
                    "retiring stale connection before reconnect: connectionId={} driver={}",
                    id,
                    driver.driver_name()
                );
                state
                    .connection_manager
                    .lock()
                    .await
                    .invalidate_connection_generation(
                        id,
                        generation,
                        "stale driver session was replaced",
                    );
            }
        }
    }

    let (runtime_config, password, definition) = {
        let mut manager = state.connection_manager.lock().await;
        let mut config = state
            .config_store
            .get_connection(id)
            .map_err(String::from)?
            .ok_or_else(|| format!("connection not found: {id}"))?;
        validate_saved_sqlite_reconnect(&config)?;
        let supplied_password = password.filter(|value| !value.is_empty());
        let (password, ssh_tunnel) = match supplied_password {
            Some(password) => (
                Some(password),
                state
                    .config_store
                    .decrypt_ssh_tunnel(&config)
                    .map_err(String::from)?,
            ),
            None => state
                .config_store
                .decrypt_connection_credentials(&config)
                .map_err(String::from)?,
        };
        config.ssh_tunnel = ssh_tunnel;
        let definition = config
            .driver_definition_id
            .as_deref()
            .map(|id| state.config_store.get_driver_definition(id))
            .transpose()
            .map_err(String::from)?
            .flatten();
        if let Some(status) = manager.begin_connect(id).map_err(String::from)? {
            return Ok(status);
        }
        (config, password, definition)
    };

    state.metadata_service.clear_connection(id).await;
    state.metadata_index.clear_connection(id).await;
    drop(cleanup_gate);
    let active =
        create_active_connection(&runtime_config, password.as_deref(), definition.as_ref()).await;

    state
        .connection_manager
        .lock()
        .await
        .finish_connect(id, active)
        .map_err(Into::into)
}

/// A saved SQLite datasource represents an existing user file. Do not let
/// SQLite's create-on-open behavior silently replace a missing database during
/// reconnect; explicit new-connection flows still retain their create contract.
fn validate_saved_sqlite_reconnect(config: &ConnectionConfig) -> Result<(), String> {
    if config.driver_type != DriverType::Sqlite {
        return Ok(());
    }
    let path = config
        .connection_url
        .as_deref()
        .ok_or_else(|| "SQLite database path is required".to_string())?;
    if path == ":memory:" || Path::new(path).is_file() {
        return Ok(());
    }
    Err(format!(
        "SQLite database file not found: {path}. Update the saved connection path or create a new SQLite connection."
    ))
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
pub async fn connection_capabilities(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<DriverCapabilities, String> {
    state
        .connection_manager
        .lock()
        .await
        .capabilities(id)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_connection_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionStatus>, String> {
    Ok(state.connection_manager.lock().await.statuses())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConnectionSessionPolicyInput {
    pub max_live_sessions: u8,
    pub idle_reclaim_minutes: Option<u16>,
}

#[tauri::command]
pub async fn set_connection_session_policy(
    state: State<'_, AppState>,
    input: SetConnectionSessionPolicyInput,
) -> Result<(), String> {
    state
        .connection_manager
        .lock()
        .await
        .set_session_policy(input.max_live_sessions, input.idle_reclaim_minutes);
    Ok(())
}

fn input_to_config(input: ConnectionInput, id: Uuid) -> ConnectionConfig {
    let now = Utc::now();
    let (host, port) = normalize_host_port(input.host, input.port);
    ConnectionConfig {
        id,
        name: input.name,
        driver_definition_id: input.driver_definition_id,
        driver_type: input.driver_type,
        driver_dialect: input.driver_dialect,
        host,
        port,
        database: input.database,
        connection_url: input.connection_url,
        username: input.username,
        password_encrypted: None,
        has_saved_password: false,
        driver_class: input.driver_class,
        driver_paths: input.driver_paths.unwrap_or_default(),
        ssl_mode: input.ssl_mode,
        group_id: input.group_id,
        group: input.group,
        color_tag: input.color_tag,
        ssh_tunnel: input.ssh_tunnel.and_then(input_to_ssh_tunnel),
        created_at: now,
        updated_at: now,
    }
}

/// Host and port are separate native-driver fields. Normalize the common
/// `host:port` paste form before a native resolver can treat it as a hostname.
fn normalize_host_port(host: Option<String>, port: Option<u16>) -> (Option<String>, Option<u16>) {
    let Some(host) = host
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return (None, port);
    };
    let Some((candidate_host, candidate_port)) = host.rsplit_once(':') else {
        return (Some(host), port);
    };

    // IPv6 literals have more than one colon and must stay intact.
    if candidate_host.is_empty() || candidate_host.contains(':') {
        return (Some(host), port);
    }
    let Ok(embedded_port) = candidate_port.parse::<u16>() else {
        return (Some(host), port);
    };
    if embedded_port == 0 {
        return (Some(host), port);
    }

    (Some(candidate_host.to_string()), Some(embedded_port))
}

fn default_save_password() -> bool {
    true
}

/// Keep passwords out of persisted URLs even if a caller bypasses the UI.
/// Only standard URI syntax is changed; opaque custom JDBC strings stay intact.
fn extract_url_credentials(input: &mut ConnectionInput) -> Result<(), String> {
    let Some(connection_url) = input.connection_url.clone() else {
        return Ok(());
    };
    let extracted_properties = extract_sql_server_url_credentials(input, &connection_url);
    let connection_url = input.connection_url.clone().unwrap_or(connection_url);
    let jdbc_prefix = if connection_url.starts_with("jdbc:") {
        "jdbc:"
    } else {
        ""
    };
    let candidate = connection_url
        .strip_prefix("jdbc:")
        .unwrap_or(&connection_url);
    let Ok(mut url) = url::Url::parse(candidate) else {
        let authority_credentials = candidate.split_once("://").is_some_and(|(_, authority)| {
            authority
                .split(['/', '?', '#'])
                .next()
                .is_some_and(|value| value.contains('@'))
        });
        let query_credentials = candidate.split_once('?').is_some_and(|(_, query)| {
            url::form_urlencoded::parse(query.split('#').next().unwrap_or("").as_bytes()).any(
                |(key, _)| {
                    key.eq_ignore_ascii_case("user")
                        || key.eq_ignore_ascii_case("username")
                        || key.eq_ignore_ascii_case("password")
                },
            )
        });
        if authority_credentials || query_credentials {
            return Err(
                "connection URL credentials could not be safely extracted; check the URL format"
                    .to_string(),
            );
        }
        return Ok(());
    };
    let mut username = (!url.username().is_empty())
        .then(|| decode_url_credential(url.username()))
        .or_else(|| {
            extracted_properties
                .then(|| input.username.clone())
                .flatten()
        });
    let password = url
        .password()
        .filter(|value| !value.is_empty())
        .map(decode_url_credential)
        .or_else(|| {
            extracted_properties
                .then(|| input.password.clone())
                .flatten()
        });
    let mut query_password = None;
    let query_pairs = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    let has_query_credentials = query_pairs.iter().any(|(key, _)| {
        key.eq_ignore_ascii_case("user")
            || key.eq_ignore_ascii_case("username")
            || key.eq_ignore_ascii_case("password")
    });
    for (key, value) in &query_pairs {
        if username.is_none()
            && (key.eq_ignore_ascii_case("user") || key.eq_ignore_ascii_case("username"))
        {
            username = Some(value.to_string());
        }
        if query_password.is_none() && key.eq_ignore_ascii_case("password") {
            query_password = Some(value.to_string());
        }
    }
    if has_query_credentials {
        url.query_pairs_mut()
            .clear()
            .extend_pairs(query_pairs.into_iter().filter(|(key, _)| {
                !key.eq_ignore_ascii_case("user")
                    && !key.eq_ignore_ascii_case("username")
                    && !key.eq_ignore_ascii_case("password")
            }));
        if url.query() == Some("") {
            url.set_query(None);
        }
    }
    let password = password.or(query_password);
    if username.is_none() && password.is_none() {
        return Ok(());
    }
    if let Some(username) = username {
        input.username = Some(username);
    }
    if let Some(password) = password {
        input.password = Some(password);
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    input.connection_url = Some(format!("{jdbc_prefix}{url}"));
    Ok(())
}

fn decode_url_credential(value: &str) -> String {
    let encoded = format!("value={}", value.replace('+', "%2B").replace('&', "%26"));
    url::form_urlencoded::parse(encoded.as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn extract_sql_server_url_credentials(input: &mut ConnectionInput, connection_url: &str) -> bool {
    if !connection_url.starts_with("jdbc:sqlserver:") && !connection_url.contains(";") {
        return false;
    }
    let mut username = None;
    let mut password = None;
    let parts = split_connection_properties(connection_url)
        .into_iter()
        .filter(|part| {
            let Some((key, value)) = part.split_once('=') else {
                return true;
            };
            match key.trim().to_ascii_lowercase().as_str() {
                "user" | "user id" | "username" => {
                    username.get_or_insert_with(|| decode_property_credential(value));
                    false
                }
                "password" => {
                    password.get_or_insert_with(|| decode_property_credential(value));
                    false
                }
                _ => true,
            }
        })
        .collect::<Vec<_>>();
    if username.is_none() && password.is_none() {
        return false;
    }
    if let Some(username) = username {
        input.username = Some(username);
    }
    if let Some(password) = password {
        input.password = Some(password);
    }
    input.connection_url = Some(parts.join(";"));
    true
}

fn split_connection_properties(value: &str) -> Vec<&str> {
    let bytes = value.as_bytes();
    let mut parts = Vec::new();
    let mut braced = false;
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'{' => braced = true,
            b'}' if braced && bytes.get(index + 1) == Some(&b'}') => index += 1,
            b'}' => braced = false,
            b';' if !braced => {
                parts.push(&value[start..index]);
                start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }
    parts.push(&value[start..]);
    parts
}

fn decode_property_credential(value: &str) -> String {
    let value = value.trim();
    match value
        .strip_prefix('{')
        .and_then(|value| value.strip_suffix('}'))
    {
        Some(value) => value.replace("}}", "}"),
        None => value.to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::{sqlite::SqliteDriver, trait_def::DatabaseDriver};
    use crate::models::connection::ConnectionRuntimeStatus;

    fn input(url: &str) -> ConnectionInput {
        ConnectionInput {
            id: None,
            name: "test".to_string(),
            driver_definition_id: None,
            driver_type: DriverType::Postgres,
            driver_dialect: None,
            host: None,
            port: None,
            database: None,
            connection_url: Some(url.to_string()),
            username: None,
            password: None,
            save_password: false,
            driver_class: None,
            driver_paths: None,
            ssl_mode: None,
            group_id: None,
            group: None,
            color_tag: None,
            ssh_tunnel: None,
        }
    }

    fn test_state() -> (AppState, PathBuf) {
        let root = std::env::temp_dir().join(format!("vaporlensdb-p0-{}", Uuid::new_v4()));
        let state = AppState {
            config_store: crate::services::config_store::ConfigStore::new(root.clone()).unwrap(),
            connection_manager: tokio::sync::Mutex::new(
                crate::services::connection_manager::ConnectionManager::new(),
            ),
            metadata_service: crate::services::metadata_service::MetadataService::new(),
            metadata_index: crate::services::metadata_index::MetadataIndexService::new(),
            query_engine: crate::services::query_engine::QueryEngine::new(),
            task_manager: crate::services::task_manager::TaskManager::new(),
            idle_reclaim_worker: crate::IdleReclaimWorker::new(),
            idle_reclaim_gate: tokio::sync::Mutex::new(()),
        };
        (state, root)
    }

    async fn saved_sqlite(state: &AppState, connected: bool) -> ConnectionConfig {
        let config = state
            .config_store
            .create_connection(sqlite_config(Path::new(":memory:")), None, false)
            .unwrap();
        if connected {
            let active = create_active_connection(&config, None, None).await.unwrap();
            let mut manager = state.connection_manager.lock().await;
            manager.begin_connect(config.id).unwrap();
            manager.finish_connect(config.id, Ok(active)).unwrap();
        }
        config
    }

    #[tokio::test]
    async fn background_idle_reclaim_keeps_saved_config_clears_metadata_and_allows_reconnect() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        state
            .connection_manager
            .lock()
            .await
            .set_session_policy(5, Some(5));
        let driver = state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .unwrap();
        driver
            .execute_query("CREATE TABLE cached(old_value INTEGER)", None)
            .await
            .unwrap();
        let columns = state
            .metadata_service
            .get_columns(config.id, driver.clone(), "main", "cached")
            .await
            .unwrap();
        assert_eq!(columns[0].name, "old_value");
        state
            .metadata_index
            .index_connection(&config, driver.clone(), true, |_| true)
            .await
            .unwrap();
        assert!(!state
            .metadata_index
            .search("cached", Some(config.id), 10)
            .await
            .is_empty());
        drop(driver);
        let events = state
            .reclaim_idle_at(std::time::Instant::now() + std::time::Duration::from_secs(301))
            .await;
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].status.status,
            ConnectionRuntimeStatus::Disconnected
        ));
        assert!(state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .is_some());
        assert!(state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .is_err());
        assert!(state
            .metadata_index
            .search("cached", Some(config.id), 10)
            .await
            .is_empty());
        connect_state(&state, config.id, None).await.unwrap();
        let driver = state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .unwrap();
        driver
            .execute_query("CREATE TABLE cached(new_value INTEGER)", None)
            .await
            .unwrap();
        let columns = state
            .metadata_service
            .get_columns(config.id, driver, "main", "cached")
            .await
            .unwrap();
        assert_eq!(columns[0].name, "new_value");
        assert!(matches!(
            state
                .connection_manager
                .lock()
                .await
                .status(config.id)
                .status,
            ConnectionRuntimeStatus::Connected
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_delete_running_query_preserves_config_and_session() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let driver = state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .unwrap();
        driver
            .execute_query("CREATE TABLE metadata_marker(value TEXT)", None)
            .await
            .unwrap();
        let cached = state
            .metadata_service
            .get_tables(config.id, driver.clone(), "main")
            .await
            .unwrap();
        assert_eq!(cached.len(), 1);
        state
            .metadata_index
            .index_connection(&config, driver.clone(), false, |_| true)
            .await
            .unwrap();
        driver
            .execute_query("DROP TABLE metadata_marker", None)
            .await
            .unwrap();
        let operation = state
            .connection_manager
            .lock()
            .await
            .begin_query_operation(config.id, "running-query")
            .unwrap();
        let result = delete_connection_state(&state, config.id).await;
        assert!(result.is_err(), "busy deletion must fail");
        assert!(state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .is_some());
        assert!(std::sync::Arc::ptr_eq(
            &driver,
            &state
                .connection_manager
                .lock()
                .await
                .driver(config.id)
                .unwrap(),
        ));
        assert_eq!(
            state
                .metadata_service
                .get_tables(config.id, driver, "main")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(!state
            .metadata_index
            .search("metadata_marker", Some(config.id), 10)
            .await
            .is_empty());
        drop(operation);
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_display_edit_preserves_live_driver() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let driver = state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .unwrap();
        let mut edit = input(":memory:");
        edit.id = Some(config.id);
        edit.driver_type = DriverType::Sqlite;
        edit.name = "Renamed datasource".into();
        edit.group = Some("Development".into());
        edit.color_tag = Some("blue".into());
        let updated = update_connection_state(&state, edit).await.unwrap();
        assert_eq!(updated.name, "Renamed datasource");
        assert!(std::sync::Arc::ptr_eq(
            &driver,
            &state
                .connection_manager
                .lock()
                .await
                .driver(config.id)
                .unwrap(),
        ));
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    fn sqlite_edit(config: &ConnectionConfig) -> ConnectionInput {
        let mut edit = input(config.connection_url.as_deref().unwrap());
        edit.id = Some(config.id);
        edit.driver_type = DriverType::Sqlite;
        edit.name = config.name.clone();
        edit
    }

    async fn manual_transaction(state: &AppState, config: &ConnectionConfig) {
        let active = create_active_connection(config, None, None).await.unwrap();
        let operation = {
            let mut manager = state.connection_manager.lock().await;
            manager
                .install_console_session(config.id, "manual".into(), active)
                .unwrap();
            manager
                .begin_console_operation(config.id, "manual", None)
                .unwrap()
        };
        operation.driver.execute_query("BEGIN", None).await.unwrap();
        drop(operation);
        state.connection_manager.lock().await.set_console_phase(
            config.id,
            "manual",
            crate::services::connection_manager::ConsoleTransactionPhase::Active,
        );
    }

    #[tokio::test]
    async fn p0_delete_disconnected_and_idle_connections() {
        for connected in [false, true] {
            let (state, root) = test_state();
            let config = saved_sqlite(&state, connected).await;
            delete_connection_state(&state, config.id).await.unwrap();
            assert!(state
                .config_store
                .get_connection(config.id)
                .unwrap()
                .is_none());
            let manager = state.connection_manager.lock().await;
            assert!(manager.driver(config.id).is_err());
            assert!(matches!(
                manager.status(config.id).status,
                crate::models::connection::ConnectionRuntimeStatus::Disconnected
            ));
            drop(manager);
            drop(state);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[tokio::test]
    async fn p0_delete_transaction_preserves_credentials_and_session() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let saved = state
            .config_store
            .update_connection(config.clone(), Some("transactionDummy".into()), true)
            .unwrap();
        manual_transaction(&state, &config).await;
        let error = delete_connection_state(&state, config.id)
            .await
            .unwrap_err();
        assert!(error.contains("transaction"));
        assert!(!error.contains("transactionDummy"));
        let retained = state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .unwrap();
        assert_eq!(retained.password_encrypted, saved.password_encrypted);
        assert!(retained.has_saved_password);
        assert_eq!(
            state
                .config_store
                .decrypt_password(&retained)
                .unwrap()
                .as_deref(),
            Some("transactionDummy")
        );
        let manager = state.connection_manager.lock().await;
        assert!(manager.driver(config.id).is_ok());
        assert_eq!(
            manager.console_transaction_state(config.id, "manual").phase,
            crate::services::connection_manager::ConsoleTransactionPhase::Active
        );
        drop(manager);
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_delete_queued_operation_keeps_queue_usable() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let running = state
            .connection_manager
            .lock()
            .await
            .begin_query_operation(config.id, "running")
            .unwrap();
        let queued = state
            .connection_manager
            .lock()
            .await
            .begin_query_operation(config.id, "queued")
            .unwrap();
        assert!(matches!(
            &queued,
            crate::services::connection_manager::QueryOperationStart::Queued(_)
        ));
        assert!(delete_connection_state(&state, config.id).await.is_err());
        assert!(state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .is_some());
        drop(running);
        let operation = queued.wait().await.unwrap();
        operation
            .driver
            .execute_query("SELECT 1", None)
            .await
            .unwrap();
        drop(operation);
        delete_connection_state(&state, config.id).await.unwrap();
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_update_running_query_rejected_before_persistence() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let operation = state
            .connection_manager
            .lock()
            .await
            .begin_query_operation(config.id, "running")
            .unwrap();
        let generation = state
            .connection_manager
            .lock()
            .await
            .connection_generation(config.id)
            .unwrap();
        let mut edit = sqlite_edit(&config);
        edit.host = Some("new-host".into());
        assert!(update_connection_state(&state, edit).await.is_err());
        let saved = state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .unwrap();
        assert_eq!(saved.host, config.host);
        assert_eq!(saved.updated_at, config.updated_at);
        assert_eq!(
            state
                .connection_manager
                .lock()
                .await
                .connection_generation(config.id)
                .unwrap(),
            generation
        );
        let mut display = sqlite_edit(&config);
        display.name = "Busy but renamed".into();
        assert!(update_connection_state(&state, display).await.is_ok());
        assert_eq!(
            state
                .connection_manager
                .lock()
                .await
                .connection_generation(config.id)
                .unwrap(),
            generation
        );
        drop(operation);
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_update_transaction_rejected_but_display_edit_allowed() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let original = state
            .config_store
            .update_connection(config.clone(), Some("savedDummy".into()), true)
            .unwrap();
        manual_transaction(&state, &config).await;
        let generation = state
            .connection_manager
            .lock()
            .await
            .connection_generation(config.id)
            .unwrap();
        let mut edit = sqlite_edit(&config);
        edit.password = Some("temporaryDummy".into());
        let error = update_connection_state(&state, edit).await.unwrap_err();
        assert!(error.contains("transaction"));
        assert!(!error.contains("temporaryDummy"));
        let saved = state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .unwrap();
        assert_eq!(saved.updated_at, original.updated_at);
        assert_eq!(saved.password_encrypted, original.password_encrypted);
        assert!(saved.has_saved_password);
        let mut display = sqlite_edit(&config);
        display.color_tag = Some("green".into());
        display.group = Some("Production".into());
        let displayed = update_connection_state(&state, display).await.unwrap();
        assert!(!displayed.has_saved_password);
        assert!(state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .unwrap()
            .password_encrypted
            .is_none());
        let manager = state.connection_manager.lock().await;
        assert_eq!(
            manager.connection_generation(config.id).unwrap(),
            generation
        );
        assert_eq!(
            manager.console_transaction_state(config.id, "manual").phase,
            crate::services::connection_manager::ConsoleTransactionPhase::Active
        );
        drop(manager);
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_update_idle_connection_refreshes_generation() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let generation = state
            .connection_manager
            .lock()
            .await
            .connection_generation(config.id)
            .unwrap();
        let target = root.join("updated.sqlite");
        let updated_driver = SqliteDriver::connect(target.to_str().unwrap())
            .await
            .unwrap();
        updated_driver
            .execute_query("CREATE TABLE updated_marker(value TEXT)", None)
            .await
            .unwrap();
        drop(updated_driver);
        let mut edit = sqlite_edit(&config);
        edit.host = Some("new-host".into());
        edit.connection_url = Some(target.to_string_lossy().into_owned());
        let updated = update_connection_state(&state, edit).await.unwrap();
        assert_eq!(updated.host.as_deref(), Some("new-host"));
        assert!(state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .is_err());
        connect_state(&state, config.id, None).await.unwrap();
        let mut manager = state.connection_manager.lock().await;
        assert!(manager.connection_generation(config.id).unwrap() > generation);
        assert!(!manager.invalidate_connection_generation(
            config.id,
            generation,
            "stale operation"
        ));
        let driver = manager.driver(config.id).unwrap();
        drop(manager);
        driver
            .execute_query("SELECT * FROM updated_marker", None)
            .await
            .unwrap();
        drop(driver);
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_update_pending_connect_rejected_before_persistence() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, false).await;
        state
            .connection_manager
            .lock()
            .await
            .begin_connect(config.id)
            .unwrap();
        let mut edit = sqlite_edit(&config);
        edit.port = Some(1234);
        assert!(update_connection_state(&state, edit).await.is_err());
        assert_eq!(
            state
                .config_store
                .get_connection(config.id)
                .unwrap()
                .unwrap()
                .port,
            config.port
        );
        let active = create_active_connection(&config, None, None).await.unwrap();
        state
            .connection_manager
            .lock()
            .await
            .finish_connect(config.id, Ok(active))
            .unwrap();
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_update_persistence_failure_cannot_leave_a_stale_runtime_driver() {
        let (state, root) = test_state();
        let config = saved_sqlite(&state, true).await;
        let mut edit = sqlite_edit(&config);
        edit.host = Some("new-host".into());
        edit.group_id = Some(Uuid::new_v4());
        assert!(update_connection_state(&state, edit).await.is_err());
        let saved = state
            .config_store
            .get_connection(config.id)
            .unwrap()
            .unwrap();
        assert_eq!(saved.host, config.host);
        assert_eq!(saved.updated_at, config.updated_at);
        assert!(state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .is_err());
        connect_state(&state, config.id, None).await.unwrap();
        assert!(state
            .connection_manager
            .lock()
            .await
            .driver(config.id)
            .is_ok());
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn p0_classifies_all_physical_connection_fields() {
        let config = input_to_config(input("postgres://host/db"), Uuid::new_v4());
        let mutations: Vec<fn(&mut ConnectionConfig)> = vec![
            |config| config.driver_type = DriverType::Mysql,
            |config| config.driver_definition_id = Some("custom".into()),
            |config| config.driver_dialect = Some("custom".into()),
            |config| config.host = Some("other-host".into()),
            |config| config.port = Some(1234),
            |config| config.database = Some("other-db".into()),
            |config| config.username = Some("other-user".into()),
            |config| config.connection_url = Some("postgres://other-host/db".into()),
            |config| config.ssl_mode = Some("require".into()),
            |config| config.driver_class = Some("custom.Driver".into()),
            |config| config.driver_paths = vec!["custom.jar".into()],
        ];
        for mutate in mutations {
            let mut updated = config.clone();
            mutate(&mut updated);
            assert!(requires_runtime_invalidation(&config, &updated, None));
        }
        assert!(requires_runtime_invalidation(
            &config,
            &config,
            Some("credentialDummy")
        ));
        assert!(!requires_runtime_invalidation(&config, &config, Some("")));
        let mut display = config.clone();
        display.name = "Renamed".into();
        display.group = Some("Group".into());
        display.group_id = Some(Uuid::new_v4());
        display.color_tag = Some("blue".into());
        assert!(!requires_runtime_invalidation(&config, &display, None));
        let mut tunneled = config.clone();
        tunneled.ssh_tunnel = Some(SshTunnelConfig {
            enabled: true,
            host: "ssh-host".into(),
            port: 22,
            username: "qa".into(),
            auth_method: SshAuthMethod::Password,
            password_encrypted: Some("encrypted-marker".into()),
            private_key_path: None,
            private_key_passphrase_encrypted: None,
            remote_host: Some("db-host".into()),
            remote_port: Some(5432),
            local_host: Some("127.0.0.1".into()),
        });
        let mut edited_tunnel = tunneled.clone();
        edited_tunnel
            .ssh_tunnel
            .as_mut()
            .unwrap()
            .password_encrypted = Some(String::new());
        assert!(!requires_runtime_invalidation(
            &tunneled,
            &edited_tunnel,
            None
        ));
        edited_tunnel.ssh_tunnel.as_mut().unwrap().host = "another-ssh-host".into();
        assert!(requires_runtime_invalidation(
            &tunneled,
            &edited_tunnel,
            None
        ));
        edited_tunnel = tunneled.clone();
        edited_tunnel
            .ssh_tunnel
            .as_mut()
            .unwrap()
            .private_key_passphrase_encrypted = Some("temporaryDummy".into());
        assert!(requires_runtime_invalidation(
            &tunneled,
            &edited_tunnel,
            None
        ));
    }

    #[tokio::test]
    async fn p0_malformed_credential_url_is_rejected_without_leaking_or_saving() {
        let (state, root) = test_state();
        let error =
            create_connection_state(&state, input("postgres://alice:malformedDummy@bad host/db"))
                .await
                .unwrap_err();
        assert!(!error.contains("malformedDummy"));
        assert!(state.config_store.list_connections().unwrap().is_empty());
        assert!(!root.join("dev-secret.key").exists());
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn p0_url_password_persistence_obeys_consent_and_clears_old_secret() {
        std::env::set_var("VAPORLENSDB_USE_DEV_KEY", "1");
        let (state, root) = test_state();
        let url = "postgres://alice:authorityDummy@host/db?password=queryDummy&sslmode=require";
        let unsaved = create_connection_state(&state, input(url)).await.unwrap();
        assert!(!unsaved.has_saved_password);
        assert!(unsaved.password_encrypted.is_none());
        assert_eq!(
            unsaved.connection_url.as_deref(),
            Some("postgres://host/db?sslmode=require")
        );
        assert!(!root.join("dev-secret.key").exists());
        let mut saved_input = input(url);
        saved_input.save_password = true;
        let saved = create_connection_state(&state, saved_input).await.unwrap();
        assert!(saved.has_saved_password);
        assert_eq!(
            state
                .config_store
                .decrypt_password(&saved)
                .unwrap()
                .as_deref(),
            Some("authorityDummy")
        );
        let mut edit =
            input("postgres://alice:temporaryDummy@host/db?password=queryDummy&sslmode=require");
        edit.id = Some(saved.id);
        let updated = update_connection_state(&state, edit).await.unwrap();
        let persisted = state
            .config_store
            .get_connection(saved.id)
            .unwrap()
            .unwrap();
        assert!(!updated.has_saved_password);
        assert!(!persisted.has_saved_password);
        assert!(persisted.password_encrypted.is_none());
        assert!(state
            .config_store
            .decrypt_password(&persisted)
            .unwrap()
            .is_none());
        assert_eq!(
            persisted.connection_url.as_deref(),
            Some("postgres://host/db?sslmode=require")
        );
        let serialized = serde_json::to_string(&persisted).unwrap();
        for password in ["authorityDummy", "queryDummy", "temporaryDummy"] {
            assert!(!serialized.contains(password));
        }
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_uri_credentials_before_persisting() {
        let mut input = input("postgresql://alice:secret@db.example/app");
        extract_url_credentials(&mut input).unwrap();
        assert_eq!(
            input.connection_url.as_deref(),
            Some("postgresql://db.example/app")
        );
        assert_eq!(input.username.as_deref(), Some("alice"));
        assert_eq!(input.password.as_deref(), Some("secret"));
        assert!(!input.save_password);
    }

    #[test]
    fn extracts_sql_server_credentials_before_persisting() {
        let mut input =
            input("jdbc:sqlserver://db.example:1433;database=app;user=alice;password=secret");
        extract_url_credentials(&mut input).unwrap();
        assert_eq!(
            input.connection_url.as_deref(),
            Some("jdbc:sqlserver://db.example:1433;database=app")
        );
        assert_eq!(input.username.as_deref(), Some("alice"));
        assert_eq!(input.password.as_deref(), Some("secret"));
        assert!(!input.save_password);
    }

    #[test]
    fn p0_authority_credentials_strip_query_credentials_without_consent() {
        let mut input = input(
            "postgres://alice:authorityDummy@host/db?password=queryDummy&user=bob&sslmode=require",
        );
        extract_url_credentials(&mut input).unwrap();
        assert_eq!(
            input.connection_url.as_deref(),
            Some("postgres://host/db?sslmode=require")
        );
        assert_eq!(input.username.as_deref(), Some("alice"));
        assert_eq!(input.password.as_deref(), Some("authorityDummy"));
        assert!(!input.save_password);
    }

    #[test]
    fn p0_url_credentials_match_frontend_fixtures_and_preserve_consent() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture {
            name: String,
            input: String,
            connection_url: String,
            username: Option<String>,
            password: Option<String>,
        }
        let fixtures: Vec<Fixture> = serde_json::from_str(include_str!(
            "../../../src/lib/__fixtures__/connectionUrlCredentials.json"
        ))
        .unwrap();
        for fixture in fixtures {
            for save_password in [false, true] {
                let mut input = input(&fixture.input);
                input.save_password = save_password;
                extract_url_credentials(&mut input).unwrap();
                assert_eq!(
                    input.connection_url.as_deref(),
                    Some(fixture.connection_url.as_str()),
                    "{}",
                    fixture.name
                );
                assert_eq!(input.username, fixture.username, "{}", fixture.name);
                assert_eq!(input.password, fixture.password, "{}", fixture.name);
                assert_eq!(input.save_password, save_password, "{}", fixture.name);
            }
        }
    }

    #[test]
    fn splits_a_pasted_host_port_before_native_connection_resolution() {
        assert_eq!(
            normalize_host_port(Some("192.0.2.20:3306".to_string()), Some(3306)),
            (Some("192.0.2.20".to_string()), Some(3306))
        );
        assert_eq!(
            normalize_host_port(Some("2001:db8::1".to_string()), Some(3306)),
            (Some("2001:db8::1".to_string()), Some(3306))
        );
    }

    #[test]
    fn saved_sqlite_reconnect_requires_an_existing_file() {
        let missing =
            std::env::temp_dir().join(format!("vaporlensdb-missing-{}.sqlite", Uuid::new_v4()));
        let mut sqlite = input(&missing.to_string_lossy());
        sqlite.driver_type = DriverType::Sqlite;
        let config = input_to_config(sqlite, Uuid::new_v4());

        let error = validate_saved_sqlite_reconnect(&config)
            .expect_err("missing saved SQLite file must not reconnect");
        assert!(error.contains("file not found"));
        assert!(!missing.exists());
    }

    #[test]
    fn saved_sqlite_reconnect_allows_an_existing_file() {
        let path =
            std::env::temp_dir().join(format!("vaporlensdb-existing-{}.sqlite", Uuid::new_v4()));
        std::fs::File::create(&path).expect("temporary SQLite file");
        let mut sqlite = input(&path.to_string_lossy());
        sqlite.driver_type = DriverType::Sqlite;
        let config = input_to_config(sqlite, Uuid::new_v4());

        assert!(validate_saved_sqlite_reconnect(&config).is_ok());
        std::fs::remove_file(path).expect("remove temporary SQLite file");
    }

    fn sqlite_config(path: &Path) -> ConnectionConfig {
        let mut sqlite = input(&path.to_string_lossy());
        sqlite.driver_type = DriverType::Sqlite;
        input_to_config(sqlite, Uuid::new_v4())
    }

    #[tokio::test]
    async fn sqlite_test_connection_keeps_a_missing_target_absent() {
        let root = std::env::temp_dir().join(format!("vaporlensdb-sqlite-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create test root");
        let target = root.join("space path").join("测试路径.sqlite");
        fs::create_dir_all(target.parent().expect("test parent")).expect("create test parent");
        let config = sqlite_config(&target);

        test_sqlite_connection(&config, None, None)
            .await
            .expect("test a new SQLite path");

        assert!(
            !target.exists(),
            "Test Connection must not create the target database"
        );
        assert_eq!(
            fs::read_dir(target.parent().expect("test parent"))
                .unwrap()
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("remove test root");
    }

    #[tokio::test]
    async fn sqlite_test_connection_preserves_an_existing_database() {
        let path = std::env::temp_dir().join(format!(
            "vaporlensdb-existing-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let driver = SqliteDriver::connect(path.to_str().expect("utf-8 path"))
            .await
            .expect("create SQLite database");
        driver
            .execute_query("CREATE TABLE marker(value TEXT NOT NULL)", None)
            .await
            .expect("create marker table");
        driver
            .execute_query("INSERT INTO marker VALUES ('preserved')", None)
            .await
            .expect("seed SQLite database");
        drop(driver);

        test_sqlite_connection(&sqlite_config(&path), None, None)
            .await
            .expect("test existing SQLite database");

        let connection =
            rusqlite::Connection::open(&path).expect("reopen existing SQLite database");
        let marker: String = connection
            .query_row("SELECT value FROM marker", [], |row| row.get(0))
            .expect("read preserved marker");
        assert_eq!(marker, "preserved");
        fs::remove_file(path).expect("remove test database");
    }

    #[tokio::test]
    async fn explicit_new_sqlite_connection_still_creates_its_database() {
        let path =
            std::env::temp_dir().join(format!("vaporlensdb-create-test-{}.sqlite", Uuid::new_v4()));
        assert!(!path.exists());

        let driver = SqliteDriver::connect(path.to_str().expect("utf-8 path"))
            .await
            .expect("explicit SQLite connection creates the database");
        drop(driver);

        assert!(path.is_file());
        fs::remove_file(path).expect("remove test database");
    }
}
