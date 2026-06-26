use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::models::connection::DriverType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverDefinition {
    pub id: String,
    pub driver_type: DriverType,
    pub driver_dialect: String,
    pub name: String,
    pub backend: DriverBackend,
    pub status: DriverStatus,
    pub default_port: Option<u16>,
    pub default_username: Option<String>,
    pub default_database: Option<String>,
    pub jdbc_driver_class: Option<String>,
    pub url_template: Option<String>,
    pub driver_artifact: Option<String>,
    pub driver_artifacts: Vec<String>,
    pub user_driver_required: bool,
    pub built_in: bool,
    pub download_url: Option<String>,
    pub notes: Option<String>,
    pub connection_variants: Vec<DriverConnectionVariant>,
    pub metadata_dialect_sql: Option<String>,
    pub capabilities: DriverDefinitionCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriverBackend {
    NativeRust,
    Jdbc,
    Planned,
}

impl fmt::Display for DriverBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::NativeRust => "nativeRust",
            Self::Jdbc => "jdbc",
            Self::Planned => "planned",
        };
        f.write_str(value)
    }
}

impl FromStr for DriverBackend {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "nativeRust" => Ok(Self::NativeRust),
            "jdbc" => Ok(Self::Jdbc),
            "planned" => Ok(Self::Planned),
            _ => Err(format!("unsupported driver backend: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriverStatus {
    Ready,
    Configurable,
    Planned,
}

impl fmt::Display for DriverStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::Ready => "ready",
            Self::Configurable => "configurable",
            Self::Planned => "planned",
        };
        f.write_str(value)
    }
}

impl FromStr for DriverStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "ready" => Ok(Self::Ready),
            "configurable" => Ok(Self::Configurable),
            "planned" => Ok(Self::Planned),
            _ => Err(format!("unsupported driver status: {value}")),
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverConnectionVariant {
    pub id: String,
    pub label: String,
    pub required_fields: Vec<String>,
}
