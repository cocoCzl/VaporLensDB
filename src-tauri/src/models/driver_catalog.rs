use serde::{Deserialize, Serialize};

use crate::models::connection::DriverType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverDefinition {
    pub id: DriverType,
    pub name: String,
    pub backend: DriverBackend,
    pub status: DriverStatus,
    pub default_port: Option<u16>,
    pub default_username: Option<String>,
    pub default_database: Option<String>,
    pub jdbc_driver_class: Option<String>,
    pub url_template: Option<String>,
    pub driver_artifact: Option<String>,
    pub user_driver_required: bool,
    pub built_in: bool,
    pub notes: Option<String>,
    pub capabilities: DriverDefinitionCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriverBackend {
    NativeRust,
    Jdbc,
    Odbc,
    Planned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriverStatus {
    Ready,
    Configurable,
    Planned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverDefinitionCapabilities {
    pub can_connect: bool,
    pub can_query: bool,
    pub can_stream: bool,
    pub can_read_metadata: bool,
    pub can_cancel: bool,
    pub can_generate_ddl: bool,
}
