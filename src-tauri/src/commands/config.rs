//! Settings/configuration-adjacent IPC commands.

use std::{env, fs, path::PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    models::{
        connection::{ConnectionRuntimeStatus, DriverType},
        query_history::{QueryHistoryEntry, QueryHistoryStatus},
    },
    services::task_manager::{TaskInfo, TaskStatus},
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsPackageInput {
    pub output_path: String,
    pub include_sql_text: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsPackageResponse {
    pub path: String,
    pub generated_at: DateTime<Utc>,
    pub included_sql_text: bool,
    pub connection_count: usize,
    pub failed_query_count: usize,
    pub task_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsPackage {
    app: DiagnosticsAppInfo,
    os: DiagnosticsOsInfo,
    privacy: DiagnosticsPrivacyInfo,
    connections: Vec<DiagnosticsConnection>,
    failed_queries: Vec<DiagnosticsFailedQuery>,
    tasks: Vec<DiagnosticsTask>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsAppInfo {
    name: &'static str,
    version: &'static str,
    generated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsOsInfo {
    os: &'static str,
    arch: &'static str,
    family: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsPrivacyInfo {
    excludes_passwords: bool,
    excludes_decrypted_secrets: bool,
    excludes_sql_result_data: bool,
    sql_text_included: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsConnection {
    id: Uuid,
    name: String,
    driver_type: DriverType,
    driver_definition_id: Option<String>,
    group: Option<String>,
    color_tag: Option<String>,
    database_present: bool,
    url_configured: bool,
    host_configured: bool,
    ssh_tunnel_enabled: bool,
    runtime_status: ConnectionRuntimeStatus,
    runtime_message: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsFailedQuery {
    id: Uuid,
    connection_id: Uuid,
    connection_name_snapshot: String,
    driver_type: DriverType,
    database_present: bool,
    schema_present: bool,
    sql: String,
    started_at: DateTime<Utc>,
    elapsed_ms: Option<u64>,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsTask {
    id: Uuid,
    kind: String,
    title: String,
    status: TaskStatus,
    progress_current: u64,
    progress_total: Option<u64>,
    progress_message: Option<String>,
    logs: Vec<DiagnosticsTaskLog>,
    error: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsTaskLog {
    at: DateTime<Utc>,
    message: String,
}

#[tauri::command]
pub async fn export_diagnostics_package(
    state: tauri::State<'_, AppState>,
    input: ExportDiagnosticsPackageInput,
) -> Result<ExportDiagnosticsPackageResponse, String> {
    let generated_at = Utc::now();
    let include_sql_text = input.include_sql_text.unwrap_or(false);
    let output_path = PathBuf::from(input.output_path);
    let connections = state
        .config_store
        .list_connections()
        .map_err(String::from)?;
    let statuses = state.connection_manager.lock().await.statuses();
    let history = state
        .config_store
        .list_query_history(5_000)
        .map_err(String::from)?;
    let tasks = state.task_manager.list_tasks().await;

    let diagnostics_connections = connections
        .into_iter()
        .map(|connection| {
            let status = statuses
                .iter()
                .find(|status| status.connection_id == connection.id);
            DiagnosticsConnection {
                id: connection.id,
                name: connection.name,
                driver_type: connection.driver_type,
                driver_definition_id: connection.driver_definition_id,
                group: connection.group,
                color_tag: connection.color_tag,
                database_present: connection
                    .database
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()),
                url_configured: connection
                    .connection_url
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()),
                host_configured: connection
                    .host
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()),
                ssh_tunnel_enabled: connection
                    .ssh_tunnel
                    .as_ref()
                    .is_some_and(|tunnel| tunnel.enabled),
                runtime_status: status
                    .map(|status| status.status.clone())
                    .unwrap_or(ConnectionRuntimeStatus::Disconnected),
                runtime_message: status.and_then(|status| status.message.clone()),
                created_at: connection.created_at,
                updated_at: connection.updated_at,
            }
        })
        .collect::<Vec<_>>();

    let failed_queries = history
        .into_iter()
        .filter(|entry| matches!(entry.status, QueryHistoryStatus::Failed))
        .take(200)
        .map(|entry| failed_query(entry, include_sql_text))
        .collect::<Vec<_>>();

    let diagnostics_tasks = tasks.into_iter().map(task).collect::<Vec<_>>();

    let package = DiagnosticsPackage {
        app: DiagnosticsAppInfo {
            name: "VaporLensDB",
            version: env!("CARGO_PKG_VERSION"),
            generated_at,
        },
        os: DiagnosticsOsInfo {
            os: env::consts::OS,
            arch: env::consts::ARCH,
            family: env::consts::FAMILY,
        },
        privacy: DiagnosticsPrivacyInfo {
            excludes_passwords: true,
            excludes_decrypted_secrets: true,
            excludes_sql_result_data: true,
            sql_text_included: include_sql_text,
        },
        connections: diagnostics_connections,
        failed_queries,
        tasks: diagnostics_tasks,
    };

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(&package).map_err(|error| error.to_string())?;
    fs::write(&output_path, content).map_err(|error| error.to_string())?;

    Ok(ExportDiagnosticsPackageResponse {
        path: output_path.to_string_lossy().to_string(),
        generated_at,
        included_sql_text: include_sql_text,
        connection_count: package.connections.len(),
        failed_query_count: package.failed_queries.len(),
        task_count: package.tasks.len(),
    })
}

fn failed_query(entry: QueryHistoryEntry, include_sql_text: bool) -> DiagnosticsFailedQuery {
    DiagnosticsFailedQuery {
        id: entry.id,
        connection_id: entry.connection_id,
        connection_name_snapshot: entry.connection_name_snapshot,
        driver_type: entry.driver_type,
        database_present: entry
            .database
            .as_deref()
            .is_some_and(|value| !value.is_empty()),
        schema_present: entry
            .schema
            .as_deref()
            .is_some_and(|value| !value.is_empty()),
        sql: diagnostics_sql_text(&entry.sql, include_sql_text),
        started_at: entry.started_at,
        elapsed_ms: entry.elapsed_ms,
        error_code: entry.error_code,
        error_message: entry.error_message,
    }
}

fn diagnostics_sql_text(sql: &str, include_sql_text: bool) -> String {
    if include_sql_text {
        sql.to_string()
    } else {
        format!("[redacted: {} chars]", sql.chars().count())
    }
}

fn task(task: TaskInfo) -> DiagnosticsTask {
    DiagnosticsTask {
        id: task.id,
        kind: task.kind,
        title: task.title,
        status: task.status,
        progress_current: task.progress.current,
        progress_total: task.progress.total,
        progress_message: task.progress.message,
        logs: task
            .logs
            .into_iter()
            .map(|log| DiagnosticsTaskLog {
                at: log.at,
                message: log.message,
            })
            .collect(),
        error: task.error,
        created_at: task.created_at,
        updated_at: task.updated_at,
        finished_at: task.finished_at,
    }
}

#[cfg(test)]
mod tests {
    use super::diagnostics_sql_text;

    #[test]
    fn diagnostics_sql_text_is_redacted_by_default() {
        let sql = "select * from customers where email = 'secret@example.test'";

        let redacted = diagnostics_sql_text(sql, false);
        assert!(redacted.starts_with("[redacted: "));
        assert!(!redacted.contains("secret@example.test"));
        assert_eq!(diagnostics_sql_text(sql, true), sql);
    }
}
