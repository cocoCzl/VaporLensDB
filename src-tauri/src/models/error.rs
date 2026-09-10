use serde::{ser::SerializeStruct, Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Connection failed ({driver}): {message}")]
    ConnectionFailed { driver: String, message: String },

    #[error("SSH tunnel failed: {message}")]
    SshTunnelError { message: String },

    #[error("Query failed: {message}")]
    QueryFailed { sql: String, message: String },

    #[error("Auth error: {0}")]
    AuthError(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Not found: {resource} ({id})")]
    NotFound { resource: String, id: String },

    #[error("Timeout: {operation} after {elapsed_ms}ms")]
    Timeout { operation: String, elapsed_ms: u64 },

    #[error("Unsupported operation: {operation} on {driver}")]
    UnsupportedOperation { driver: String, operation: String },

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ConnectionFailed { .. } => "CONNECTION_FAILED",
            Self::SshTunnelError { .. } => "SSH_TUNNEL_FAILED",
            Self::QueryFailed { .. } => "QUERY_FAILED",
            Self::AuthError(_) => "AUTH_ERROR",
            Self::IoError(_) => "IO_ERROR",
            Self::NotFound { .. } => "NOT_FOUND",
            Self::Timeout { .. } => "TIMEOUT",
            Self::UnsupportedOperation { .. } => "UNSUPPORTED_OPERATION",
            Self::SerializationError(_) => "SERIALIZATION_ERROR",
            Self::ConfigError(_) => "CONFIG_ERROR",
        }
    }

    pub fn detail(&self) -> Option<String> {
        match self {
            Self::ConnectionFailed { driver, message } => {
                Some(connection_failure_detail(driver, message))
            }
            Self::SshTunnelError { .. } => Some("phase=ssh_tunnel".to_string()),
            Self::QueryFailed { sql, .. } => Some(format!("sql={sql}")),
            Self::NotFound { resource, id } => Some(format!("resource={resource}; id={id}")),
            Self::Timeout {
                operation,
                elapsed_ms,
            } => Some(format!("operation={operation}; elapsedMs={elapsed_ms}")),
            Self::UnsupportedOperation { driver, operation } => {
                Some(format!("driver={driver}; operation={operation}"))
            }
            _ => None,
        }
    }
}

fn connection_failure_detail(driver: &str, message: &str) -> String {
    let normalized = message.to_ascii_lowercase();
    let mut details = vec![format!("driver={driver}")];

    if normalized.contains("no route to host") {
        details.push("phase=tcp_connect".to_string());
        details.push("cause=no_route_to_host".to_string());
    } else if normalized.contains("connection refused") {
        details.push("phase=tcp_connect".to_string());
        details.push("cause=connection_refused".to_string());
    } else if normalized.contains("timed out") || normalized.contains("timeout") {
        details.push("phase=tcp_connect".to_string());
        details.push("cause=timeout".to_string());
    } else if normalized.contains("access denied")
        || normalized.contains("authentication failed")
        || normalized.contains("password authentication failed")
        || normalized.contains("login failed")
    {
        details.push("phase=authentication".to_string());
        details.push("cause=authentication_failed".to_string());
    }

    if normalized.contains("os error 65") {
        details.push("osError=65".to_string());
    }

    details.join("\n")
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.serialize_field("detail", &self.detail())?;
        state.end()
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::SerializationError(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::IoError(value.to_string())
    }
}

impl From<tokio_postgres::Error> for AppError {
    fn from(value: tokio_postgres::Error) -> Self {
        if value.as_db_error().is_some() {
            Self::QueryFailed {
                sql: "<unknown>".to_string(),
                message: value.to_string(),
            }
        } else {
            Self::ConnectionFailed {
                driver: "postgres".to_string(),
                message: value.to_string(),
            }
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::ConfigError(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn serializes_to_stable_error_contract() {
        let error = AppError::ConnectionFailed {
            driver: "postgres".to_string(),
            message: "connection refused".to_string(),
        };

        let value = serde_json::to_value(error).expect("serialize app error");

        assert_eq!(value["code"], "CONNECTION_FAILED");
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("connection refused"));
        assert_eq!(
            value["detail"],
            "driver=postgres\nphase=tcp_connect\ncause=connection_refused"
        );
    }

    #[test]
    fn connection_failure_detail_includes_network_phase_and_os_error() {
        let error = AppError::ConnectionFailed {
            driver: "mysql".to_string(),
            message: "Input/output error: No route to host (os error 65)".to_string(),
        };

        let value = serde_json::to_value(error).expect("serialize app error");

        assert_eq!(
            value["detail"],
            "driver=mysql\nphase=tcp_connect\ncause=no_route_to_host\nosError=65"
        );
    }
}
