use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppError {
    #[error("Connection failed ({driver}): {message}")]
    ConnectionFailed { driver: String, message: String },

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
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
    }
}
