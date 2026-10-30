use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::models::connection::DriverType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverDefinition {
    pub id: String,
    #[serde(default)]
    pub product_id: String,
    #[serde(default)]
    pub default_installation_id: Option<String>,
    #[serde(default)]
    pub native_implementation_id: Option<String>,
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
}

impl fmt::Display for DriverBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::NativeRust => "nativeRust",
            Self::Jdbc => "jdbc",
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

/// Product identity is independent of dialect and execution backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseProduct {
    pub id: String,
    pub name: String,
    pub icon_key: String,
    pub built_in: bool,
    pub adapter_id: String,
    pub default_driver_definition_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInstallation {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub source: Option<InstallationSource>,
    pub id: String,
    pub driver_definition_id: String,
    /// User-provided label, not a version discovered in the JAR.
    pub label: String,
    pub artifacts: Vec<DriverArtifact>,
    pub java_requirement: String,
    #[serde(default)]
    pub validation: Option<InstallationValidation>,
}

/// Historical local class-load receipt, never a database connectivity claim.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationValidation {
    pub fingerprint: String,
    pub checked_at: String,
    pub class_loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverArtifact {
    pub path: String,
    /// Missing files in migrated configurations retain an explicit unknown hash.
    pub sha256: Option<String>,
    pub role: String,
}

/// Provenance is not a class-load or database-connectivity receipt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationSource {
    pub kind: String,
    pub urls: Vec<String>,
    pub checksum_sources: Vec<String>,
    pub license: Option<String>,
}
