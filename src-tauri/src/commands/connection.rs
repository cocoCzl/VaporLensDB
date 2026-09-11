use chrono::Utc;
use serde::Deserialize;
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
pub fn create_connection(
    state: State<'_, AppState>,
    mut input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    extract_url_credentials(&mut input);
    let password = input.password.clone();
    let save_password = input.save_password;
    let config = input_to_config(input, Uuid::new_v4());
    state
        .config_store
        .create_connection(config, password, save_password)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn update_connection(
    state: State<'_, AppState>,
    mut input: ConnectionInput,
) -> Result<ConnectionConfig, String> {
    extract_url_credentials(&mut input);
    let id = input
        .id
        .ok_or_else(|| "connection id is required".to_string())?;
    let password = input.password.clone();
    let save_password = input.save_password;
    let config = input_to_config(input, id);
    let updated = state
        .config_store
        .update_connection(config, password, save_password)
        .map_err(String::from)?;

    // Saved configuration and live drivers must never diverge. Dropping only
    // the runtime session preserves every SQL tab's stable connection ID; its
    // next execution reconnects against this newly saved configuration.
    state
        .connection_manager
        .lock()
        .await
        .invalidate_connection(id, "connection configuration changed");
    state.metadata_service.clear_connection(id).await;
    state.metadata_index.clear_connection(id).await;
    Ok(updated)
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
    mut input: ConnectionInput,
) -> Result<(), String> {
    extract_url_credentials(&mut input);
    let password = input.password.clone();
    let config = input_to_config(input, Uuid::new_v4());
    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();
    test_connection_service(&config, password.as_deref(), definition.as_ref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    id: Uuid,
    password: Option<String>,
) -> Result<ConnectionStatus, String> {
    let config = state
        .config_store
        .get_connection(id)
        .map_err(String::from)?
        .ok_or_else(|| format!("connection not found: {id}"))?;
    let password = match password.filter(|value| !value.is_empty()) {
        Some(password) => Some(password),
        None => state
            .config_store
            .decrypt_password(&config)
            .map_err(String::from)?,
    };

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

    // A status of Connected only means the runtime entry exists. JDBC and
    // native drivers can lose their underlying session independently. Verify
    // an existing entry before reusing it; a failed health check is retired so
    // the normal connection path below creates a fresh driver/session.
    let existing_driver = { state.connection_manager.lock().await.driver(id).ok() };
    if let Some(driver) = existing_driver {
        match driver.ping().await {
            Ok(()) => return Ok(state.connection_manager.lock().await.status(id)),
            Err(error) => {
                log::debug!(
                    "retiring stale connection before reconnect: connectionId={} driver={} reason={}",
                    id,
                    driver.driver_name(),
                    error
                );
                state
                    .connection_manager
                    .lock()
                    .await
                    .invalidate_connection(id, "stale driver session was replaced");
            }
        }
    }

    {
        let mut manager = state.connection_manager.lock().await;
        if let Some(status) = manager.begin_connect(id).map_err(String::from)? {
            return Ok(status);
        }
    }

    let active =
        create_active_connection(&runtime_config, password.as_deref(), definition.as_ref()).await;

    state
        .connection_manager
        .lock()
        .await
        .finish_connect(id, active)
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
fn extract_url_credentials(input: &mut ConnectionInput) {
    let Some(connection_url) = input.connection_url.clone() else {
        return;
    };
    if extract_sql_server_url_credentials(input, &connection_url) {
        return;
    }
    let jdbc_prefix = connection_url.strip_prefix("jdbc:").unwrap_or("");
    let candidate = connection_url
        .strip_prefix("jdbc:")
        .unwrap_or(&connection_url);
    let Ok(mut url) = url::Url::parse(candidate) else {
        return;
    };
    let mut username = (!url.username().is_empty()).then(|| url.username().to_string());
    let password = url.password().map(str::to_string);
    let mut query_password = None;
    if username.is_none() || password.is_none() {
        let query_pairs = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<Vec<_>>();
        for (key, value) in &query_pairs {
            if username.is_none()
                && (key.eq_ignore_ascii_case("user") || key.eq_ignore_ascii_case("username"))
            {
                username = Some(value.to_string());
            }
            if password.is_none() && key.eq_ignore_ascii_case("password") {
                query_password = Some(value.to_string());
            }
        }
        if username.is_some() || query_password.is_some() {
            url.query_pairs_mut()
                .clear()
                .extend_pairs(query_pairs.into_iter().filter(|(key, _)| {
                    !key.eq_ignore_ascii_case("user")
                        && !key.eq_ignore_ascii_case("username")
                        && !key.eq_ignore_ascii_case("password")
                }));
        }
    }
    let password = password.or(query_password);
    if username.is_none() && password.is_none() {
        return;
    }
    if let Some(username) = username {
        input.username = Some(username);
    }
    if let Some(password) = password {
        input.password = Some(password);
        input.save_password = true;
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    input.connection_url = Some(format!("{jdbc_prefix}{url}"));
}

fn extract_sql_server_url_credentials(input: &mut ConnectionInput, connection_url: &str) -> bool {
    if !connection_url.starts_with("jdbc:sqlserver:") && !connection_url.contains(";") {
        return false;
    }
    let mut username = None;
    let mut password = None;
    let parts = connection_url
        .split(';')
        .filter(|part| {
            let Some((key, value)) = part.split_once('=') else {
                return true;
            };
            match key.trim().to_ascii_lowercase().as_str() {
                "user" | "user id" | "username" => {
                    username = Some(value.trim().to_string());
                    false
                }
                "password" => {
                    password = Some(value.trim().to_string());
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
        input.save_password = true;
    }
    input.connection_url = Some(parts.join(";"));
    true
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

    #[test]
    fn extracts_uri_credentials_before_persisting() {
        let mut input = input("postgresql://alice:secret@db.example/app");
        extract_url_credentials(&mut input);
        assert_eq!(
            input.connection_url.as_deref(),
            Some("postgresql://db.example/app")
        );
        assert_eq!(input.username.as_deref(), Some("alice"));
        assert_eq!(input.password.as_deref(), Some("secret"));
        assert!(input.save_password);
    }

    #[test]
    fn extracts_sql_server_credentials_before_persisting() {
        let mut input =
            input("jdbc:sqlserver://db.example:1433;database=app;user=alice;password=secret");
        extract_url_credentials(&mut input);
        assert_eq!(
            input.connection_url.as_deref(),
            Some("jdbc:sqlserver://db.example:1433;database=app")
        );
        assert_eq!(input.username.as_deref(), Some("alice"));
        assert_eq!(input.password.as_deref(), Some("secret"));
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
}
