use std::fmt;

use serde::{ser::SerializeStruct, Serialize, Serializer};

use crate::utils::error_redaction::sanitize_diagnostic_error;

#[derive(Debug)]
pub enum AppError {
    ConnectionFailed { driver: String, message: String },

    SshTunnelError { message: String },

    QueryFailed { sql: String, message: String },

    DisconnectBlocked { reason: DisconnectBlockReason },

    AuthError(String),

    IoError(String),

    NotFound { resource: String, id: String },

    Timeout { operation: String, elapsed_ms: u64 },

    UnsupportedOperation { driver: String, operation: String },

    SerializationError(String),

    ConfigError(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisconnectBlockReason {
    RunningOperations,
    UncommittedTransaction,
}

impl AppError {
    /// Safe external text for IPC, persisted operation state, logs, and diagnostics.
    pub fn safe_message(&self) -> String {
        match self {
            Self::ConnectionFailed { driver, message } => {
                format!(
                    "Connection failed ({driver}): {}",
                    sanitize_diagnostic_error(message, None)
                )
            }
            Self::SshTunnelError { message } => {
                format!(
                    "SSH tunnel failed: {}",
                    sanitize_diagnostic_error(message, None)
                )
            }
            Self::QueryFailed { sql, message } => {
                format!(
                    "Query failed: {}",
                    sanitize_diagnostic_error(message, Some(sql))
                )
            }
            Self::DisconnectBlocked { reason } => match reason {
                DisconnectBlockReason::RunningOperations => {
                    "Connection cannot be disconnected while operations are running".to_string()
                }
                DisconnectBlockReason::UncommittedTransaction => {
                    "Connection cannot be disconnected while a transaction has uncommitted changes"
                        .to_string()
                }
            },
            Self::AuthError(message) => {
                format!("Auth error: {}", sanitize_diagnostic_error(message, None))
            }
            Self::IoError(message) => {
                format!("IO error: {}", sanitize_diagnostic_error(message, None))
            }
            Self::NotFound { resource, id } => format!("Not found: {resource} ({id})"),
            Self::Timeout {
                operation,
                elapsed_ms,
            } => {
                format!("Timeout: {operation} after {elapsed_ms}ms")
            }
            Self::UnsupportedOperation { driver, operation } => {
                format!("Unsupported operation: {operation} on {driver}")
            }
            Self::SerializationError(message) => {
                format!(
                    "Serialization error: {}",
                    sanitize_diagnostic_error(message, None)
                )
            }
            Self::ConfigError(message) => {
                format!(
                    "Configuration error: {}",
                    sanitize_diagnostic_error(message, None)
                )
            }
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::ConnectionFailed { .. } => "CONNECTION_FAILED",
            Self::SshTunnelError { .. } => "SSH_TUNNEL_FAILED",
            Self::QueryFailed { .. } => "QUERY_FAILED",
            Self::DisconnectBlocked { .. } => "DISCONNECT_BLOCKED",
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
            Self::QueryFailed { sql, .. } => {
                Some(format!("sql=[redacted: {} chars]", sql.chars().count()))
            }
            Self::DisconnectBlocked { reason } => Some(match reason {
                DisconnectBlockReason::RunningOperations => "reason=running_operations".to_string(),
                DisconnectBlockReason::UncommittedTransaction => {
                    "reason=uncommitted_transaction".to_string()
                }
            }),
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

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.safe_message())
    }
}

impl std::error::Error for AppError {}

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
        state.serialize_field("message", &self.safe_message())?;
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

    #[test]
    fn serializes_external_credentials_as_redacted() {
        let error = AppError::ConnectionFailed {
            driver: "jdbc".to_string(),
            message: "jdbc:mysql://test-user:super-secret-test-value@example.invalid/db?password=super-secret-test-value".to_string(),
        };

        let value = serde_json::to_string(&error).expect("serialize app error");
        assert!(!value.contains("super-secret-test-value"));
        assert!(value.contains("example.invalid"));
    }

    #[test]
    fn query_error_detail_and_message_do_not_expose_sql() {
        let sql = "SELECT * FROM accounts WHERE token = 'super-secret-test-value'";
        let error = AppError::QueryFailed {
            sql: sql.to_string(),
            message: format!("syntax error while executing {sql}; SQLSTATE 42601"),
        };

        let value = serde_json::to_string(&error).expect("serialize app error");
        assert!(!value.contains("super-secret-test-value"));
        assert!(value.contains("SQLSTATE 42601"));
        assert!(value.contains("[redacted: "));
    }

    #[test]
    fn serializes_disconnect_block_reason_without_exposing_driver_text() {
        let error = AppError::DisconnectBlocked {
            reason: super::DisconnectBlockReason::UncommittedTransaction,
        };
        let value = serde_json::to_value(error).expect("serialize disconnect block");

        assert_eq!(value["code"], "DISCONNECT_BLOCKED");
        assert_eq!(value["detail"], "reason=uncommitted_transaction");
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("uncommitted changes"));
    }
}
