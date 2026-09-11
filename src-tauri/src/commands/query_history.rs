use chrono::{DateTime, Utc};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::{
    models::query_history::{QueryHistoryEntry, QueryHistoryStatus},
    utils::error_redaction::sanitize_diagnostic_error,
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQueryHistoryInput {
    pub connection_id: Uuid,
    pub schema: Option<String>,
    pub sql: String,
    pub status: QueryHistoryStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub elapsed_ms: Option<u64>,
    pub row_count: Option<u64>,
    pub affected_rows: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[tauri::command]
pub fn add_query_history(
    state: State<'_, AppState>,
    input: CreateQueryHistoryInput,
) -> Result<QueryHistoryEntry, String> {
    let connection = state
        .config_store
        .get_connection(input.connection_id)
        .map_err(String::from)?
        .ok_or_else(|| format!("connection not found: {}", input.connection_id))?;

    let error_message = input
        .error_message
        .as_deref()
        .map(|message| sanitize_diagnostic_error(message, Some(&input.sql)));
    let entry = QueryHistoryEntry {
        id: Uuid::new_v4(),
        connection_id: connection.id,
        connection_name_snapshot: connection.name,
        driver_type: connection.driver_type,
        database: connection.database,
        schema: input.schema,
        sql: input.sql,
        status: input.status,
        started_at: input.started_at.unwrap_or_else(Utc::now),
        elapsed_ms: input.elapsed_ms,
        row_count: input.row_count,
        affected_rows: input.affected_rows,
        error_code: input.error_code,
        error_message,
    };

    state
        .config_store
        .add_query_history(entry)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_query_history(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    state
        .config_store
        .list_query_history(limit.unwrap_or(200))
        .map_err(Into::into)
}

#[tauri::command]
pub fn clear_query_history(state: State<'_, AppState>) -> Result<(), String> {
    state.config_store.clear_query_history().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::sanitize_diagnostic_error;

    #[test]
    fn persisted_query_errors_are_sanitized_before_storage() {
        let sql = "SELECT * FROM accounts WHERE token = 'super-secret-test-value'";
        let raw = format!(
            "syntax error while executing {sql}; jdbc:postgresql://example.invalid/db?password=super-secret-test-value"
        );
        let persisted = sanitize_diagnostic_error(&raw, Some(sql));

        assert!(!persisted.contains("super-secret-test-value"));
        assert!(persisted.contains("[REDACTED SQL]"));
        assert!(persisted.contains("example.invalid"));
    }
}
