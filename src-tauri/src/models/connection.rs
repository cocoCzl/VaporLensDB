use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub driver_definition_id: Option<String>,
    pub driver_type: DriverType,
    pub driver_dialect: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub connection_url: Option<String>,
    pub username: Option<String>,
    #[serde(skip_serializing)]
    pub password_encrypted: Option<String>,
    pub driver_class: Option<String>,
    pub driver_paths: Vec<String>,
    pub ssl_mode: Option<String>,
    pub group: Option<String>,
    pub color_tag: Option<String>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    #[serde(skip_serializing)]
    pub password_encrypted: Option<String>,
    pub private_key_path: Option<String>,
    #[serde(skip_serializing)]
    pub private_key_passphrase_encrypted: Option<String>,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub local_host: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriverType {
    Postgres,
    Mysql,
    Oracle,
    Sqlite,
    Mssql,
    Mongo,
    Redis,
    Jdbc,
}

impl fmt::Display for DriverType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
            Self::Oracle => "oracle",
            Self::Sqlite => "sqlite",
            Self::Mssql => "mssql",
            Self::Mongo => "mongo",
            Self::Redis => "redis",
            Self::Jdbc => "jdbc",
        };
        f.write_str(value)
    }
}

impl FromStr for DriverType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "postgres" => Ok(Self::Postgres),
            "mysql" => Ok(Self::Mysql),
            "oracle" => Ok(Self::Oracle),
            "sqlite" => Ok(Self::Sqlite),
            "mssql" => Ok(Self::Mssql),
            "mongo" => Ok(Self::Mongo),
            "redis" => Ok(Self::Redis),
            "jdbc" => Ok(Self::Jdbc),
            _ => Err(format!("unsupported driver type: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionRuntimeStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connection_id: Uuid,
    pub status: ConnectionRuntimeStatus,
    pub message: Option<String>,
}
