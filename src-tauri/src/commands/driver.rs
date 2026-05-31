use serde::{Deserialize, Serialize};

use crate::{
    models::{
        connection::{ConnectionConfig, DriverType},
        driver_catalog::DriverDefinition,
        error::AppError,
    },
    services::{
        driver_catalog,
        external_driver::{validate_jdbc_prerequisites, validate_odbc_prerequisites},
    },
};

#[tauri::command]
pub fn list_driver_definitions() -> Vec<DriverDefinition> {
    driver_catalog::driver_definitions()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateExternalDriverInput {
    pub driver_type: DriverType,
    pub connection_url: Option<String>,
    pub driver_class: Option<String>,
    pub driver_paths: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDriverValidation {
    pub valid: bool,
    pub message: String,
}

#[tauri::command]
pub async fn validate_external_driver(
    input: ValidateExternalDriverInput,
) -> Result<ExternalDriverValidation, String> {
    let config = ConnectionConfig {
        id: uuid::Uuid::new_v4(),
        name: "external driver validation".to_string(),
        driver_type: input.driver_type,
        host: None,
        port: None,
        database: None,
        connection_url: input.connection_url,
        username: None,
        password_encrypted: None,
        driver_class: input.driver_class,
        driver_paths: input.driver_paths.unwrap_or_default(),
        ssl_mode: None,
        group: None,
        color_tag: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let result = match config.driver_type {
        DriverType::Oracle | DriverType::Jdbc => validate_jdbc_prerequisites(&config).await,
        DriverType::Odbc => validate_odbc_prerequisites(&config),
        _ => Err(AppError::UnsupportedOperation {
            driver: config.driver_type.to_string(),
            operation: "external driver validation".to_string(),
        }),
    };

    match result {
        Ok(()) => Ok(ExternalDriverValidation {
            valid: true,
            message: "external driver configuration is valid".to_string(),
        }),
        Err(error) => Err(String::from(error)),
    }
}
