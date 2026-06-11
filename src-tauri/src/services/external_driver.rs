use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use tokio::process::Command;

use crate::models::{connection::ConnectionConfig, error::AppError};

pub async fn validate_jdbc_prerequisites(config: &ConnectionConfig) -> Result<(), AppError> {
    let connection_url = required(config.connection_url.as_deref(), "JDBC URL")?;
    if !connection_url.starts_with("jdbc:") {
        return Err(AppError::ConfigError(
            "JDBC URL must start with jdbc:".to_string(),
        ));
    }

    required(config.driver_class.as_deref(), "JDBC driver class")?;

    if config.driver_paths.is_empty() {
        return Err(AppError::ConfigError(
            "at least one JDBC driver jar path is required".to_string(),
        ));
    }

    for path in &config.driver_paths {
        validate_jar_path(path)?;
    }

    validate_java_runtime().await?;
    resolve_jdbc_bridge_jar().map(|_| ())
}

fn validate_jar_path(path: &str) -> Result<(), AppError> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(AppError::ConfigError(format!(
            "JDBC driver file does not exist: {}",
            path.display()
        )));
    }

    if !path.is_file() {
        return Err(AppError::ConfigError(format!(
            "JDBC driver path is not a file: {}",
            path.display()
        )));
    }

    if path.extension().and_then(|value| value.to_str()) != Some("jar") {
        return Err(AppError::ConfigError(format!(
            "JDBC driver file must be a .jar: {}",
            path.display()
        )));
    }

    Ok(())
}

pub fn resolve_jdbc_bridge_jar() -> Result<PathBuf, AppError> {
    if let Ok(path) = std::env::var("VAPORLENSDB_JDBC_BRIDGE_JAR") {
        return validate_bridge_jar(PathBuf::from(path));
    }

    let current_dir = std::env::current_dir()?;
    let candidates = [
        current_dir.join("tools/jdbc-bridge/target/jdbc-bridge.jar"),
        current_dir.join("../tools/jdbc-bridge/target/jdbc-bridge.jar"),
        current_dir.join("../../tools/jdbc-bridge/target/jdbc-bridge.jar"),
    ];

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            AppError::ConfigError(
                "JDBC bridge jar not found; run ./build.sh jdbc-bridge first".to_string(),
            )
        })
}

fn validate_bridge_jar(path: PathBuf) -> Result<PathBuf, AppError> {
    if path.is_file() {
        Ok(path)
    } else {
        Err(AppError::ConfigError(format!(
            "JDBC bridge jar does not exist: {}",
            path.display()
        )))
    }
}

async fn validate_java_runtime() -> Result<(), AppError> {
    let output = Command::new("java")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|error| {
            AppError::ConfigError(format!(
                "Java runtime is required for JDBC drivers: {error}"
            ))
        })?;

    if !output.status.success() {
        return Err(AppError::ConfigError(
            "java -version failed; install a working JRE/JDK for JDBC drivers".to_string(),
        ));
    }

    Ok(())
}

fn required<'a>(value: Option<&'a str>, name: &str) -> Result<&'a str, AppError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::ConfigError(format!("{name} is required")))
}
