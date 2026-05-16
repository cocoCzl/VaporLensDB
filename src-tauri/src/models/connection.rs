use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub driver_type: DriverType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: Option<String>,
    pub username: Option<String>,
    #[serde(skip_serializing)]
    pub password_encrypted: Option<String>,
    pub ssl_mode: Option<String>,
    pub group: Option<String>,
    pub color_tag: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriverType {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Mongo,
    Redis,
    Odbc,
    Jdbc,
}
