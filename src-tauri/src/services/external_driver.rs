use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tokio::{io::AsyncWriteExt, process::Command};

use crate::models::{connection::ConnectionConfig, error::AppError};

static BUNDLED_JDBC_BRIDGE_JAR: OnceLock<PathBuf> = OnceLock::new();

pub fn configure_bundled_jdbc_bridge_jar(path: PathBuf) {
    let _ = BUNDLED_JDBC_BRIDGE_JAR.set(path);
}

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

    if let Some(path) = BUNDLED_JDBC_BRIDGE_JAR.get().filter(|path| path.is_file()) {
        return Ok(path.clone());
    }

    let current_dir = std::env::current_dir()?;
    #[cfg(not(debug_assertions))]
    let source_candidates = [
        current_dir.join("tools/jdbc-bridge/target/jdbc-bridge.jar"),
        current_dir.join("../tools/jdbc-bridge/target/jdbc-bridge.jar"),
        current_dir.join("../../tools/jdbc-bridge/target/jdbc-bridge.jar"),
    ];

    // LaunchServices starts a macOS .app with a system-selected working
    // directory, so relative source-tree lookup is not reliable in dev mode.
    // Keep the compile-time manifest fallback debug-only to avoid embedding a
    // developer machine path as a release-runtime dependency.
    #[cfg(debug_assertions)]
    let source_candidates = [
        current_dir.join("tools/jdbc-bridge/target/jdbc-bridge.jar"),
        current_dir.join("../tools/jdbc-bridge/target/jdbc-bridge.jar"),
        current_dir.join("../../tools/jdbc-bridge/target/jdbc-bridge.jar"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tools/jdbc-bridge/target/jdbc-bridge.jar"),
    ];

    source_candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            AppError::ConfigError(
                "JDBC bridge jar not found in application resources or the source tree; run ./build.sh jdbc-bridge first"
                    .to_string(),
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

    let version = String::from_utf8_lossy(&output.stderr);
    let major = version
        .split('"')
        .nth(1)
        .and_then(|v| v.split('.').next())
        .and_then(|v| v.parse::<u32>().ok());
    if major.is_none_or(|v| v < 21) {
        return Err(AppError::ConfigError(
            "JDBC bridge requires Java 21 or newer; selected PATH runtime is older".into(),
        ));
    }
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

/// Class/dependency loading is a separate validation step from connecting.
pub async fn validate_jdbc_driver_class(config: &ConnectionConfig) -> Result<(), AppError> {
    validate_jdbc_prerequisites(config).await?;
    let bridge = resolve_jdbc_bridge_jar()?;
    let classpath = std::env::join_paths(
        std::iter::once(bridge).chain(config.driver_paths.iter().map(PathBuf::from)),
    )
    .map_err(|_| AppError::ConfigError("Invalid JDBC classpath".into()))?;
    let mut process = Command::new("java")
        .arg("-cp")
        .arg(classpath)
        .arg("com.vaporlensdb.jdbcbridge.JdbcBridge")
        .arg("validate")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| AppError::ConfigError("Java runtime unavailable".into()))?;
    process
        .stdin
        .take()
        .ok_or_else(|| AppError::ConfigError("JDBC validation input unavailable".into()))?
        .write_all(
            format!(
                "{}\n",
                BASE64.encode(config.driver_class.as_deref().unwrap_or_default())
            )
            .as_bytes(),
        )
        .await?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        process.wait_with_output(),
    )
    .await
    .map_err(|_| AppError::ConfigError("JDBC class loading timed out".into()))??;
    if !output.status.success() {
        return Err(AppError::ConfigError("JDBC class/dependency loading failed. Check driver class, dependencies and Java compatibility. Connectivity has not been tested.".into()));
    }
    Ok(())
}

/// Bind a historical validation to ordered bytes, class, selected Java binary,
/// runtime version and bridge. Changing any dependency invalidates the fingerprint.
pub async fn installation_runtime_fingerprint(
    config: &ConnectionConfig,
) -> Result<String, AppError> {
    use sha2::{Digest, Sha256};
    validate_java_runtime().await?;
    let java = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|p| p.join(if cfg!(windows) { "java.exe" } else { "java" }))
        .find(|p| p.is_file())
        .ok_or_else(|| AppError::ConfigError("Java runtime unavailable".into()))?
        .canonicalize()?;
    let mut hashes = Vec::new();
    for path in &config.driver_paths {
        hashes.push(super::driver_registry::artifact_hash(path)?);
    }
    let version = Command::new("java").arg("-version").output().await?;
    let bridge = resolve_jdbc_bridge_jar()?;
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(
            config.driver_class.as_ref(),
            hashes,
            java.to_string_lossy(),
            super::driver_registry::artifact_hash(&java.to_string_lossy())?,
            String::from_utf8_lossy(&version.stderr),
            super::driver_registry::artifact_hash(&bridge.to_string_lossy())?
        ))?)
    ))
}
