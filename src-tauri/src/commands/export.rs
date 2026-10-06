use std::{
    collections::HashSet,
    future::Future,
    hash::{Hash, Hasher},
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    fs::File,
    io::{
        AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader, BufWriter,
    },
    sync::mpsc,
    task::{yield_now, JoinHandle},
    time::timeout,
};
use uuid::Uuid;

use crate::{
    commands::task::emit_task_update,
    drivers::trait_def::DbParameter,
    models::{
        connection::DriverType,
        error::AppError,
        metadata::ColumnInfo,
        query_result::{QueryResult, QueryResultChunk, QueryStreamSummary},
    },
    services::{
        connection_manager::{
            ConsoleOperation, ConsoleTransactionPhase, QueryOperation, QueryOperationStart,
        },
        task_manager::{TaskHandle, TaskInfo},
    },
    AppState,
};

const TABLE_EXPORT_CHUNK_SIZE: usize = 1_000;
const EXPORT_CANCEL_TIMEOUT: Duration = Duration::from_secs(2);
const IMPORT_PREVIEW_ROWS: usize = 20;
const IMPORT_MAX_RECORD_BYTES: usize = 1024 * 1024;
const IMPORT_PREVIEW_SAMPLE_BYTES: usize = 4 * 1024 * 1024;
const IMPORT_REPORT_MAX_ROWS_PER_KIND: usize = 1_000;
const IMPORT_REPORT_MAX_BYTES_PER_KIND: usize = 4 * 1024 * 1024;
const IMPORT_BATCH_SIZE: usize = 100;
const IMPORT_BATCH_MAX_BYTES: usize = 4 * 1024 * 1024;
const IMPORT_MAX_PARAMETERS: usize = 32_000;
const STALE_EXPORT_PART_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const EXPORT_PART_PREFIX: &str = ".vaporlensdb-export-";
const EXPORT_PART_SUFFIX: &str = ".part";
const CONSOLE_TRANSACTION_UPDATED_EVENT: &str = "console_transaction_updated";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQueryResultCsvInput {
    pub result: QueryResult,
    pub path: String,
    #[serde(default = "default_include_header")]
    pub include_header: bool,
}

/// Exports directly from the database driver. Unlike `ExportQueryResultCsvInput`,
/// this never serializes the rendered result back across the IPC boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQueryCsvInput {
    pub connection_id: Uuid,
    pub connection_generation: u64,
    pub sql: String,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub console_id: Option<String>,
    pub path: String,
    #[serde(default = "default_include_header")]
    pub include_header: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableCsvInput {
    pub connection_id: Uuid,
    pub driver_type: DriverType,
    pub schema: String,
    pub table: String,
    pub path: String,
    #[serde(default = "default_include_header")]
    pub include_header: bool,
    pub max_rows: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTableCsvImportInput {
    pub connection_id: Uuid,
    pub schema: String,
    pub table: String,
    pub path: String,
    #[serde(default = "default_has_header")]
    pub has_header: bool,
    pub delimiter: Option<String>,
    pub mapping: Option<Vec<Option<String>>>,
    #[serde(default = "default_empty_as_null")]
    pub empty_as_null: bool,
    pub preview_rows: Option<usize>,
    #[serde(default)]
    pub sample_only: bool,
    #[serde(default)]
    pub task_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTableCsvInput {
    pub connection_id: Uuid,
    pub driver_type: DriverType,
    pub schema: String,
    pub table: String,
    pub path: String,
    #[serde(default = "default_has_header")]
    pub has_header: bool,
    pub delimiter: Option<String>,
    pub mapping: Option<Vec<Option<String>>>,
    #[serde(default = "default_empty_as_null")]
    pub empty_as_null: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    pub row_count: u64,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub path: String,
    pub headers: Vec<String>,
    pub target_columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: u64,
    pub valid_rows: u64,
    pub invalid_rows: Vec<RowReport>,
    pub can_import: bool,
    pub cancelled: bool,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowReport {
    pub row_number: u64,
    pub message: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub path: String,
    pub table: String,
    pub total_rows: u64,
    pub inserted_rows: u64,
    pub invalid_row_count: u64,
    pub invalid_rows_omitted: u64,
    pub invalid_rows: Vec<RowReport>,
    pub failed_write_count: u64,
    pub failed_writes_omitted: u64,
    pub failed_writes: Vec<RowReport>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    inserted_rows: u64,
    failed_rows: u64,
    failures: Vec<RowReport>,
}

static CSV_RESULTS: std::sync::Mutex<Vec<(Uuid, CsvImportResult)>> =
    std::sync::Mutex::new(Vec::new());

fn csv_ui_report(report: &ImportReport) -> CsvImportResult {
    CsvImportResult {
        inserted_rows: report.inserted_rows,
        failed_rows: report.invalid_row_count + report.failed_write_count,
        failures: report
            .invalid_rows
            .iter()
            .chain(&report.failed_writes)
            .take(100)
            .map(|row| RowReport {
                row_number: row.row_number,
                message: row.message.chars().take(1000).collect(),
                values: Vec::new(),
            })
            .collect(),
    }
}

fn remember_csv_report(id: Uuid, report: &ImportReport) {
    let mut reports = CSV_RESULTS.lock().expect("CSV reports");
    reports.push((id, csv_ui_report(report)));
    if reports.len() > 20 {
        reports.remove(0);
    }
}

#[tauri::command]
pub fn get_csv_import_result(task_id: Uuid) -> Option<CsvImportResult> {
    CSV_RESULTS
        .lock()
        .expect("CSV reports")
        .iter()
        .find(|(id, _)| *id == task_id)
        .map(|(_, report)| report.clone())
}

// Remove echoed field values as well as credentials before surfacing a row error.
fn csv_row_error(error: &AppError, row: &[String]) -> String {
    let mut message = error.safe_message();
    let mut values: Vec<&str> = row
        .iter()
        .map(String::as_str)
        .filter(|v| !v.is_empty())
        .collect();
    values.sort_by_key(|v| std::cmp::Reverse(v.len()));
    for value in values {
        message = message.replace(value, "[REDACTED VALUE]");
    }
    message
}

#[derive(Default)]
struct BoundedRowReports {
    total: u64,
    retained_bytes: usize,
    reports: Vec<RowReport>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ImportFileSnapshot {
    len: u64,
    modified: Option<SystemTime>,
    content_hash: u64,
}

async fn import_file_snapshot(path: &Path) -> Result<ImportFileSnapshot, AppError> {
    let metadata = tokio::fs::metadata(path).await.map_err(AppError::from)?;
    let mut file = File::open(path).await.map_err(AppError::from)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(AppError::from)?;
        if read == 0 {
            break;
        }
        buffer[..read].hash(&mut hasher);
    }
    Ok(ImportFileSnapshot {
        len: metadata.len(),
        modified: metadata.modified().ok(),
        content_hash: hasher.finish(),
    })
}

async fn ensure_import_file_unchanged(
    path: &Path,
    expected: &ImportFileSnapshot,
) -> Result<(), ExportTaskError> {
    let metadata = tokio::fs::metadata(path).await.map_err(AppError::from)?;
    if metadata.len() != expected.len || metadata.modified().ok() != expected.modified {
        return Err(AppError::ConfigError(
            "CSV file changed while it was being imported; no further rows were written".into(),
        )
        .into());
    }
    Ok(())
}

async fn ensure_import_file_content_unchanged(
    path: &Path,
    expected: &ImportFileSnapshot,
) -> Result<(), ExportTaskError> {
    let current = import_file_snapshot(path).await?;
    if &current != expected {
        return Err(AppError::ConfigError(
            "CSV file contents changed while it was being imported; no rows were written from the changed snapshot".into(),
        )
        .into());
    }
    Ok(())
}

impl BoundedRowReports {
    fn push(&mut self, report: RowReport) {
        self.total += 1;
        let report_bytes = row_storage_bytes(&report.values) + report.message.len();
        if self.reports.len() >= IMPORT_REPORT_MAX_ROWS_PER_KIND
            || report_bytes > IMPORT_REPORT_MAX_BYTES_PER_KIND - self.retained_bytes
        {
            return;
        }
        self.retained_bytes += report_bytes;
        self.reports.push(report);
    }

    fn omitted(&self) -> u64 {
        self.total - self.reports.len() as u64
    }
}

#[tauri::command]
pub async fn export_query_result_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryResultCsvInput,
) -> Result<TaskInfo, AppError> {
    let path = PathBuf::from(&input.path);
    let staged_path = staged_export_path(&path)?;
    cleanup_stale_export_parts(&path, STALE_EXPORT_PART_AGE).await;
    let row_count = input.result.rows.len() as u64;
    let manager = state.task_manager.clone();
    let task = manager
        .create_task_with_output(
            "export.csv.result",
            &format!("Export CSV: {}", display_file_name(&path)),
            Some(row_count),
            Some(path.display().to_string()),
        )
        .await;
    let handle = manager.handle(task.id).await?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Ok(task) = manager.start_task(handle.id, "Preparing CSV export").await {
            emit_task_update(&app_for_task, &task);
        }

        let result = write_query_result_csv(
            &input.result,
            &staged_path,
            input.include_header,
            &manager,
            &handle,
        )
        .await;
        match finalize_staged_export(result, &staged_path, &path).await {
            Ok(report) => {
                if let Ok(task) = manager
                    .finish_success(
                        handle.id,
                        format!(
                            "Exported {} rows to {} ({} bytes)",
                            report.row_count, report.path, report.bytes_written
                        ),
                    )
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Cancelled) => {
                if let Ok(task) = manager
                    .finish_cancelled(handle.id, "CSV export cancelled")
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Failed(error) | ExportTaskError::DatabaseFailed(error)) => {
                if let Ok(task) = manager
                    .finish_failed(handle.id, format!("CSV export failed: {error}"))
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
        }
    });

    emit_task_update(&app, &task);
    Ok(task)
}

#[tauri::command]
pub async fn export_query_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryCsvInput,
) -> Result<TaskInfo, AppError> {
    let driver_type = state
        .config_store
        .get_connection(input.connection_id)?
        .map(|connection| connection.driver_type)
        .ok_or_else(|| AppError::NotFound {
            resource: "connection".to_string(),
            id: input.connection_id.to_string(),
        })?;
    let operation = begin_query_export_operation(&state, &input).await?;
    let path = PathBuf::from(&input.path);
    let staged_path = staged_export_path(&path)?;
    cleanup_stale_export_parts(&path, STALE_EXPORT_PART_AGE).await;
    let manager = state.task_manager.clone();
    let task = manager
        .create_task_with_output(
            "export.csv.query",
            &format!("Export CSV: {}", display_file_name(&path)),
            None,
            Some(path.display().to_string()),
        )
        .await;
    let handle = manager.handle(task.id).await?;
    let app_for_task = app.clone();

    tokio::spawn(async move {
        if let Ok(task) = manager
            .start_task(handle.id, "Starting query CSV export")
            .await
        {
            emit_task_update(&app_for_task, &task);
        }
        let result = async {
            let operation = Arc::new(wait_query_export_operation(operation, &handle).await?);
            let context = crate::commands::query::apply_execution_context(
                operation.driver(),
                driver_type,
                input.database.as_deref(),
                input.schema.as_deref(),
            )
            .await
            .map_err(|message| ExportTaskError::DatabaseFailed(AppError::ConfigError(message)));
            let result = match context {
                Ok(()) => {
                    write_streamed_query_csv(
                        &input,
                        operation.clone(),
                        &staged_path,
                        &manager,
                        &handle,
                    )
                    .await
                }
                Err(error) => Err(error),
            };
            if matches!(result, Err(ExportTaskError::DatabaseFailed(_))) {
                if let Some(console_id) = input.console_id.as_deref() {
                    // Keep the Console operation lease until its failed phase is recorded.
                    mark_console_export_failed(&app_for_task, input.connection_id, console_id)
                        .await;
                }
            }
            finalize_staged_export(result, &staged_path, &path).await
        }
        .await;
        match result {
            Ok(report) => {
                if let Ok(task) = manager
                    .finish_success(
                        handle.id,
                        format!(
                            "Exported {} rows to {} ({} bytes)",
                            report.row_count, report.path, report.bytes_written,
                        ),
                    )
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Cancelled) => {
                if let Ok(task) = manager
                    .finish_cancelled(handle.id, "CSV export cancelled")
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::DatabaseFailed(error)) => {
                if let Ok(task) = manager
                    .finish_failed(handle.id, format!("CSV export failed: {error}"))
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Failed(error)) => {
                if let Ok(task) = manager
                    .finish_failed(handle.id, format!("CSV export failed: {error}"))
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
        }
    });
    emit_task_update(&app, &task);
    Ok(task)
}

#[tauri::command]
pub async fn export_table_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    mut input: ExportTableCsvInput,
) -> Result<TaskInfo, AppError> {
    input.driver_type = resolve_connection_sql_dialect(
        &state.config_store,
        input.connection_id,
        input.driver_type,
    )?;
    let operation = begin_csv_operation(&state, input.connection_id).await?;
    let path = PathBuf::from(&input.path);
    let staged_path = staged_export_path(&path)?;
    cleanup_stale_export_parts(&path, STALE_EXPORT_PART_AGE).await;
    let manager = state.task_manager.clone();
    let task = manager
        .create_task_with_output(
            "export.csv.table",
            &format!("Export table CSV: {}", display_file_name(&path)),
            input.max_rows,
            Some(path.display().to_string()),
        )
        .await;
    let handle = manager.handle(task.id).await?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Ok(task) = manager
            .start_task(handle.id, "Starting table CSV export")
            .await
        {
            emit_task_update(&app_for_task, &task);
        }

        let result = async {
            let operation = Arc::new(wait_csv_operation(operation, &handle).await?);
            let columns = operation
                .driver
                .get_columns(&input.schema, &input.table)
                .await?;
            let result =
                write_table_csv(&input, operation, columns, &staged_path, &manager, &handle).await;
            finalize_staged_export(result, &staged_path, &path).await
        }
        .await;
        match result {
            Ok(report) => {
                if let Ok(task) = manager
                    .finish_success(
                        handle.id,
                        format!(
                            "Exported {} rows to {} ({} bytes)",
                            report.row_count, report.path, report.bytes_written
                        ),
                    )
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Cancelled) => {
                if let Ok(task) = manager
                    .finish_cancelled(handle.id, "Table CSV export cancelled")
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Failed(error) | ExportTaskError::DatabaseFailed(error)) => {
                if let Ok(task) = manager
                    .finish_failed(handle.id, format!("Table CSV export failed: {error}"))
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
        }
    });

    emit_task_update(&app, &task);
    Ok(task)
}

#[tauri::command]
pub async fn preview_table_csv_import(
    state: State<'_, AppState>,
    input: PreviewTableCsvImportInput,
) -> Result<ImportPreview, AppError> {
    let registration = if let Some(task_id) = input.task_id {
        Some(
            state
                .task_manager
                .register_scoped_task(task_id, "preview.csv.import", "Preview CSV import")
                .await?,
        )
    } else {
        None
    };
    let result = preview_table_csv_import_inner(
        &state,
        &input,
        registration.as_ref().map(|task| task.handle()),
    )
    .await;
    if let Some(registration) = registration {
        registration.cleanup().await;
    }
    match result {
        Ok(preview) => Ok(preview),
        Err(PreviewCsvError::Cancelled) => Ok(cancelled_import_preview(&input.path)),
        Err(PreviewCsvError::Failed(error)) => Err(error),
    }
}

async fn preview_table_csv_import_inner(
    state: &State<'_, AppState>,
    input: &PreviewTableCsvImportInput,
    handle: Option<&TaskHandle>,
) -> Result<ImportPreview, PreviewCsvError> {
    ensure_preview_not_cancelled(handle)?;
    let operation = begin_csv_operation(state, input.connection_id)
        .await?
        .wait()
        .await?;
    ensure_preview_not_cancelled(handle)?;
    let columns = operation
        .driver
        .get_columns(&input.schema, &input.table)
        .await?;
    ensure_preview_not_cancelled(handle)?;
    preview_csv_import_with_cancel(input, &columns, handle).await
}

#[tauri::command]
pub async fn import_table_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    mut input: ImportTableCsvInput,
) -> Result<TaskInfo, AppError> {
    input.driver_type = resolve_connection_sql_dialect(
        &state.config_store,
        input.connection_id,
        input.driver_type,
    )?;
    let operation = begin_csv_operation(&state, input.connection_id)
        .await?
        .wait()
        .await?;
    let columns = operation
        .driver
        .get_columns(&input.schema, &input.table)
        .await?;
    let path = PathBuf::from(&input.path);
    let manager = state.task_manager.clone();
    let preview = preview_csv_import(
        &PreviewTableCsvImportInput {
            connection_id: input.connection_id,
            schema: input.schema.clone(),
            table: input.table.clone(),
            path: input.path.clone(),
            has_header: input.has_header,
            delimiter: input.delimiter.clone(),
            mapping: input.mapping.clone(),
            empty_as_null: input.empty_as_null,
            preview_rows: Some(IMPORT_PREVIEW_ROWS),
            sample_only: false,
            task_id: None,
        },
        &columns,
    )
    .await?;
    resolve_csv_mapping(
        &preview.headers,
        &preview.target_columns,
        input.mapping.as_deref(),
    )?;
    if !preview.can_import {
        return Err(AppError::ConfigError(
            "CSV has no valid importable rows; fix the column mapping or row errors first".into(),
        ));
    }
    let task = manager
        .create_task(
            "import.csv.table",
            &format!("Import CSV: {}", display_file_name(&path)),
            Some(preview.total_rows),
        )
        .await;
    let handle = manager.handle(task.id).await?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Ok(task) = manager
            .start_task(handle.id, "Starting table CSV import")
            .await
        {
            emit_task_update(&app_for_task, &task);
        }

        let result = import_csv_rows(&input, operation, columns, &manager, &handle).await;
        match result {
            Ok(report) => {
                remember_csv_report(handle.id, &report);
                let failed = report.invalid_row_count + report.failed_write_count;
                let message = if failed == 0 {
                    format!(
                        "Imported {} rows into {}",
                        report.inserted_rows, report.table
                    )
                } else {
                    format!(
                        "Imported {} rows into {}; {} rows failed",
                        report.inserted_rows, report.table, failed
                    )
                };
                if let Ok(task) = manager.finish_success(handle.id, message).await {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Cancelled) => {
                if let Ok(task) = manager
                    .finish_cancelled(handle.id, "Table CSV import cancelled")
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
            Err(ExportTaskError::Failed(error) | ExportTaskError::DatabaseFailed(error)) => {
                if let Ok(task) = manager
                    .finish_failed(handle.id, format!("Table CSV import failed: {error}"))
                    .await
                {
                    emit_task_update(&app_for_task, &task);
                }
            }
        }
    });

    emit_task_update(&app, &task);
    Ok(task)
}

#[derive(Debug)]
enum ExportTaskError {
    Cancelled,
    Failed(AppError),
    DatabaseFailed(AppError),
}

fn staged_export_path(final_path: &Path) -> Result<PathBuf, AppError> {
    final_path.file_name().ok_or_else(|| {
        AppError::ConfigError("CSV export path must include a file name".to_string())
    })?;
    let staged_name = format!("{EXPORT_PART_PREFIX}{}{EXPORT_PART_SUFFIX}", Uuid::new_v4());
    Ok(final_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(staged_name))
}

async fn cleanup_stale_export_parts(final_path: &Path, minimum_age: Duration) {
    let directory = final_path.parent().unwrap_or_else(|| Path::new("."));
    let Ok(mut entries) = tokio::fs::read_dir(directory).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(id) = name
            .strip_prefix(EXPORT_PART_PREFIX)
            .and_then(|value| value.strip_suffix(EXPORT_PART_SUFFIX))
        else {
            continue;
        };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        let is_stale = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= minimum_age);
        if is_stale && metadata.is_file() {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

async fn finalize_staged_export(
    result: Result<ExportReport, ExportTaskError>,
    staged_path: &Path,
    final_path: &Path,
) -> Result<ExportReport, ExportTaskError> {
    match result {
        Ok(mut report) => {
            // A same-directory hard link publishes the complete staged inode
            // atomically and fails consistently when the destination exists.
            // Plain rename would replace on Unix but commonly fail on Windows.
            if let Err(error) = tokio::fs::hard_link(staged_path, final_path).await {
                let _ = tokio::fs::remove_file(staged_path).await;
                return Err(ExportTaskError::Failed(AppError::from(error)));
            }
            let _ = tokio::fs::remove_file(staged_path).await;
            report.path = final_path.to_string_lossy().to_string();
            Ok(report)
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(staged_path).await;
            Err(error)
        }
    }
}

impl From<AppError> for ExportTaskError {
    fn from(value: AppError) -> Self {
        Self::Failed(value)
    }
}

async fn mark_console_export_failed(app: &AppHandle, connection_id: Uuid, console_id: &str) {
    let state = app.state::<AppState>();
    let transaction = {
        let mut connections = state.connection_manager.lock().await;
        connections.set_console_phase(connection_id, console_id, ConsoleTransactionPhase::Failed);
        connections.console_transaction_state(connection_id, console_id)
    };
    let _ = app.emit(CONSOLE_TRANSACTION_UPDATED_EVENT, transaction);
}

async fn begin_csv_operation(
    state: &State<'_, AppState>,
    connection_id: Uuid,
) -> Result<QueryOperationStart, AppError> {
    state
        .connection_manager
        .lock()
        .await
        .begin_query_operation(connection_id, &format!("csv-operation-{}", Uuid::new_v4()))
}

enum QueryExportOperationStart {
    Auto(QueryOperationStart),
    Console(ConsoleOperation),
}

enum QueryExportOperation {
    Auto(QueryOperation),
    Console(ConsoleOperation),
}

impl QueryExportOperation {
    fn driver(&self) -> Arc<dyn crate::drivers::trait_def::DatabaseDriver> {
        match self {
            Self::Auto(operation) => operation.driver.clone(),
            Self::Console(operation) => operation.driver.clone(),
        }
    }
}

async fn begin_query_export_operation(
    state: &State<'_, AppState>,
    input: &ExportQueryCsvInput,
) -> Result<QueryExportOperationStart, AppError> {
    let mut connections = state.connection_manager.lock().await;
    let current_generation = connections.connection_generation(input.connection_id)?;
    validate_query_export_generation(current_generation, input.connection_generation)?;
    if let Some(console_id) = input.console_id.as_deref() {
        let operation = connections.begin_console_operation(
            input.connection_id,
            console_id,
            Some(&format!("query-export-{}", Uuid::new_v4())),
        )?;
        validate_query_export_transaction(operation.phase)?;
        return Ok(QueryExportOperationStart::Console(operation));
    }
    connections
        .begin_query_operation(
            input.connection_id,
            &format!("csv-operation-{}", Uuid::new_v4()),
        )
        .map(QueryExportOperationStart::Auto)
}

fn validate_query_export_generation(current: u64, expected: u64) -> Result<(), AppError> {
    if current == expected {
        return Ok(());
    }
    Err(AppError::ConfigError(
        "the original query connection session is no longer available".to_string(),
    ))
}

fn validate_query_export_transaction(phase: ConsoleTransactionPhase) -> Result<(), AppError> {
    if phase == ConsoleTransactionPhase::Active {
        return Ok(());
    }
    Err(AppError::ConfigError(
        "the original transaction is no longer active; full export was not started".to_string(),
    ))
}

async fn wait_query_export_operation(
    operation: QueryExportOperationStart,
    handle: &TaskHandle,
) -> Result<QueryExportOperation, ExportTaskError> {
    let operation = match operation {
        QueryExportOperationStart::Auto(operation) => {
            QueryExportOperation::Auto(wait_csv_operation(operation, handle).await?)
        }
        QueryExportOperationStart::Console(operation) => {
            if handle.is_cancel_requested() {
                return Err(ExportTaskError::Cancelled);
            }
            QueryExportOperation::Console(operation)
        }
    };
    Ok(operation)
}

async fn wait_csv_operation(
    operation: QueryOperationStart,
    handle: &TaskHandle,
) -> Result<QueryOperation, ExportTaskError> {
    tokio::select! {
        biased;
        _ = handle.cancelled() => Err(ExportTaskError::Cancelled),
        result = operation.wait() => result.map_err(Into::into),
    }
}

struct ExportQueryTask(JoinHandle<Result<QueryStreamSummary, AppError>>);

impl Drop for ExportQueryTask {
    fn drop(&mut self) {
        // Dropping an export future must not detach its query worker.
        self.0.abort();
    }
}

async fn run_export_stream<T>(
    handle: &TaskHandle,
    query: impl Future<Output = Result<QueryStreamSummary, AppError>> + Send + 'static,
    write: impl Future<Output = Result<T, ExportTaskError>>,
    cancel_query: impl Future<Output = Result<(), AppError>>,
    shutdown_timeout: Duration,
) -> Result<(T, QueryStreamSummary), ExportTaskError> {
    if handle.is_cancel_requested() {
        return Err(ExportTaskError::Cancelled);
    }
    let mut query_task = ExportQueryTask(tokio::spawn(query));
    let result = {
        let work = async {
            let output = write.await?;
            let summary = (&mut query_task.0)
                .await
                .map_err(|error| ExportTaskError::Failed(AppError::ConfigError(error.to_string())))?
                .map_err(ExportTaskError::DatabaseFailed)?;
            Ok((output, summary))
        };
        tokio::select! {
            biased;
            _ = handle.cancelled() => Err(ExportTaskError::Cancelled),
            result = work => result,
        }
    };
    // The writing future (including its receiver) has now been dropped. This
    // releases a producer blocked on a full channel before driver cancellation.
    if result.is_err() && !query_task.0.is_finished() {
        let _ = timeout(shutdown_timeout, cancel_query).await;
        if timeout(shutdown_timeout, &mut query_task.0).await.is_err() {
            query_task.0.abort();
            let _ = (&mut query_task.0).await;
        }
    }
    result
}

async fn write_table_csv(
    input: &ExportTableCsvInput,
    operation: Arc<QueryOperation>,
    columns: Vec<ColumnInfo>,
    path: &PathBuf,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ExportReport, ExportTaskError> {
    let driver = operation.driver.clone();
    if handle.is_cancel_requested() {
        return Err(ExportTaskError::Cancelled);
    }
    let selected_columns = export_column_names(&columns)?;
    let file = File::create(path).await.map_err(AppError::from)?;
    let mut writer = BufWriter::new(file);
    let mut bytes_written = 0_u64;
    let mut wrote_any = false;
    if input.include_header {
        bytes_written += write_csv_line(
            &mut writer,
            selected_columns.iter().map(|name| csv_cell(name)).collect(),
            false,
        )
        .await
        .map_err(AppError::from)?;
        wrote_any = true;
    }

    let sql = format!(
        "SELECT {} FROM {}",
        selected_columns
            .iter()
            .map(|column| quote_identifier(input.driver_type, column))
            .collect::<Vec<_>>()
            .join(", "),
        qualified_table(input.driver_type, &input.schema, &input.table)
    );
    let query_id = format!("table-export-{}", handle.id);
    let (tx, mut rx) = mpsc::channel::<Result<QueryResultChunk, AppError>>(4);
    let driver_for_query = driver.clone();
    let sql_for_query = sql.clone();
    let query_id_for_query = query_id.clone();
    let max_rows = input.max_rows;
    let operation_for_query = operation.clone();
    let query = async move {
        let _operation = operation_for_query;
        driver_for_query
            .execute_query_stream(
                &sql_for_query,
                &query_id_for_query,
                TABLE_EXPORT_CHUNK_SIZE,
                max_rows,
                tx,
            )
            .await
    };

    let write = async move {
        let mut row_count = 0_u64;
        while let Some(chunk) = rx.recv().await {
            let chunk = chunk.map_err(ExportTaskError::DatabaseFailed)?;
            for row in chunk.rows {
                bytes_written += write_csv_line(
                    &mut writer,
                    (0..selected_columns.len())
                        .map(|index| csv_value(row.get(index)))
                        .collect(),
                    wrote_any,
                )
                .await
                .map_err(AppError::from)?;
                wrote_any = true;
                row_count += 1;
            }

            manager
                .update_progress(handle.id, row_count, format!("Exported {row_count} rows"))
                .await?;
            yield_now().await;
        }
        writer.flush().await.map_err(AppError::from)?;
        Ok(bytes_written)
    };
    let (bytes_written, summary) = run_export_stream(
        handle,
        query,
        write,
        driver.cancel_query(&query_id),
        EXPORT_CANCEL_TIMEOUT,
    )
    .await?;

    Ok(ExportReport {
        path: path.to_string_lossy().to_string(),
        row_count: summary.row_count,
        bytes_written,
    })
}

async fn write_streamed_query_csv(
    input: &ExportQueryCsvInput,
    operation: Arc<QueryExportOperation>,
    path: &PathBuf,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ExportReport, ExportTaskError> {
    let driver = operation.driver();
    if handle.is_cancel_requested() {
        return Err(ExportTaskError::Cancelled);
    }
    let file = File::create(path).await.map_err(AppError::from)?;
    let mut writer = BufWriter::new(file);
    let query_id = format!("query-export-{}", handle.id);
    let (tx, mut rx) = mpsc::channel::<Result<QueryResultChunk, AppError>>(4);
    let query_driver = driver.clone();
    let sql = input.sql.clone();
    let query_id_for_task = query_id.clone();
    let operation_for_query = operation.clone();
    let query = async move {
        let _operation = operation_for_query;
        query_driver
            .execute_query_stream(&sql, &query_id_for_task, TABLE_EXPORT_CHUNK_SIZE, None, tx)
            .await
    };
    let write = async move {
        let mut bytes_written = 0_u64;
        let mut row_count = 0_u64;
        let mut wrote_any = false;
        let mut column_count = 0_usize;

        while let Some(chunk) = rx.recv().await {
            let chunk = chunk.map_err(ExportTaskError::DatabaseFailed)?;
            if column_count == 0 {
                column_count = chunk.columns.len();
                if input.include_header && !chunk.columns.is_empty() {
                    bytes_written += write_csv_line(
                        &mut writer,
                        chunk
                            .columns
                            .iter()
                            .map(|column| csv_cell(&column.name))
                            .collect(),
                        false,
                    )
                    .await
                    .map_err(AppError::from)?;
                    wrote_any = true;
                }
            }
            for row in chunk.rows {
                bytes_written += write_csv_line(
                    &mut writer,
                    (0..column_count)
                        .map(|index| csv_value(row.get(index)))
                        .collect(),
                    wrote_any,
                )
                .await
                .map_err(AppError::from)?;
                wrote_any = true;
                row_count += 1;
            }
            manager
                .update_progress(handle.id, row_count, format!("Exported {row_count} rows"))
                .await?;
            yield_now().await;
        }
        writer.flush().await.map_err(AppError::from)?;
        Ok(bytes_written)
    };
    let (bytes_written, summary) = run_export_stream(
        handle,
        query,
        write,
        driver.cancel_query(&query_id),
        EXPORT_CANCEL_TIMEOUT,
    )
    .await?;
    Ok(ExportReport {
        path: path.to_string_lossy().to_string(),
        row_count: summary.row_count,
        bytes_written,
    })
}

async fn preview_csv_import(
    input: &PreviewTableCsvImportInput,
    columns: &[ColumnInfo],
) -> Result<ImportPreview, AppError> {
    let file = File::open(&input.path).await?;
    preview_csv_reader(input, file, require_importable_column_names(columns)?).await
}

#[derive(Debug)]
enum PreviewCsvError {
    Cancelled,
    Failed(AppError),
}

impl From<AppError> for PreviewCsvError {
    fn from(value: AppError) -> Self {
        Self::Failed(value)
    }
}

fn ensure_preview_not_cancelled(handle: Option<&TaskHandle>) -> Result<(), PreviewCsvError> {
    if handle.is_some_and(TaskHandle::is_cancel_requested) {
        Err(PreviewCsvError::Cancelled)
    } else {
        Ok(())
    }
}

fn cancelled_import_preview(path: &str) -> ImportPreview {
    ImportPreview {
        path: path.to_string(),
        headers: Vec::new(),
        target_columns: Vec::new(),
        rows: Vec::new(),
        total_rows: 0,
        valid_rows: 0,
        invalid_rows: Vec::new(),
        can_import: false,
        cancelled: true,
        has_more: false,
    }
}

async fn preview_csv_import_with_cancel(
    input: &PreviewTableCsvImportInput,
    columns: &[ColumnInfo],
    handle: Option<&TaskHandle>,
) -> Result<ImportPreview, PreviewCsvError> {
    ensure_preview_not_cancelled(handle)?;
    let file = File::open(&input.path).await.map_err(AppError::from)?;
    preview_csv_reader_with_cancel(
        input,
        file,
        require_importable_column_names(columns)?,
        handle,
    )
    .await
}

async fn preview_csv_reader<R: AsyncRead + Unpin>(
    input: &PreviewTableCsvImportInput,
    reader: R,
    target_columns: Vec<String>,
) -> Result<ImportPreview, AppError> {
    preview_csv_reader_with_cancel(input, reader, target_columns, None)
        .await
        .map_err(|error| match error {
            PreviewCsvError::Failed(error) => error,
            PreviewCsvError::Cancelled => {
                AppError::ConfigError("CSV preview cancelled unexpectedly".into())
            }
        })
}

async fn preview_csv_reader_with_cancel<R: AsyncRead + Unpin>(
    input: &PreviewTableCsvImportInput,
    reader: R,
    target_columns: Vec<String>,
    handle: Option<&TaskHandle>,
) -> Result<ImportPreview, PreviewCsvError> {
    ensure_preview_not_cancelled(handle)?;
    let mut reader = CsvRecordReader::new(reader, IMPORT_MAX_RECORD_BYTES)
        .with_delimiter(input.delimiter.as_deref())?;
    let first = reader.next_row().await?;
    let headers = match &first {
        Some(row) if input.has_header => row.clone(),
        Some(row) if input.mapping.is_some() => {
            (1..=row.len()).map(|i| format!("Column {i}")).collect()
        }
        Some(_) => target_columns.clone(),
        None => Vec::new(),
    };
    let sample_limit = input.preview_rows.unwrap_or(IMPORT_PREVIEW_ROWS).min(100);
    // Header reports clone the entire header and may include a column name in
    // the message. Reserve a conservative per-report budget before cloning.
    let header_report_bytes = row_storage_bytes(&headers) * 2 + 256;
    let header_report_limit = sample_limit.min(IMPORT_PREVIEW_SAMPLE_BYTES / header_report_bytes);
    let validation = if input.mapping.is_some() {
        ImportValidation {
            reports: Vec::new(),
            header_invalid: false,
            invalid_data_rows: 0,
        }
    } else {
        validate_import_rows_sampled(&headers, &[], 1, &target_columns, header_report_limit)
    };
    debug_assert_eq!(validation.invalid_data_rows, 0);
    let mut error_bytes_left =
        IMPORT_PREVIEW_SAMPLE_BYTES - validation.reports.len() * header_report_bytes;
    let mut row_bytes_left = IMPORT_PREVIEW_SAMPLE_BYTES;
    let mut preview = ImportPreview {
        path: input.path.clone(),
        headers,
        target_columns,
        rows: Vec::new(),
        total_rows: 0,
        valid_rows: 0,
        invalid_rows: validation.reports,
        can_import: false,
        cancelled: false,
        has_more: false,
    };
    let mut next = if input.has_header {
        reader.next_row().await?
    } else {
        first
    };
    while let Some(row) = next {
        if input.sample_only && !preview.rows.is_empty() && row_storage_bytes(&row) > row_bytes_left
        {
            preview.has_more = true;
            break;
        }
        preview.total_rows += 1;
        if row.len() == preview.headers.len() {
            if !validation.header_invalid {
                preview.valid_rows += 1;
            }
        } else if preview.invalid_rows.len() < sample_limit {
            let message = format!(
                "Expected {} fields, found {}",
                preview.headers.len(),
                row.len()
            );
            let bytes = row_storage_bytes(&row) + message.len();
            if bytes <= error_bytes_left {
                error_bytes_left -= bytes;
                preview.invalid_rows.push(RowReport {
                    row_number: preview.total_rows + u64::from(input.has_header),
                    message,
                    values: row.clone(),
                });
            }
        }
        let row_bytes = row_storage_bytes(&row);
        if preview.rows.len() < sample_limit && row_bytes <= row_bytes_left {
            row_bytes_left -= row_bytes;
            preview.rows.push(row);
        }
        if preview.total_rows.is_multiple_of(100) {
            yield_now().await;
            ensure_preview_not_cancelled(handle)?;
        }
        next = reader.next_row().await?;
        if input.sample_only && preview.total_rows >= sample_limit.max(1) as u64 {
            preview.has_more = next.is_some();
            break;
        }
    }
    preview.can_import = preview.valid_rows > 0;
    Ok(preview)
}

// Estimate retained strings plus vector growth headroom, not process RSS.
fn row_storage_bytes(row: &[String]) -> usize {
    std::mem::size_of_val(row) * 2 + row.iter().map(String::capacity).sum::<usize>()
}

#[cfg(test)]
fn build_import_preview(
    input: &PreviewTableCsvImportInput,
    parsed: Vec<Vec<String>>,
    target_columns: Vec<String>,
) -> ImportPreview {
    let (headers, rows, first_data_row) =
        csv_headers_and_rows(parsed, input.has_header, &target_columns);
    let sample_limit = input.preview_rows.unwrap_or(IMPORT_PREVIEW_ROWS).min(100);
    let validation = validate_import_rows_sampled(
        &headers,
        &rows,
        first_data_row,
        &target_columns,
        sample_limit,
    );
    let total_rows = rows.len() as u64;
    let valid_rows = if validation.header_invalid {
        0
    } else {
        total_rows.saturating_sub(validation.invalid_data_rows)
    };

    ImportPreview {
        path: input.path.clone(),
        headers,
        target_columns,
        rows: rows.into_iter().take(sample_limit).collect(),
        total_rows,
        valid_rows,
        invalid_rows: validation.reports,
        can_import: valid_rows > 0,
        cancelled: false,
        has_more: false,
    }
}

async fn import_csv_rows(
    input: &ImportTableCsvInput,
    operation: QueryOperation,
    columns: Vec<ColumnInfo>,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ImportReport, ExportTaskError> {
    ensure_import_active(handle)?;
    // Imports are a single logical write job.  Keep the connection in an
    // explicit transaction while the two-pass validation/write pipeline runs
    // so cancellation or an unrecoverable write error cannot leave an
    // unreported prefix of the file committed.  Row-level errors are still
    // collected by the inner function and intentionally produce a partial
    // success report; callers can decide whether that policy is acceptable.
    let driver = operation.driver.clone();
    if !driver.supports_parameterized_import() {
        return Err(AppError::UnsupportedOperation {
            driver: driver.driver_name().to_string(),
            operation: "parameterized CSV import".to_string(),
        }
        .into());
    }
    driver
        .begin_transaction()
        .await
        .map_err(ExportTaskError::from)?;

    let result = import_csv_rows_in_transaction(input, &operation, columns, manager, handle).await;
    match result {
        Ok(report) => {
            if handle.is_cancel_requested() {
                let _ = driver.rollback_transaction().await;
                return Err(ExportTaskError::Cancelled);
            }
            if let Err(error) = driver.commit_transaction().await {
                let _ = driver.rollback_transaction().await;
                Err(ExportTaskError::from(error))
            } else {
                Ok(report)
            }
        }
        Err(error) => {
            // Rollback is best effort here: preserve the original parse,
            // cancellation, or driver error for the task report.
            let _ = driver.rollback_transaction().await;
            Err(error)
        }
    }
}

fn ensure_import_active(handle: &TaskHandle) -> Result<(), ExportTaskError> {
    if handle.is_cancel_requested() {
        Err(ExportTaskError::Cancelled)
    } else {
        Ok(())
    }
}

async fn import_csv_rows_in_transaction(
    input: &ImportTableCsvInput,
    operation: &QueryOperation,
    columns: Vec<ColumnInfo>,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ImportReport, ExportTaskError> {
    if handle.is_cancel_requested() {
        return Err(ExportTaskError::Cancelled);
    }
    let driver = operation.driver.clone();
    let target_columns = require_importable_column_names(&columns)?;
    let file_snapshot = import_file_snapshot(Path::new(&input.path)).await?;
    let file = File::open(&input.path).await.map_err(AppError::from)?;
    let mut reader = CsvRecordReader::new(file, IMPORT_MAX_RECORD_BYTES)
        .with_delimiter(input.delimiter.as_deref())?;
    let first = reader
        .next_row_checked(|| ensure_import_active(handle))
        .await?;
    let headers = match &first {
        Some(row) if input.has_header => row.clone(),
        Some(row) if input.mapping.is_some() => {
            (1..=row.len()).map(|i| format!("Column {i}")).collect()
        }
        Some(_) | None => target_columns.clone(),
    };
    let source_width = headers.len();
    let first_data_row = if input.has_header { 2 } else { 1 };
    let mapping = resolve_csv_mapping(&headers, &target_columns, input.mapping.as_deref())?;
    let import_columns: Vec<String> = mapping.iter().map(|(_, name)| name.clone()).collect();
    let mut invalid_rows = BoundedRowReports::default();
    let table = qualified_table(input.driver_type, &input.schema, &input.table);
    let mut total_rows = 0_u64;
    let mut next = if input.has_header {
        reader
            .next_row_checked(|| ensure_import_active(handle))
            .await?
    } else {
        first
    };

    while let Some(row) = next {
        total_rows += 1;
        let row_number = first_data_row + total_rows - 1;
        if handle.is_cancel_requested() {
            return Err(ExportTaskError::Cancelled);
        }

        if row.len() != source_width {
            invalid_rows.push(RowReport {
                row_number,
                message: format!("Expected {} fields, found {}", source_width, row.len()),
                values: row,
            });
        }
        if total_rows.is_multiple_of(100) {
            yield_now().await;
        }
        ensure_import_active(handle)?;
        next = reader
            .next_row_checked(|| ensure_import_active(handle))
            .await?;
    }

    // Validate the complete stream before the first database write. This
    // preserves the prior all-parse-first behavior without retaining every
    // valid row in memory when a malformed quoted record occurs near EOF.
    ensure_import_file_unchanged(Path::new(&input.path), &file_snapshot).await?;
    // Metadata checks during the scan are cheap and catch normal rewrites.
    // Before the first write, also compare the content hash so an in-place
    // rewrite that preserves length and mtime cannot be imported silently.
    ensure_import_file_content_unchanged(Path::new(&input.path), &file_snapshot).await?;
    ensure_import_active(handle)?;
    let mut file = reader.into_inner();
    file.seek(SeekFrom::Start(0))
        .await
        .map_err(AppError::from)?;
    let mut reader = CsvRecordReader::new(file, IMPORT_MAX_RECORD_BYTES)
        .with_delimiter(input.delimiter.as_deref())?;
    if input.has_header {
        reader
            .next_row_checked(|| ensure_import_active(handle))
            .await?;
    }
    let mut inserted_rows = 0_u64;
    let mut failed_writes = BoundedRowReports::default();
    let mut current = 0_u64;
    let supports_multi_row_insert = matches!(
        input.driver_type,
        DriverType::Postgres | DriverType::Mysql | DriverType::Sqlite | DriverType::Mssql
    );
    if import_columns.len() > IMPORT_MAX_PARAMETERS {
        return Err(AppError::ConfigError(format!(
            "CSV target has {} columns, exceeding the {} parameter limit",
            import_columns.len(),
            IMPORT_MAX_PARAMETERS
        ))
        .into());
    }
    let max_parameter_rows = (IMPORT_MAX_PARAMETERS / import_columns.len().max(1)).max(1);
    let mut batch: Vec<(u64, Vec<String>)> = Vec::with_capacity(IMPORT_BATCH_SIZE);
    let mut batch_bytes = 0_usize;

    #[allow(clippy::too_many_arguments)]
    async fn flush_import_batch(
        driver: &Arc<dyn crate::drivers::trait_def::DatabaseDriver>,
        driver_type: DriverType,
        table: &str,
        columns: &[String],
        empty_as_null: bool,
        batch: &mut Vec<(u64, Vec<String>)>,
        handle: &TaskHandle,
        failed_writes: &mut BoundedRowReports,
        inserted_rows: &mut u64,
    ) -> Result<(), ExportTaskError> {
        ensure_import_active(handle)?;
        if batch.is_empty() {
            return Ok(());
        }
        let query_id = format!("table-import-{}", handle.id);
        let (sql, params) = build_parameterized_insert_batch_sql_checked(
            driver_type,
            table,
            columns,
            batch,
            empty_as_null,
            || ensure_import_active(handle),
        )?;
        let postgres = driver_type == DriverType::Postgres;
        if postgres {
            driver
                .execute_query("SAVEPOINT vaporlensdb_csv_batch", Some(&query_id))
                .await
                .map_err(ExportTaskError::DatabaseFailed)?;
        }
        ensure_import_active(handle)?;
        let batch_result = driver
            .execute_parameterized(&sql, &params, Some(&query_id))
            .await;
        ensure_import_active(handle)?;
        if batch_result.is_ok() {
            if postgres {
                driver
                    .execute_query("RELEASE SAVEPOINT vaporlensdb_csv_batch", Some(&query_id))
                    .await
                    .map_err(ExportTaskError::DatabaseFailed)?;
            }
            ensure_import_active(handle)?;
            *inserted_rows += batch.len() as u64;
        } else {
            if postgres {
                driver
                    .execute_query(
                        "ROLLBACK TO SAVEPOINT vaporlensdb_csv_batch",
                        Some(&query_id),
                    )
                    .await
                    .map_err(ExportTaskError::DatabaseFailed)?;
                driver
                    .execute_query("RELEASE SAVEPOINT vaporlensdb_csv_batch", Some(&query_id))
                    .await
                    .map_err(ExportTaskError::DatabaseFailed)?;
            }
            for (row_number, row) in batch.drain(..) {
                if handle.is_cancel_requested() {
                    return Err(ExportTaskError::Cancelled);
                }
                if postgres {
                    driver
                        .execute_query("SAVEPOINT vaporlensdb_csv_row", Some(&query_id))
                        .await
                        .map_err(ExportTaskError::DatabaseFailed)?;
                }
                let (sql, params) = build_parameterized_insert_sql_checked(
                    driver_type,
                    table,
                    columns,
                    &row,
                    empty_as_null,
                    || ensure_import_active(handle),
                )?;
                ensure_import_active(handle)?;
                let row_result = driver
                    .execute_parameterized(&sql, &params, Some(&query_id))
                    .await;
                ensure_import_active(handle)?;
                match row_result {
                    Ok(_) => {
                        if postgres {
                            driver
                                .execute_query(
                                    "RELEASE SAVEPOINT vaporlensdb_csv_row",
                                    Some(&query_id),
                                )
                                .await
                                .map_err(ExportTaskError::DatabaseFailed)?;
                        }
                        ensure_import_active(handle)?;
                        *inserted_rows += 1;
                    }
                    Err(error) => {
                        if postgres {
                            driver
                                .execute_query(
                                    "ROLLBACK TO SAVEPOINT vaporlensdb_csv_row",
                                    Some(&query_id),
                                )
                                .await
                                .map_err(ExportTaskError::DatabaseFailed)?;
                            driver
                                .execute_query(
                                    "RELEASE SAVEPOINT vaporlensdb_csv_row",
                                    Some(&query_id),
                                )
                                .await
                                .map_err(ExportTaskError::DatabaseFailed)?;
                        }
                        ensure_import_active(handle)?;
                        failed_writes.push(RowReport {
                            row_number,
                            message: csv_row_error(&error, &row),
                            values: row,
                        });
                    }
                }
            }
            return Ok(());
        }
        batch.clear();
        ensure_import_active(handle)?;
        Ok(())
    }

    while let Some(row) = reader
        .next_row_checked(|| ensure_import_active(handle))
        .await?
    {
        current += 1;
        if handle.is_cancel_requested() {
            return Err(ExportTaskError::Cancelled);
        }
        if current == 1 || current.is_multiple_of(100) {
            ensure_import_file_unchanged(Path::new(&input.path), &file_snapshot).await?;
        }
        if row.len() == source_width {
            let row: Vec<String> = mapping
                .iter()
                .map(|(index, _)| row[*index].clone())
                .collect();
            let row_number = first_data_row + current - 1;
            if supports_multi_row_insert {
                batch_bytes = batch_bytes.saturating_add(row_storage_bytes(&row));
                batch.push((row_number, row));
                if batch.len() >= IMPORT_BATCH_SIZE
                    || batch.len() >= max_parameter_rows
                    || batch_bytes >= IMPORT_BATCH_MAX_BYTES
                {
                    flush_import_batch(
                        &driver,
                        input.driver_type,
                        &table,
                        &import_columns,
                        input.empty_as_null,
                        &mut batch,
                        handle,
                        &mut failed_writes,
                        &mut inserted_rows,
                    )
                    .await?;
                    batch_bytes = 0;
                }
            } else {
                let (sql, params) = build_parameterized_insert_sql_checked(
                    input.driver_type,
                    &table,
                    &import_columns,
                    &row,
                    input.empty_as_null,
                    || ensure_import_active(handle),
                )?;
                ensure_import_active(handle)?;
                let row_result = driver
                    .execute_parameterized(
                        &sql,
                        &params,
                        Some(&format!("table-import-{}", handle.id)),
                    )
                    .await;
                ensure_import_active(handle)?;
                match row_result {
                    Ok(_) => inserted_rows += 1,
                    Err(error) => failed_writes.push(RowReport {
                        row_number,
                        message: csv_row_error(&error, &row),
                        values: row,
                    }),
                }
            }
        }
        if current == total_rows || current.is_multiple_of(100) {
            manager
                .update_progress(
                    handle.id,
                    current,
                    format!("Imported {inserted_rows} of {total_rows} rows"),
                )
                .await?;
        }
        if current.is_multiple_of(100) {
            yield_now().await;
        }
    }
    flush_import_batch(
        &driver,
        input.driver_type,
        &table,
        &import_columns,
        input.empty_as_null,
        &mut batch,
        handle,
        &mut failed_writes,
        &mut inserted_rows,
    )
    .await?;
    ensure_import_active(handle)?;

    let report_path = format!("{}.import-report.json", input.path);
    let report = ImportReport {
        path: report_path.clone(),
        table,
        total_rows,
        inserted_rows,
        invalid_row_count: invalid_rows.total,
        invalid_rows_omitted: invalid_rows.omitted(),
        invalid_rows: invalid_rows.reports,
        failed_write_count: failed_writes.total,
        failed_writes_omitted: failed_writes.omitted(),
        failed_writes: failed_writes.reports,
    };
    if report.invalid_row_count > 0 || report.failed_write_count > 0 {
        let content = serde_json::to_string_pretty(&report).map_err(AppError::from)?;
        ensure_import_active(handle)?;
        tokio::fs::write(&report_path, content)
            .await
            .map_err(AppError::from)?;
    }

    Ok(report)
}

async fn write_query_result_csv(
    result: &QueryResult,
    path: &PathBuf,
    include_header: bool,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ExportReport, ExportTaskError> {
    let file = File::create(path).await.map_err(AppError::from)?;
    let mut writer = BufWriter::new(file);
    let mut bytes_written = 0_u64;
    let mut wrote_any = false;

    if include_header {
        bytes_written += write_csv_line(
            &mut writer,
            result
                .columns
                .iter()
                .map(|column| csv_cell(&column.name))
                .collect(),
            false,
        )
        .await
        .map_err(AppError::from)?;
        wrote_any = true;
    }

    for (index, row) in result.rows.iter().enumerate() {
        if handle.is_cancel_requested() {
            return Err(ExportTaskError::Cancelled);
        }

        bytes_written += write_csv_line(
            &mut writer,
            (0..result.columns.len())
                .map(|column_index| csv_value(row.get(column_index)))
                .collect(),
            wrote_any,
        )
        .await
        .map_err(AppError::from)?;
        wrote_any = true;

        let current = index as u64 + 1;
        if current == result.rows.len() as u64 || current.is_multiple_of(500) {
            manager
                .update_progress(
                    handle.id,
                    current,
                    format!("Exported {current} of {} rows", result.rows.len()),
                )
                .await
                .map_err(ExportTaskError::from)?;
        }

        if current.is_multiple_of(500) {
            yield_now().await;
        }
    }

    writer.flush().await.map_err(AppError::from)?;
    Ok(ExportReport {
        path: path.to_string_lossy().to_string(),
        row_count: result.rows.len() as u64,
        bytes_written,
    })
}

// Buffer boundaries may split UTF-8, doubled quotes, or CRLF. Decode fields
// only after a complete logical record has been collected within its budget.
struct CsvRecordReader<R> {
    reader: BufReader<R>,
    skip_lf: bool,
    max_record_bytes: usize,
    delimiter: char,
    first_record: bool,
}

impl<R: AsyncRead + Unpin> CsvRecordReader<R> {
    fn new(reader: R, max_record_bytes: usize) -> Self {
        Self {
            reader: BufReader::new(reader),
            skip_lf: false,
            max_record_bytes,
            delimiter: ',',
            first_record: true,
        }
    }

    fn with_delimiter(mut self, delimiter: Option<&str>) -> Result<Self, AppError> {
        self.delimiter = csv_delimiter(delimiter)?;
        Ok(self)
    }

    fn into_inner(self) -> R {
        self.reader.into_inner()
    }

    async fn next_row(&mut self) -> Result<Option<Vec<String>>, AppError> {
        self.next_row_checked(|| Ok::<_, AppError>(())).await
    }

    async fn next_row_checked<Error: From<AppError>>(
        &mut self,
        mut check: impl FnMut() -> Result<(), Error>,
    ) -> Result<Option<Vec<String>>, Error> {
        let mut record = Vec::new();
        let mut in_quotes = false;
        loop {
            check()?;
            let available = self.reader.fill_buf().await.map_err(AppError::from)?;
            check()?;
            if available.is_empty() {
                if record.is_empty() {
                    return Ok(None);
                }
                break;
            }
            let mut consumed = 0;
            let mut ended = false;
            for &byte in available {
                consumed += 1;
                if self.skip_lf {
                    self.skip_lf = false;
                    if byte == b'\n' {
                        continue;
                    }
                }
                if !in_quotes && matches!(byte, b'\r' | b'\n') {
                    self.skip_lf = byte == b'\r';
                    ended = true;
                    break;
                }
                if record.len() == self.max_record_bytes {
                    return Err(AppError::SerializationError(format!(
                        "CSV record exceeds the {} byte limit",
                        self.max_record_bytes
                    ))
                    .into());
                }
                if byte == b'"' {
                    in_quotes = !in_quotes;
                }
                record.push(byte);
            }
            self.reader.consume(consumed);
            if ended {
                break;
            }
        }
        let mut record = String::from_utf8(record).map_err(|error| {
            AppError::SerializationError(format!("CSV is not valid UTF-8: {error}"))
        })?;
        if self.first_record {
            self.first_record = false;
            if record.starts_with('\u{feff}') {
                record.remove(0);
            }
        }
        // Terminate even an empty record, preserving an empty quoted EOF field.
        record.push('\n');
        check()?;
        let mut rows = parse_csv_delimited(&record, self.delimiter)?;
        check()?;
        Ok(rows.pop())
    }
}

fn csv_delimiter(value: Option<&str>) -> Result<char, AppError> {
    match value.unwrap_or(",") {
        "," => Ok(','),
        "\t" => Ok('\t'),
        ";" => Ok(';'),
        "|" => Ok('|'),
        _ => Err(AppError::ConfigError(
            "CSV delimiter must be comma, tab, semicolon or pipe".into(),
        )),
    }
}

#[cfg(test)]
fn parse_csv(content: &str) -> Result<Vec<Vec<String>>, AppError> {
    parse_csv_delimited(content, ',')
}

fn parse_csv_delimited(content: &str, delimiter: char) -> Result<Vec<Vec<String>>, AppError> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut chars = content.chars().peekable();
    let mut in_quotes = false;
    let mut record_started = false;
    let mut quote_closed = false;

    while let Some(ch) = chars.next() {
        record_started = true;
        if quote_closed && ch != delimiter && !matches!(ch, '\r' | '\n') {
            return Err(AppError::SerializationError(
                "CSV has characters after a closing quote".into(),
            ));
        }
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' if in_quotes => {
                in_quotes = false;
                quote_closed = true;
            }
            '"' if cell.is_empty() => in_quotes = true,
            '"' => {
                return Err(AppError::SerializationError(
                    "CSV has a quote inside an unquoted field".into(),
                ))
            }
            ch if ch == delimiter && !in_quotes => {
                quote_closed = false;
                row.push(std::mem::take(&mut cell));
            }
            '\n' if !in_quotes => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
                record_started = false;
                quote_closed = false;
            }
            '\r' if !in_quotes => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
                record_started = false;
                quote_closed = false;
            }
            _ => cell.push(ch),
        }
    }

    if in_quotes {
        return Err(AppError::SerializationError(
            "CSV has an unterminated quoted field".to_string(),
        ));
    }

    if record_started {
        row.push(cell);
        rows.push(row);
    }

    Ok(rows)
}

#[cfg(test)]
fn csv_headers_and_rows(
    parsed: Vec<Vec<String>>,
    has_header: bool,
    target_columns: &[String],
) -> (Vec<String>, Vec<Vec<String>>, u64) {
    if parsed.is_empty() {
        return (Vec::new(), Vec::new(), 1);
    }
    if has_header {
        let mut iter = parsed.into_iter();
        let headers = iter.next().unwrap_or_default();
        (headers, iter.collect(), 2)
    } else {
        // Headerless CSV maps by target metadata order, excluding non-writable columns
        // columns. Require the complete width rather than guessing a subset.
        (target_columns.to_vec(), parsed, 1)
    }
}

fn resolve_csv_mapping(
    headers: &[String],
    targets: &[String],
    mapping: Option<&[Option<String>]>,
) -> Result<Vec<(usize, String)>, AppError> {
    let Some(mapping) = mapping else {
        if !validate_import_rows(headers, &[], 1, targets).is_empty() {
            return Err(AppError::ConfigError(
                "CSV column mapping is invalid".into(),
            ));
        }
        return Ok(headers
            .iter()
            .enumerate()
            .map(|(i, name)| (i, name.clone()))
            .collect());
    };
    if mapping.len() != headers.len() {
        return Err(AppError::ConfigError(
            "CSV mapping width does not match source columns".into(),
        ));
    }
    let mut seen = HashSet::new();
    let mut resolved = Vec::new();
    for (index, target) in mapping.iter().enumerate() {
        if let Some(target) = target {
            if !targets.contains(target) || !seen.insert(target) {
                return Err(AppError::ConfigError(
                    "CSV mapping contains a duplicate or non-writable target".into(),
                ));
            }
            resolved.push((index, target.clone()));
        }
    }
    if resolved.is_empty() {
        return Err(AppError::ConfigError(
            "CSV mapping must select at least one writable target".into(),
        ));
    }
    Ok(resolved)
}

fn validate_import_rows(
    headers: &[String],
    rows: &[Vec<String>],
    first_data_row: u64,
    target_columns: &[String],
) -> Vec<RowReport> {
    validate_import_rows_sampled(headers, rows, first_data_row, target_columns, usize::MAX).reports
}

struct ImportValidation {
    reports: Vec<RowReport>,
    header_invalid: bool,
    invalid_data_rows: u64,
}

fn validate_import_rows_sampled(
    headers: &[String],
    rows: &[Vec<String>],
    first_data_row: u64,
    target_columns: &[String],
    report_limit: usize,
) -> ImportValidation {
    let mut reports = Vec::new();
    let mut header_invalid = false;
    let mut invalid_data_rows = 0;
    let target_set = target_columns
        .iter()
        .map(|column| column.to_lowercase())
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();

    for header in headers {
        let normalized = header.to_lowercase();
        let message = if header.trim().is_empty() {
            Some("Header contains an empty column name".to_string())
        } else if !seen.insert(normalized.clone()) {
            Some(format!("Duplicate CSV column: {header}"))
        } else if !target_set.contains(&normalized) {
            Some(format!(
                "CSV column is not importable for target table: {header}"
            ))
        } else {
            None
        };
        if let Some(message) = message {
            header_invalid = true;
            if reports.len() < report_limit {
                reports.push(RowReport {
                    row_number: 1,
                    message,
                    values: headers.to_vec(),
                });
            }
        }
    }

    for (index, row) in rows.iter().enumerate() {
        if row.len() != headers.len() {
            invalid_data_rows += 1;
            if reports.len() < report_limit {
                reports.push(RowReport {
                    row_number: first_data_row + index as u64,
                    message: format!("Expected {} fields, found {}", headers.len(), row.len()),
                    values: row.clone(),
                });
            }
        }
    }

    ImportValidation {
        reports,
        header_invalid,
        invalid_data_rows,
    }
}

fn resolve_connection_sql_dialect(
    store: &crate::services::config_store::ConfigStore,
    connection_id: Uuid,
    _caller: DriverType,
) -> Result<DriverType, AppError> {
    let connection = store
        .get_connection(connection_id)?
        .ok_or_else(|| AppError::NotFound {
            resource: "connection".into(),
            id: connection_id.to_string(),
        })?;
    let definition = connection
        .driver_definition_id
        .as_deref()
        .map(|id| {
            store
                .get_driver_definition(id)?
                .ok_or_else(|| AppError::NotFound {
                    resource: "driver definition".into(),
                    id: id.to_string(),
                })
        })
        .transpose()?;
    let jdbc = matches!(connection.driver_type, DriverType::Jdbc)
        || matches!(
            definition.as_ref().map(|driver| &driver.backend),
            Some(crate::models::driver_catalog::DriverBackend::Jdbc)
        );
    let dialect = if jdbc {
        match connection
            .driver_dialect
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                definition
                    .as_ref()
                    .map(|driver| driver.driver_dialect.as_str())
            })
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("postgres" | "postgresql") => DriverType::Postgres,
            Some("mysql" | "mariadb") => DriverType::Mysql,
            Some("mssql" | "sqlserver") => DriverType::Mssql,
            Some("sqlite") => DriverType::Sqlite,
            Some("oracle") => DriverType::Oracle,
            _ => {
                return Err(AppError::UnsupportedOperation {
                    driver: "jdbc".into(),
                    operation: "CSV SQL dialect is not supported".into(),
                })
            }
        }
    } else {
        connection.driver_type
    };
    if matches!(
        dialect,
        DriverType::Mongo | DriverType::Redis | DriverType::Jdbc
    ) {
        return Err(AppError::UnsupportedOperation {
            driver: dialect.to_string(),
            operation: "table CSV SQL dialect".into(),
        });
    }
    Ok(dialect)
}

fn export_column_names(columns: &[ColumnInfo]) -> Result<Vec<String>, AppError> {
    if columns.is_empty() {
        return Err(AppError::ConfigError(
            "table has no readable/exportable columns".into(),
        ));
    }
    Ok(columns.iter().map(|column| column.name.clone()).collect())
}

fn importable_column_names(columns: &[ColumnInfo]) -> Vec<String> {
    columns
        .iter()
        .filter(|column| column_is_import_writable(column))
        .map(|column| column.name.clone())
        .collect()
}

fn require_importable_column_names(columns: &[ColumnInfo]) -> Result<Vec<String>, AppError> {
    let names = importable_column_names(columns);
    if names.is_empty() {
        return Err(AppError::ConfigError(
            "table has no writable/importable columns".into(),
        ));
    }
    Ok(names)
}

fn column_is_import_writable(column: &ColumnInfo) -> bool {
    !column.is_identity && !column.is_generated && !column.is_auto_increment
}

fn parameter_placeholder(driver_type: DriverType, index: usize) -> String {
    if matches!(driver_type, DriverType::Postgres) {
        format!("${}", index + 1)
    } else {
        "?".to_string()
    }
}

fn csv_parameter(value: &str, empty_as_null: bool) -> DbParameter {
    if empty_as_null && value.is_empty() {
        DbParameter::Null
    } else {
        DbParameter::Text(value.to_string())
    }
}

#[cfg(test)]
fn build_parameterized_insert_sql(
    driver_type: DriverType,
    table: &str,
    columns: &[String],
    row: &[String],
    empty_as_null: bool,
) -> (String, Vec<DbParameter>) {
    build_parameterized_insert_sql_checked(driver_type, table, columns, row, empty_as_null, || {
        Ok(())
    })
    .unwrap()
}

fn build_parameterized_insert_sql_checked(
    driver_type: DriverType,
    table: &str,
    columns: &[String],
    row: &[String],
    empty_as_null: bool,
    mut check: impl FnMut() -> Result<(), ExportTaskError>,
) -> Result<(String, Vec<DbParameter>), ExportTaskError> {
    check()?;
    let mut placeholders = Vec::with_capacity(row.len());
    let mut params = Vec::with_capacity(row.len());
    for (index, value) in row.iter().enumerate() {
        if index.is_multiple_of(64) {
            check()?;
        }
        placeholders.push(parameter_placeholder(driver_type, index));
        params.push(csv_parameter(value, empty_as_null));
    }
    check()?;
    Ok((
        format!(
            "INSERT INTO {table} ({}) VALUES ({});",
            columns
                .iter()
                .map(|column| quote_identifier(driver_type, column))
                .collect::<Vec<_>>()
                .join(", "),
            placeholders.join(", ")
        ),
        params,
    ))
}

#[cfg(test)]
fn build_parameterized_insert_batch_sql(
    driver_type: DriverType,
    table: &str,
    columns: &[String],
    rows: &[(u64, Vec<String>)],
    empty_as_null: bool,
) -> (String, Vec<DbParameter>) {
    build_parameterized_insert_batch_sql_checked(
        driver_type,
        table,
        columns,
        rows,
        empty_as_null,
        || Ok(()),
    )
    .unwrap()
}

fn build_parameterized_insert_batch_sql_checked(
    driver_type: DriverType,
    table: &str,
    columns: &[String],
    rows: &[(u64, Vec<String>)],
    empty_as_null: bool,
    mut check: impl FnMut() -> Result<(), ExportTaskError>,
) -> Result<(String, Vec<DbParameter>), ExportTaskError> {
    check()?;
    let mut parameter_index = 0_usize;
    let mut values = Vec::with_capacity(rows.len());
    let mut params = Vec::new();
    for (_, row) in rows {
        check()?;
        let mut placeholders = Vec::with_capacity(row.len());
        for value in row {
            if parameter_index.is_multiple_of(64) {
                check()?;
            }
            placeholders.push(parameter_placeholder(driver_type, parameter_index));
            parameter_index += 1;
            params.push(csv_parameter(value, empty_as_null));
        }
        values.push(format!("({})", placeholders.join(", ")));
    }
    check()?;
    Ok((
        format!(
            "INSERT INTO {table} ({}) VALUES {};",
            columns
                .iter()
                .map(|column| quote_identifier(driver_type, column))
                .collect::<Vec<_>>()
                .join(", "),
            values.join(", ")
        ),
        params,
    ))
}

fn qualified_table(driver_type: DriverType, schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_identifier(driver_type, schema),
        quote_identifier(driver_type, table)
    )
}

fn quote_identifier(driver_type: DriverType, value: &str) -> String {
    match driver_type {
        DriverType::Mysql => format!("`{}`", value.replace('`', "``")),
        DriverType::Mssql => format!("[{}]", value.replace(']', "]]")),
        _ => format!("\"{}\"", value.replace('"', "\"\"")),
    }
}

async fn write_csv_line(
    writer: &mut BufWriter<File>,
    cells: Vec<String>,
    prefix_newline: bool,
) -> Result<u64, std::io::Error> {
    let mut bytes = 0_u64;
    if prefix_newline {
        writer.write_all(b"\r\n").await?;
        bytes += 2;
    }

    let line = cells.join(",");
    writer.write_all(line.as_bytes()).await?;
    bytes += line.len() as u64;
    Ok(bytes)
}

#[cfg(test)]
fn query_result_to_csv(result: &QueryResult, include_header: bool) -> String {
    let mut lines = Vec::with_capacity(result.rows.len() + usize::from(include_header));

    if include_header {
        lines.push(
            result
                .columns
                .iter()
                .map(|column| csv_cell(&column.name))
                .collect::<Vec<_>>()
                .join(","),
        );
    }

    for row in &result.rows {
        lines.push(
            (0..result.columns.len())
                .map(|index| csv_value(row.get(index)))
                .collect::<Vec<_>>()
                .join(","),
        );
    }

    lines.join("\r\n")
}

fn csv_value(value: Option<&serde_json::Value>) -> String {
    match value {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(serde_json::Value::String(value)) => csv_cell(value),
        Some(serde_json::Value::Number(value)) => value.to_string(),
        Some(serde_json::Value::Bool(value)) => value.to_string(),
        Some(value) => csv_cell(&value.to_string()),
    }
}

fn csv_cell(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod precision_tests {
    use super::*;

    #[test]
    fn csv_keeps_exact_numeric_strings_and_json_text() {
        assert_eq!(
            csv_value(Some(&serde_json::json!("9007199254740993"))),
            "9007199254740993"
        );
        assert_eq!(csv_value(Some(&serde_json::json!("123.4500"))), "123.4500");
        assert_eq!(
            csv_value(Some(&serde_json::json!("{\"id\":9007199254740993}"))),
            "\"{\"\"id\"\":9007199254740993}\""
        );
    }
}

fn display_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("query-result.csv")
        .to_string()
}

fn default_include_header() -> bool {
    true
}

fn default_has_header() -> bool {
    true
}

fn default_empty_as_null() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use std::{
        pin::Pin,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        task::{Context, Poll},
    };

    use serde_json::json;
    use tokio::io::{AsyncRead, ReadBuf};

    use super::{
        build_parameterized_insert_batch_sql, build_parameterized_insert_sql, parse_csv,
        qualified_table, query_result_to_csv, validate_import_rows,
    };
    use crate::drivers::trait_def::DbParameter;
    use crate::models::connection::DriverType;
    use crate::models::query_result::{ColumnMeta, QueryResult};

    #[test]
    fn table_csv_dialect_comes_from_saved_connection_not_frontend_input() {
        use crate::services::config_store::ConfigStore;
        for (actual, caller, table, placeholder) in [
            (
                DriverType::Postgres,
                DriverType::Mysql,
                "\"public\".\"items\"",
                "$1",
            ),
            (
                DriverType::Mysql,
                DriverType::Postgres,
                "`public`.`items`",
                "?",
            ),
            (
                DriverType::Mssql,
                DriverType::Mysql,
                "[public].[items]",
                "?",
            ),
        ] {
            let root = std::env::temp_dir()
                .join(format!("vaporlens-csv-dialect-{}", uuid::Uuid::new_v4()));
            let store = ConfigStore::new(root.clone()).unwrap();
            let id = uuid::Uuid::new_v4();
            let config = serde_json::from_value(json!({ "id": id, "name": "dialect fixture", "driverType": actual, "driverPaths": [], "createdAt": chrono::Utc::now(), "updatedAt": chrono::Utc::now() })).unwrap();
            store.create_connection(config, None, false).unwrap();
            let mut export: super::ExportTableCsvInput = serde_json::from_value(json!({ "connectionId": id, "driverType": caller, "schema": "public", "table": "items", "path": "fixture.csv" })).unwrap();
            let mut import: super::ImportTableCsvInput = serde_json::from_value(json!({ "connectionId": id, "driverType": caller, "schema": "public", "table": "items", "path": "fixture.csv" })).unwrap();
            export.driver_type = super::resolve_connection_sql_dialect(
                &store,
                export.connection_id,
                export.driver_type,
            )
            .unwrap();
            import.driver_type = super::resolve_connection_sql_dialect(
                &store,
                import.connection_id,
                import.driver_type,
            )
            .unwrap();
            assert_eq!(
                qualified_table(export.driver_type, &export.schema, &export.table),
                table
            );
            assert_eq!(
                qualified_table(import.driver_type, &import.schema, &import.table),
                table
            );
            let (sql, params) = build_parameterized_insert_sql(
                import.driver_type,
                table,
                &["id".into()],
                &["7".into()],
                false,
            );
            assert_eq!(
                sql,
                format!(
                    "INSERT INTO {table} ({}) VALUES ({placeholder});",
                    super::quote_identifier(actual, "id")
                )
            );
            assert_eq!(params, vec![DbParameter::Text("7".into())]);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn jdbc_csv_dialect_uses_saved_dialect_or_catalog_and_rejects_unknown_targets() {
        use crate::services::config_store::ConfigStore;
        let root = std::env::temp_dir().join(format!(
            "vaporlens-jdbc-csv-dialect-{}",
            uuid::Uuid::new_v4()
        ));
        let store = ConfigStore::new(root.clone()).unwrap();
        for (driver_type, definition_id, dialect, expected) in [
            (
                DriverType::Jdbc,
                Some("jdbc-postgresql"),
                None,
                Some(DriverType::Postgres),
            ),
            (
                DriverType::Postgres,
                Some("jdbc-postgresql"),
                Some("mysql"),
                Some(DriverType::Mysql),
            ),
            (
                DriverType::Jdbc,
                None,
                Some("sqlserver"),
                Some(DriverType::Mssql),
            ),
            (
                DriverType::Oracle,
                Some("oracle"),
                None,
                Some(DriverType::Oracle),
            ),
            (DriverType::Jdbc, None, Some("unknown"), None),
            (DriverType::Jdbc, None, None, None),
            (
                DriverType::Postgres,
                Some("jdbc-postgresql"),
                Some("unknown"),
                None,
            ),
        ] {
            let id = uuid::Uuid::new_v4();
            let config = serde_json::from_value(json!({ "id": id, "name": "JDBC dialect fixture", "driverType": driver_type, "driverDefinitionId": definition_id, "driverDialect": dialect, "driverPaths": [], "createdAt": chrono::Utc::now(), "updatedAt": chrono::Utc::now() })).unwrap();
            store.create_connection(config, None, false).unwrap();
            let resolved = super::resolve_connection_sql_dialect(&store, id, DriverType::Mysql);
            match expected {
                Some(expected) => assert_eq!(resolved.unwrap(), expected),
                None => assert!(matches!(
                    resolved,
                    Err(crate::models::error::AppError::UnsupportedOperation { .. })
                )),
            }
        }
        assert!(matches!(
            super::resolve_connection_sql_dialect(
                &store,
                uuid::Uuid::new_v4(),
                DriverType::Postgres
            ),
            Err(crate::models::error::AppError::NotFound { .. })
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn readable_export_columns_are_separate_from_writable_import_columns() {
        let column = |name, default_value, is_identity, is_generated, is_auto_increment| {
            serde_json::from_value(json!({ "table": "items", "name": name, "ordinalPosition": 1, "dataType": "INTEGER", "nullable": false, "isPrimaryKey": false, "defaultValue": default_value, "isIdentity": is_identity, "isGenerated": is_generated, "isAutoIncrement": is_auto_increment })).unwrap()
        };
        let columns = vec![
            column(
                "id",
                Some("GENERATED ALWAYS AS IDENTITY"),
                true,
                false,
                true,
            ),
            column("name", None, false, false, false),
            column("defaulted", Some("7"), false, false, false),
        ];
        assert_eq!(
            super::export_column_names(&columns).unwrap(),
            vec!["id", "name", "defaulted"]
        );
        assert_eq!(
            super::importable_column_names(&columns),
            vec!["name", "defaulted"]
        );
        assert!(super::export_column_names(&[]).is_err());
    }

    #[test]
    fn structured_generated_metadata_controls_importability_without_default_text_guessing() {
        let column = |name, default_value, is_identity, is_generated, is_auto_increment| {
            serde_json::from_value(json!({
                "table": "items",
                "name": name,
                "ordinalPosition": 1,
                "dataType": "INTEGER",
                "nullable": false,
                "isPrimaryKey": false,
                "defaultValue": default_value,
                "isIdentity": is_identity,
                "isGenerated": is_generated,
                "isAutoIncrement": is_auto_increment
            }))
            .unwrap()
        };
        let columns = vec![
            column("identity_id", None, true, false, true),
            column("computed", Some("1 + 1"), false, true, false),
            column("ordinary_default", Some("now()"), false, false, false),
            column(
                "legacy_text",
                Some("generated by application"),
                false,
                false,
                false,
            ),
        ];

        assert_eq!(
            super::importable_column_names(&columns),
            vec!["ordinary_default", "legacy_text"]
        );
        assert!(super::require_importable_column_names(&columns).is_ok());
        assert!(super::require_importable_column_names(&columns[..2]).is_err());
        assert_eq!(
            super::export_column_names(&columns).unwrap(),
            vec!["identity_id", "computed", "ordinary_default", "legacy_text"]
        );
    }

    #[test]
    fn mssql_generated_sql_uses_bracket_quoting_and_escapes_closing_brackets() {
        assert_eq!(
            super::qualified_table(DriverType::Mssql, "dbo", "Order"),
            "[dbo].[Order]"
        );
        assert_eq!(
            super::quote_identifier(DriverType::Mssql, "weird]name"),
            "[weird]]name]"
        );
        let (sql, _) = super::build_parameterized_insert_sql(
            DriverType::Mssql,
            "[ignored by helper]",
            &["value".into(), "col]name".into()],
            &["a".into(), "b".into()],
            false,
        );
        assert!(sql.contains("[value], [col]]name]"));
    }

    struct CountingReader {
        bytes: Vec<u8>,
        position: usize,
        read_bytes: Arc<AtomicUsize>,
    }

    impl CountingReader {
        fn new(content: String, read_bytes: Arc<AtomicUsize>) -> Self {
            Self {
                bytes: content.into_bytes(),
                position: 0,
                read_bytes,
            }
        }
    }

    impl AsyncRead for CountingReader {
        fn poll_read(
            mut self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buffer: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            let remaining = self.bytes.len().saturating_sub(self.position);
            let count = remaining.min(buffer.remaining()).min(32);
            if count > 0 {
                let end = self.position + count;
                buffer.put_slice(&self.bytes[self.position..end]);
                self.position = end;
                self.read_bytes.fetch_add(count, Ordering::SeqCst);
            }
            Poll::Ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn import_parser_cancellation_stops_inside_a_record_before_eof() {
        let bytes = Arc::new(AtomicUsize::new(0));
        let content = format!("\"{}\"\n", "large field".repeat(1000));
        let length = content.len();
        let mut reader = super::CsvRecordReader::new(
            CountingReader::new(content, bytes.clone()),
            super::IMPORT_MAX_RECORD_BYTES,
        );
        let mut checks = 0;
        let result = reader
            .next_row_checked(|| {
                checks += 1;
                if checks == 5 {
                    Err(super::ExportTaskError::Cancelled)
                } else {
                    Ok(())
                }
            })
            .await;
        assert!(matches!(result, Err(super::ExportTaskError::Cancelled)));
        assert!(bytes.load(Ordering::SeqCst) < length);
    }

    #[test]
    fn import_parameter_build_checks_inside_a_wide_row_and_between_batch_rows() {
        let columns = (0..256)
            .map(|index| format!("column_{index}"))
            .collect::<Vec<_>>();
        let row = vec!["value".to_string(); columns.len()];
        let mut checks = 0;
        let result = super::build_parameterized_insert_sql_checked(
            DriverType::Postgres,
            "items",
            &columns,
            &row,
            true,
            || {
                checks += 1;
                if checks == 3 {
                    Err(super::ExportTaskError::Cancelled)
                } else {
                    Ok(())
                }
            },
        );
        assert!(matches!(result, Err(super::ExportTaskError::Cancelled)));
        assert_eq!(checks, 3);
        let rows = vec![
            (1, vec!["first".into()]),
            (2, vec!["second".into()]),
            (3, vec!["third".into()]),
        ];
        let mut checks = 0;
        let result = super::build_parameterized_insert_batch_sql_checked(
            DriverType::Sqlite,
            "items",
            &["name".into()],
            &rows,
            true,
            || {
                checks += 1;
                if checks == 4 {
                    Err(super::ExportTaskError::Cancelled)
                } else {
                    Ok(())
                }
            },
        );
        assert!(matches!(result, Err(super::ExportTaskError::Cancelled)));
        assert_eq!(checks, 4);
    }

    fn preview_input() -> super::PreviewTableCsvImportInput {
        super::PreviewTableCsvImportInput {
            connection_id: uuid::Uuid::nil(),
            schema: "public".into(),
            table: "items".into(),
            path: "preview.csv".into(),
            has_header: true,
            delimiter: None,
            mapping: None,
            empty_as_null: true,
            preview_rows: Some(20),
            sample_only: false,
            task_id: None,
        }
    }

    fn preview(content: &str, has_header: bool) -> super::ImportPreview {
        super::build_import_preview(
            &super::PreviewTableCsvImportInput {
                connection_id: uuid::Uuid::nil(),
                schema: "public".into(),
                table: "items".into(),
                path: "preview.csv".into(),
                has_header,
                delimiter: None,
                mapping: None,
                empty_as_null: true,
                preview_rows: Some(500),
                sample_only: false,
                task_id: None,
            },
            parse_csv(content).unwrap(),
            vec!["id".into(), "name".into()],
        )
    }

    #[test]
    fn preview_input_keeps_task_id_optional_for_existing_callers() {
        let input: super::PreviewTableCsvImportInput = serde_json::from_value(json!({
            "connectionId": uuid::Uuid::nil(),
            "schema": "public",
            "table": "items",
            "path": "preview.csv"
        }))
        .unwrap();
        assert!(input.task_id.is_none());
        assert!(input.has_header);
    }

    #[test]
    fn sampled_validation_counts_errors_even_when_no_reports_are_retained() {
        let headers = vec!["id".into(), "missing".into(), "id".into()];
        let rows = vec![vec!["1".into()]; 10_000];
        let targets = vec!["id".into(), "name".into()];
        for limit in [0, 1, 100] {
            let result = super::validate_import_rows_sampled(&headers, &rows, 2, &targets, limit);
            assert!(result.header_invalid);
            assert_eq!(result.invalid_data_rows, 10_000);
            assert_eq!(result.reports.len(), limit);
            if limit == 100 {
                assert_eq!(result.reports[2].row_number, 2);
                assert_eq!(result.reports[99].row_number, 99);
            }
        }
        // Actual imports still retain the complete report, not the preview sample.
        assert_eq!(
            validate_import_rows(&headers, &rows, 2, &targets).len(),
            10_002
        );
    }

    #[test]
    fn import_report_retention_has_row_and_byte_budgets_without_losing_counts() {
        let mut row_limited = super::BoundedRowReports::default();
        for row_number in 1..=(super::IMPORT_REPORT_MAX_ROWS_PER_KIND as u64 + 7) {
            row_limited.push(super::RowReport {
                row_number,
                message: "invalid width".into(),
                values: vec!["x".into()],
            });
        }
        assert_eq!(
            row_limited.total,
            super::IMPORT_REPORT_MAX_ROWS_PER_KIND as u64 + 7
        );
        assert_eq!(
            row_limited.reports.len(),
            super::IMPORT_REPORT_MAX_ROWS_PER_KIND
        );
        assert_eq!(row_limited.omitted(), 7);

        let mut byte_limited = super::BoundedRowReports::default();
        for row_number in 1..=8 {
            byte_limited.push(super::RowReport {
                row_number,
                message: "write failed".into(),
                values: vec!["x".repeat(1024 * 1024)],
            });
        }
        assert_eq!(byte_limited.total, 8);
        assert!(byte_limited.retained_bytes <= super::IMPORT_REPORT_MAX_BYTES_PER_KIND);
        assert!(byte_limited.reports.len() < 8);
        assert_eq!(
            byte_limited.omitted(),
            8 - byte_limited.reports.len() as u64
        );
    }

    #[tokio::test]
    async fn streamed_csv_records_match_parser_across_buffer_boundaries() {
        for content in [
            "",
            "\n",
            "\r\n",
            "\"\"",
            "id,name\r\n1,Ada\r\n",
            "id,note\r1,\"中文🙂\r\nquote \"\" and comma,\"\n2,end",
            "a,b\n,\n\"\",\"\"",
            "\"\"\"\"",
            "a\r\nb\rc\n\n",
        ] {
            for capacity in 1..=8 {
                let mut reader = super::CsvRecordReader::new(content.as_bytes(), 1024);
                reader.reader = tokio::io::BufReader::with_capacity(capacity, content.as_bytes());
                let mut rows = Vec::new();
                while let Some(row) = reader.next_row().await.unwrap() {
                    rows.push(row);
                }
                assert_eq!(
                    rows,
                    parse_csv(content).unwrap(),
                    "capacity={capacity}, {content:?}"
                );
            }
        }
        assert_eq!(parse_csv("\"\"").unwrap(), vec![vec![String::new()]]);
    }

    #[tokio::test]
    async fn streamed_csv_records_enforce_byte_limit_and_reject_invalid_input() {
        let mut exact = super::CsvRecordReader::new(&b"abcd\r\n"[..], 4);
        assert_eq!(exact.next_row().await.unwrap(), Some(vec!["abcd".into()]));
        assert!(exact.next_row().await.unwrap().is_none());
        for content in [&b"abcde"[..], &b"\"ab\nc\""[..]] {
            let error = super::CsvRecordReader::new(content, 4)
                .next_row()
                .await
                .unwrap_err();
            assert!(error.to_string().contains("byte limit"));
        }
        for content in [&b"\"unterminated"[..], &b"\xff\n"[..]] {
            assert!(super::CsvRecordReader::new(content, 1024)
                .next_row()
                .await
                .is_err());
        }
    }

    #[tokio::test]
    async fn streamed_preview_matches_full_validation_and_keeps_bounded_samples() {
        let many = format!("id,name\n{}2,Ada\n", "1\n".repeat(100_000));
        for content in [
            many.as_str(),
            "id,missing\n1,Ada",
            "1,Ada\n2",
            "\"\"",
            "",
            "id,name\n",
        ] {
            for has_header in [true, false] {
                for sample_limit in [0, 1, 100] {
                    let input = super::PreviewTableCsvImportInput {
                        connection_id: uuid::Uuid::nil(),
                        schema: "public".into(),
                        table: "items".into(),
                        path: "preview.csv".into(),
                        has_header,
                        delimiter: None,
                        mapping: None,
                        empty_as_null: true,
                        preview_rows: Some(sample_limit),
                        sample_only: false,
                        task_id: None,
                    };
                    let columns = vec!["id".into(), "name".into()];
                    let expected = super::build_import_preview(
                        &input,
                        parse_csv(content).unwrap(),
                        columns.clone(),
                    );
                    let actual = super::preview_csv_reader(&input, content.as_bytes(), columns)
                        .await
                        .unwrap();
                    assert_eq!(
                        serde_json::to_value(actual).unwrap(),
                        serde_json::to_value(expected).unwrap()
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn streamed_preview_still_checks_input_after_sample_is_full() {
        let input = super::PreviewTableCsvImportInput {
            connection_id: uuid::Uuid::nil(),
            schema: "public".into(),
            table: "items".into(),
            path: "preview.csv".into(),
            has_header: true,
            delimiter: None,
            mapping: None,
            empty_as_null: true,
            preview_rows: Some(1),
            sample_only: false,
            task_id: None,
        };
        let content = format!("id,name\n{}\"unterminated", "1,Ada\n".repeat(150));
        assert!(super::preview_csv_reader(
            &input,
            content.as_bytes(),
            vec!["id".into(), "name".into()]
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn streamed_preview_limits_sample_bytes_without_losing_counts() {
        let input = super::PreviewTableCsvImportInput {
            connection_id: uuid::Uuid::nil(),
            schema: "public".into(),
            table: "items".into(),
            path: "preview.csv".into(),
            has_header: true,
            delimiter: None,
            mapping: None,
            empty_as_null: true,
            preview_rows: Some(100),
            sample_only: false,
            task_id: None,
        };
        let wide = "x".repeat(100_000);
        let content = format!("id,name\n{}", format!("{wide}\n").repeat(100));
        let preview =
            super::preview_csv_reader(&input, content.as_bytes(), vec!["id".into(), "name".into()])
                .await
                .unwrap();
        assert_eq!(preview.total_rows, 100);
        assert_eq!(preview.valid_rows, 0);
        assert!(!preview.rows.is_empty() && preview.rows.len() < 100);
        assert!(!preview.invalid_rows.is_empty() && preview.invalid_rows.len() < 100);
        assert!(
            preview
                .rows
                .iter()
                .map(|row| super::row_storage_bytes(row))
                .sum::<usize>()
                <= super::IMPORT_PREVIEW_SAMPLE_BYTES
        );
        assert!(
            preview
                .invalid_rows
                .iter()
                .map(|report| super::row_storage_bytes(&report.values) + report.message.len())
                .sum::<usize>()
                <= super::IMPORT_PREVIEW_SAMPLE_BYTES
        );
    }

    #[tokio::test]
    async fn streamed_preview_observes_pre_cancel_before_reading() {
        let manager = crate::services::task_manager::TaskManager::new();
        let task = manager
            .create_task("preview.csv.import", "preview", None)
            .await;
        let handle = manager.handle(task.id).await.unwrap();
        manager.request_cancel(task.id).await.unwrap();
        let read_bytes = Arc::new(AtomicUsize::new(0));
        let result = super::preview_csv_reader_with_cancel(
            &preview_input(),
            CountingReader::new("id,name\n1,Ada\n".into(), read_bytes.clone()),
            vec!["id".into(), "name".into()],
            Some(&handle),
        )
        .await;
        assert!(matches!(result, Err(super::PreviewCsvError::Cancelled)));
        assert_eq!(read_bytes.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn streamed_preview_cancel_stops_before_eof_and_next_preview_succeeds() {
        let manager = crate::services::task_manager::TaskManager::new();
        let id = uuid::Uuid::new_v4();
        let registration = manager
            .register_scoped_task(id, "preview.csv.import", "preview")
            .await
            .unwrap();
        let handle = registration.handle().clone();
        let content = format!("id,name\n{}", "1,Ada\n".repeat(100_000));
        let total_bytes = content.len();
        let read_bytes = Arc::new(AtomicUsize::new(0));
        let read_for_task = read_bytes.clone();
        let input = preview_input();
        let scan = tokio::spawn(async move {
            super::preview_csv_reader_with_cancel(
                &input,
                CountingReader::new(content, read_for_task),
                vec!["id".into(), "name".into()],
                Some(&handle),
            )
            .await
        });
        while read_bytes.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        manager.request_cancel(id).await.unwrap();
        let result = scan.await.unwrap();
        assert!(matches!(result, Err(super::PreviewCsvError::Cancelled)));
        assert!(read_bytes.load(Ordering::SeqCst) < total_bytes);
        registration.cleanup().await;

        let next_id = uuid::Uuid::new_v4();
        let next = manager
            .register_scoped_task(next_id, "preview.csv.import", "next preview")
            .await
            .unwrap();
        let result = super::preview_csv_reader_with_cancel(
            &preview_input(),
            "id,name\n2,Grace\n".as_bytes(),
            vec!["id".into(), "name".into()],
            Some(next.handle()),
        )
        .await
        .unwrap();
        assert_eq!(result.total_rows, 1);
        assert!(!result.cancelled);
        next.cleanup().await;
    }

    #[tokio::test]
    async fn completed_preview_wins_over_late_cancel_and_error_path_cleans_up() {
        let manager = crate::services::task_manager::TaskManager::new();
        let id = uuid::Uuid::new_v4();
        let registration = manager
            .register_scoped_task(id, "preview.csv.import", "preview")
            .await
            .unwrap();
        let result = super::preview_csv_reader_with_cancel(
            &preview_input(),
            "id,name\n1,Ada\n".as_bytes(),
            vec!["id".into(), "name".into()],
            Some(registration.handle()),
        )
        .await
        .unwrap();
        manager.request_cancel(id).await.unwrap();
        assert_eq!(result.total_rows, 1);
        registration.cleanup().await;
        assert!(manager.handle(id).await.is_err());

        let error_id = uuid::Uuid::new_v4();
        let error_registration = manager
            .register_scoped_task(error_id, "preview.csv.import", "error preview")
            .await
            .unwrap();
        let error = super::preview_csv_reader_with_cancel(
            &preview_input(),
            &b"id,name\n\xff\n"[..],
            vec!["id".into(), "name".into()],
            Some(error_registration.handle()),
        )
        .await;
        assert!(matches!(error, Err(super::PreviewCsvError::Failed(_))));
        error_registration.cleanup().await;
        assert!(manager.handle(error_id).await.is_err());
    }

    #[test]
    fn sampled_validation_keeps_headerless_row_one_in_the_data_count() {
        let headers = vec!["id".into(), "name".into()];
        let rows = vec![vec!["1".into()], vec!["2".into(), "Ada".into()]];
        let result = super::validate_import_rows_sampled(&headers, &rows, 1, &headers, 0);
        assert!(!result.header_invalid);
        assert_eq!(result.invalid_data_rows, 1);
        assert!(result.reports.is_empty());
    }

    #[test]
    fn preview_counts_all_invalid_rows_before_sampling() {
        let all_invalid = format!("id,name\n{}", "1\n".repeat(150));
        let result = preview(&all_invalid, true);
        assert_eq!(result.total_rows, 150);
        assert_eq!(result.valid_rows, 0);
        assert!(!result.can_import);
        assert_eq!(result.invalid_rows.len(), 100);
        assert_eq!(result.rows.len(), 100);
        let mixed = preview(&format!("{all_invalid}2,Ada\n3,Grace\n"), true);
        assert_eq!(mixed.total_rows, 152);
        assert_eq!(mixed.valid_rows, 2);
        assert!(mixed.can_import);
    }

    #[test]
    fn invalid_headers_block_the_entire_import() {
        for header in ["id,missing", "id,id", "id,"] {
            let result = preview(&format!("{header}\n1,Ada\n2,Grace"), true);
            assert_eq!(result.total_rows, 2);
            assert_eq!(result.valid_rows, 0);
            assert!(!result.can_import, "{header}");
        }
    }

    #[test]
    fn headerless_csv_maps_target_columns_in_order_and_requires_full_width() {
        let result = preview("1,Ada\n2,Grace", false);
        assert_eq!(result.headers, vec!["id", "name"]);
        assert_eq!(result.valid_rows, 2);
        assert!(result.can_import);
        let invalid = preview("1\n2,Grace,extra", false);
        assert_eq!(invalid.valid_rows, 0);
        assert!(!invalid.can_import);
        assert_eq!(
            invalid
                .invalid_rows
                .iter()
                .map(|row| row.row_number)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn empty_and_header_only_csv_have_no_importable_rows() {
        for (content, has_header) in [("", true), ("", false), ("id,name\n", true)] {
            let result = preview(content, has_header);
            assert_eq!(result.total_rows, 0);
            assert_eq!(result.valid_rows, 0);
            assert!(!result.can_import);
        }
    }

    #[test]
    fn csv_export_quotes_special_values_and_nulls() {
        let result = QueryResult {
            columns: vec![
                ColumnMeta {
                    name: "id".to_string(),
                    data_type: "int4".to_string(),
                    nullable: false,
                },
                ColumnMeta {
                    name: "note".to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                },
            ],
            rows: vec![
                vec![json!(1), json!("comma, quote \" and\nline")],
                vec![json!(2), serde_json::Value::Null],
            ],
            row_count: 2,
            elapsed_ms: 1,
            affected_rows: 0,
            query_id: Some("q1".to_string()),
            truncated: false,
            max_rows: None,
        };

        assert_eq!(
            query_result_to_csv(&result, true),
            "id,note\r\n1,\"comma, quote \"\" and\nline\"\r\n2,"
        );
    }

    #[test]
    fn csv_export_quotes_headers_and_json_values() {
        let result = QueryResult {
            columns: vec![ColumnMeta {
                name: "bad,header".to_string(),
                data_type: "jsonb".to_string(),
                nullable: true,
            }],
            rows: vec![vec![json!({ "key": "a,b" })]],
            row_count: 1,
            elapsed_ms: 1,
            affected_rows: 0,
            query_id: None,
            truncated: false,
            max_rows: None,
        };

        assert_eq!(
            query_result_to_csv(&result, true),
            "\"bad,header\"\r\n\"{\"\"key\"\":\"\"a,b\"\"}\""
        );
    }

    #[test]
    fn csv_parser_handles_quotes_commas_and_newlines() {
        assert_eq!(
            parse_csv("id,note\r\n1,\"comma, and\nline\"\r\n2,\"quote \"\" ok\"").unwrap(),
            vec![
                vec!["id".to_string(), "note".to_string()],
                vec!["1".to_string(), "comma, and\nline".to_string()],
                vec!["2".to_string(), "quote \" ok".to_string()],
            ]
        );
    }

    #[test]
    fn import_preview_validation_reports_bad_headers_and_row_widths() {
        let reports = validate_import_rows(
            &["id".to_string(), "missing".to_string(), "id".to_string()],
            &[vec!["1".to_string(), "x".to_string()]],
            2,
            &["id".to_string(), "name".to_string()],
        );

        assert!(reports
            .iter()
            .any(|report| report.message.contains("not importable")));
        assert!(reports
            .iter()
            .any(|report| report.message.contains("Duplicate CSV column")));
        assert!(reports
            .iter()
            .any(|report| report.message.contains("Expected 3 fields")));
    }

    #[test]
    fn parameterized_insert_separates_sql_structure_from_values() {
        let table = qualified_table(DriverType::Postgres, "public", "people");
        let (sql, params) = build_parameterized_insert_sql(
            DriverType::Postgres,
            &table,
            &["name".to_string(), "note".to_string()],
            &["Ada".to_string(), "it's ok".to_string()],
            true,
        );
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"people\" (\"name\", \"note\") VALUES ($1, $2);"
        );
        assert_eq!(
            params,
            vec![
                DbParameter::Text("Ada".into()),
                DbParameter::Text("it's ok".into())
            ]
        );
    }

    #[test]
    fn parameterized_batch_preserves_row_order_and_null_parameters() {
        let (sql, params) = build_parameterized_insert_batch_sql(
            DriverType::Postgres,
            "\"public\".\"people\"",
            &["name".into(), "note".into()],
            &[
                (1, vec!["Ada".into(), String::new()]),
                (2, vec!["Bob".into(), "hi".into()]),
            ],
            true,
        );
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"people\" (\"name\", \"note\") VALUES ($1, $2), ($3, $4);"
        );
        assert_eq!(
            params,
            vec![
                DbParameter::Text("Ada".into()),
                DbParameter::Null,
                DbParameter::Text("Bob".into()),
                DbParameter::Text("hi".into()),
            ]
        );
    }
}

#[cfg(test)]
mod stream_lifecycle_tests {
    use crate::drivers::trait_def::DatabaseDriver;
    use crate::models::{error::AppError, metadata::*};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct CancellingImportDriver {
        inner: Arc<dyn DatabaseDriver>,
        tasks: TaskManager,
        task_id: Uuid,
        cancel_after_write: usize,
        cancel_after_savepoint: bool,
        writes: AtomicUsize,
        rollback_gate: Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>,
    }

    #[async_trait::async_trait]
    impl DatabaseDriver for CancellingImportDriver {
        fn driver_name(&self) -> &'static str {
            "CSV cancellation fixture"
        }
        fn capabilities(&self) -> DriverCapabilities {
            self.inner.capabilities()
        }
        fn supports_parameterized_import(&self) -> bool {
            true
        }
        async fn ping(&self) -> Result<(), AppError> {
            self.inner.ping().await
        }
        async fn execute_query(
            &self,
            sql: &str,
            id: Option<&str>,
        ) -> Result<QueryResult, AppError> {
            if sql == "ROLLBACK" {
                if let Some((started, resume)) = &self.rollback_gate {
                    started.notify_one();
                    resume.notified().await;
                }
            }
            let result = self.inner.execute_query(sql, id).await;
            if self.cancel_after_savepoint && sql.starts_with("SAVEPOINT") {
                self.tasks.request_cancel(self.task_id).await.unwrap();
            }
            result
        }
        async fn execute_parameterized(
            &self,
            sql: &str,
            params: &[DbParameter],
            id: Option<&str>,
        ) -> Result<QueryResult, AppError> {
            let writes = self.writes.fetch_add(1, Ordering::Relaxed) + 1;
            let result = self.inner.execute_parameterized(sql, params, id).await;
            if writes == self.cancel_after_write {
                self.tasks.request_cancel(self.task_id).await.unwrap();
            }
            result
        }
        async fn execute_query_stream(
            &self,
            sql: &str,
            id: &str,
            size: usize,
            max: Option<u64>,
            chunks: tokio::sync::mpsc::Sender<
                Result<crate::models::query_result::QueryResultChunk, AppError>,
            >,
        ) -> Result<crate::models::query_result::QueryStreamSummary, AppError> {
            self.inner
                .execute_query_stream(sql, id, size, max, chunks)
                .await
        }
        async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
            self.inner.get_databases().await
        }
        async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
            self.inner.get_schemas(database).await
        }
        async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
            self.inner.get_tables(schema).await
        }
        async fn get_columns(
            &self,
            schema: &str,
            table: &str,
        ) -> Result<Vec<ColumnInfo>, AppError> {
            self.inner.get_columns(schema, table).await
        }
        async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
            self.inner.get_indexes(schema, table).await
        }
        async fn get_foreign_keys(
            &self,
            schema: &str,
            table: &str,
        ) -> Result<Vec<ForeignKeyInfo>, AppError> {
            self.inner.get_foreign_keys(schema, table).await
        }
        async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
            self.inner.get_views(schema).await
        }
        async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError> {
            self.inner.get_functions(schema).await
        }
        async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError> {
            self.inner.get_table_ddl(schema, table).await
        }
        async fn explain_query(
            &self,
            sql: &str,
            id: Option<&str>,
        ) -> Result<crate::models::query_result::ExplainResult, AppError> {
            self.inner.explain_query(sql, id).await
        }
        async fn cancel_query(&self, id: &str) -> Result<(), AppError> {
            self.inner.cancel_query(id).await
        }
    }

    async fn assert_cancelled_import(
        csv: &str,
        cancel_after_write: usize,
        cancel_after_savepoint: bool,
        dialect: DriverType,
    ) {
        let (mut connections, id) = connection().await;
        let mut operation = connections
            .begin_query_operation(id, "cancel-import")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let inner = operation.driver.clone();
        inner
            .execute_query(
                "CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)",
                None,
            )
            .await
            .unwrap();
        let columns = inner.get_columns("main", "items").await.unwrap();
        let path = ExportTestPath::new();
        tokio::fs::write(&path.0, csv).await.unwrap();
        let report_path = format!("{}.import-report.json", path.0.display());
        tokio::fs::write(&report_path, "previous report")
            .await
            .unwrap();
        let (tasks, handle) = task().await;
        tasks.start_task(handle.id, "Importing").await.unwrap();
        let driver = Arc::new(CancellingImportDriver {
            inner: inner.clone(),
            tasks: tasks.clone(),
            task_id: handle.id,
            cancel_after_write,
            cancel_after_savepoint,
            writes: AtomicUsize::new(0),
            rollback_gate: None,
        });
        operation.driver = driver.clone();
        let result = import_csv_rows(
            &ImportTableCsvInput {
                connection_id: id,
                driver_type: dialect,
                schema: "main".into(),
                table: "items".into(),
                path: path.0.to_string_lossy().into_owned(),
                has_header: true,
                delimiter: None,
                mapping: None,
                empty_as_null: true,
            },
            operation,
            columns,
            &tasks,
            &handle,
        )
        .await;
        assert!(
            matches!(result, Err(ExportTaskError::Cancelled)),
            "cancellation after an in-flight write must not commit"
        );
        assert_eq!(
            driver.writes.load(Ordering::Relaxed),
            if cancel_after_savepoint {
                0
            } else {
                cancel_after_write
            }
        );
        assert_eq!(
            inner
                .execute_query("SELECT COUNT(*) FROM items", None)
                .await
                .unwrap()
                .rows[0][0],
            json!(0)
        );
        assert_eq!(
            tokio::fs::read_to_string(&report_path).await.unwrap(),
            "previous report"
        );
        assert_eq!(
            tasks
                .finish_cancelled(handle.id, "Cancelled")
                .await
                .unwrap()
                .status,
            crate::services::task_manager::TaskStatus::Cancelled
        );
        tokio::fs::remove_file(&report_path).await.unwrap();
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn cancellation_after_last_import_batch_rolls_back_instead_of_committing() {
        assert_cancelled_import("id,name\n1,Ada\n2,Grace", 1, false, DriverType::Sqlite).await;
    }

    #[tokio::test]
    async fn import_cancel_after_batch_write_does_not_start_next_batch() {
        let mut csv = String::from("id,name\n");
        for row in 1..=205 {
            writeln!(&mut csv, "{row},row-{row}").unwrap();
        }
        assert_cancelled_import(&csv, 1, false, DriverType::Sqlite).await;
    }

    #[tokio::test]
    async fn import_cancel_after_savepoint_is_observed_before_first_batch_write() {
        assert_cancelled_import("id,name\n1,Ada\n2,Grace", 0, true, DriverType::Postgres).await;
    }

    #[tokio::test]
    async fn import_fallback_cancellation_stops_between_rows_and_after_last_row() {
        for cancel_after_write in [2, 4] {
            assert_cancelled_import(
                "id,name\n1,Ada\n1,duplicate\n2,Grace",
                cancel_after_write,
                false,
                DriverType::Sqlite,
            )
            .await;
        }
    }

    #[tokio::test]
    async fn import_single_row_path_stops_after_one_in_flight_write() {
        assert_cancelled_import("id,name\n1,Ada\n2,Grace", 1, false, DriverType::Oracle).await;
    }

    #[tokio::test]
    async fn cancelled_import_keeps_its_operation_lease_until_rollback_finishes() {
        let (mut connections, connection_id) = connection().await;
        let mut operation = connections
            .begin_query_operation(connection_id, "rollback-lease")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let inner = operation.driver.clone();
        inner
            .execute_query("CREATE TABLE items(id INTEGER, name TEXT)", None)
            .await
            .unwrap();
        let columns = inner.get_columns("main", "items").await.unwrap();
        let path = ExportTestPath::new();
        tokio::fs::write(&path.0, "id,name\n1,Ada\n").await.unwrap();
        let (tasks, handle) = task().await;
        let started = Arc::new(tokio::sync::Notify::new());
        let resume = Arc::new(tokio::sync::Notify::new());
        operation.driver = Arc::new(CancellingImportDriver {
            inner: inner.clone(),
            tasks: tasks.clone(),
            task_id: handle.id,
            cancel_after_write: 1,
            cancel_after_savepoint: false,
            writes: AtomicUsize::new(0),
            rollback_gate: Some((started.clone(), resume.clone())),
        });
        let input = ImportTableCsvInput {
            connection_id,
            driver_type: DriverType::Sqlite,
            schema: "main".into(),
            table: "items".into(),
            path: path.0.to_string_lossy().into_owned(),
            has_header: true,
            delimiter: None,
            mapping: None,
            empty_as_null: true,
        };
        let importer = import_csv_rows(&input, operation, columns, &tasks, &handle);
        let observer = async {
            started.notified().await;
            assert!(
                connections.disconnect(connection_id).is_err(),
                "rollback still owns the database session"
            );
            resume.notify_one();
        };
        let (result, ()) = tokio::time::timeout(StdDuration::from_secs(2), async {
            tokio::join!(importer, observer)
        })
        .await
        .unwrap();
        assert!(matches!(result, Err(ExportTaskError::Cancelled)));
        assert_eq!(
            inner
                .execute_query("SELECT COUNT(*) FROM items", None)
                .await
                .unwrap()
                .rows[0][0],
            json!(0)
        );
        connections.disconnect(connection_id).unwrap();
    }
    use super::*;
    use serde_json::json;
    use std::fmt::Write as _;
    use std::time::Duration as StdDuration;

    #[tokio::test]
    async fn import_rejects_a_file_that_changes_between_passes() {
        let path = std::env::temp_dir().join(format!(
            "vaporlensdb-import-snapshot-{}.csv",
            Uuid::new_v4()
        ));
        tokio::fs::write(&path, "id\n1\n").await.unwrap();
        let snapshot = import_file_snapshot(&path).await.unwrap();
        tokio::time::sleep(StdDuration::from_millis(2)).await;
        tokio::fs::write(&path, "id\n1\n2\n").await.unwrap();
        let error = ensure_import_file_unchanged(&path, &snapshot)
            .await
            .expect_err("modified CSV must be rejected");
        match error {
            ExportTaskError::Failed(AppError::ConfigError(message)) => {
                assert!(message.contains("CSV file changed"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
        let _ = tokio::fs::remove_file(path).await;
    }
    use crate::services::connection_manager::{create_active_connection, ConnectionManager};
    use crate::services::task_manager::TaskManager;
    use tokio::sync::oneshot;

    fn live_csv_config(
        driver_type: DriverType,
    ) -> Option<(crate::models::connection::ConnectionConfig, String, String)> {
        use chrono::Utc;
        let (url_name, user_name, password_name, database_name, prefix, default_port) =
            match driver_type {
                DriverType::Postgres => (
                    "TEST_PG_JDBC_URL",
                    "TEST_PG_USER",
                    "TEST_PG_PASSWORD",
                    "TEST_PG_DATABASE",
                    "jdbc:postgresql://",
                    5432,
                ),
                DriverType::Mysql => (
                    "TEST_MYSQL_JDBC_URL",
                    "TEST_MYSQL_USER",
                    "TEST_MYSQL_PASSWORD",
                    "TEST_MYSQL_DATABASE",
                    "jdbc:mysql://",
                    3306,
                ),
                _ => return None,
            };
        let url = std::env::var(url_name).ok()?;
        let target = url.strip_prefix(prefix)?;
        let (authority, url_database) = target.split_once('/').unwrap_or((target, ""));
        let (host, port) = authority.rsplit_once(':').unwrap_or((authority, ""));
        let database = std::env::var(database_name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| url_database.split('?').next().map(str::to_string))?;
        let username = std::env::var(user_name).ok()?;
        let password = std::env::var(password_name).ok()?;
        let now = Utc::now();
        Some((
            crate::models::connection::ConnectionConfig {
                id: Uuid::new_v4(),
                name: "CSV import live acceptance".into(),
                driver_definition_id: None,
                driver_type,
                driver_dialect: None,
                host: Some(host.to_string()),
                port: Some(if port.is_empty() {
                    default_port
                } else {
                    port.parse().ok()?
                }),
                database: Some(database.clone()),
                connection_url: None,
                username: Some(username),
                password_encrypted: None,
                has_saved_password: false,
                driver_class: None,
                driver_paths: Vec::new(),
                ssl_mode: None,
                group_id: None,
                group: None,
                color_tag: None,
                ssh_tunnel: None,
                created_at: now,
                updated_at: now,
            },
            password,
            if driver_type == DriverType::Postgres {
                "public".into()
            } else {
                database
            },
        ))
    }

    async fn live_parameterized_csv_import(driver_type: DriverType) {
        assert_eq!(
            std::env::var("VAPORLENSDB_QA_ENVIRONMENT").as_deref(),
            Ok("1"),
            "refusing CSV fixture mutation without VAPORLENSDB_QA_ENVIRONMENT=1"
        );
        let (config, password, schema) = live_csv_config(driver_type)
            .expect("live native CSV environment variables must be set");
        let id = config.id;
        let mut connections = ConnectionManager::new();
        connections.begin_connect(id).unwrap();
        let active = create_active_connection(&config, Some(&password), None)
            .await
            .expect("connect native CSV acceptance driver");
        connections.finish_connect(id, Ok(active)).unwrap();
        let marker = connections
            .driver(id)
            .unwrap()
            .execute_query(
                "SELECT environment, fixture_version FROM vaporlensdb_qa_marker",
                None,
            )
            .await
            .expect("disposable QA marker must exist");
        assert_eq!(marker.rows.len(), 1);
        assert_eq!(marker.rows[0][0], json!("disposable_qa"));
        assert!(
            marker.rows[0][1] == json!(1) || marker.rows[0][1] == json!("1"),
            "unexpected disposable QA fixture version: {}",
            marker.rows[0][1]
        );
        let suffix = Uuid::new_v4().simple().to_string();
        let table_name = format!("vaporlensdb_csv_{suffix}");
        let victim_name = format!("vaporlensdb_victim_{suffix}");
        let table = qualified_table(driver_type, &schema, &table_name);
        let victim = qualified_table(driver_type, &schema, &victim_name);
        let setup = connections
            .begin_query_operation(id, "csv-live-setup")
            .unwrap()
            .wait()
            .await
            .unwrap();
        setup
            .driver
            .execute_query(&format!("CREATE TABLE {victim} (marker INTEGER)"), None)
            .await
            .unwrap();
        setup
            .driver
            .execute_query(
                &format!("CREATE TABLE {table} (id INTEGER PRIMARY KEY, note TEXT NULL)"),
                None,
            )
            .await
            .unwrap();
        drop(setup);

        let path = ExportTestPath::new();
        let mut csv = String::from("id,note\n1,plain\n2,O'Reilly\n3,\"double \"\"quote\"\"\"\n4,back\\slash\n5,semi;colon\n6,\"line\nbreak\"\n7,中文\n8,emoji😀\n9,\n10,\"'); DROP TABLE victim; --\"\n");
        for row in 11..=205 {
            writeln!(&mut csv, "{row},batch-{row}").unwrap();
        }
        csv.push_str("1,constraint-fallback\n");
        tokio::fs::write(&path.0, csv).await.unwrap();
        let operation = connections
            .begin_query_operation(id, "csv-live-import")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let columns = operation
            .driver
            .get_columns(&schema, &table_name)
            .await
            .unwrap();
        let (manager, handle) = task().await;
        let report = import_csv_rows(
            &ImportTableCsvInput {
                connection_id: id,
                driver_type,
                schema: schema.clone(),
                table: table_name.clone(),
                path: path.0.to_string_lossy().into_owned(),
                has_header: true,
                delimiter: None,
                mapping: None,
                empty_as_null: true,
            },
            operation,
            columns,
            &manager,
            &handle,
        )
        .await
        .unwrap();
        assert_eq!(report.inserted_rows, 205, "{report:?}");
        assert_eq!(report.failed_write_count, 1);

        let empty_path = ExportTestPath::new();
        tokio::fs::write(&empty_path.0, "id,note\n206,\n")
            .await
            .unwrap();
        let operation = connections
            .begin_query_operation(id, "csv-live-empty")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let columns = operation
            .driver
            .get_columns(&schema, &table_name)
            .await
            .unwrap();
        let (manager, handle) = task().await;
        import_csv_rows(
            &ImportTableCsvInput {
                connection_id: id,
                driver_type,
                schema: schema.clone(),
                table: table_name.clone(),
                path: empty_path.0.to_string_lossy().into_owned(),
                has_header: true,
                delimiter: None,
                mapping: None,
                empty_as_null: false,
            },
            operation,
            columns,
            &manager,
            &handle,
        )
        .await
        .unwrap();

        let verify = connections
            .driver(id)
            .unwrap()
            .execute_query(
                &format!("SELECT id, note FROM {table} WHERE id <= 10 OR id = 206 ORDER BY id"),
                None,
            )
            .await
            .unwrap();
        assert_eq!(verify.rows[1][1], json!("O'Reilly"));
        assert_eq!(verify.rows[5][1], json!("line\nbreak"));
        assert_eq!(verify.rows[6][1], json!("中文"));
        assert_eq!(verify.rows[7][1], json!("emoji😀"));
        assert_eq!(verify.rows[8][1], serde_json::Value::Null);
        assert_eq!(verify.rows[9][1], json!("'); DROP TABLE victim; --"));
        assert_eq!(verify.rows[10][1], json!(""));
        connections
            .driver(id)
            .unwrap()
            .execute_query(&format!("SELECT COUNT(*) FROM {victim}"), None)
            .await
            .unwrap();
        if driver_type == DriverType::Postgres {
            let wide_name = format!("vaporlensdb_csv_wide_{suffix}");
            let wide_table = qualified_table(driver_type, &schema, &wide_name);
            let columns = (1..=321)
                .map(|index| format!("c{index}"))
                .collect::<Vec<_>>();
            let ddl_columns = columns
                .iter()
                .map(|column| format!("\"{column}\" TEXT"))
                .collect::<Vec<_>>()
                .join(", ");
            connections
                .driver(id)
                .unwrap()
                .execute_query(&format!("CREATE TABLE {wide_table} ({ddl_columns})"), None)
                .await
                .unwrap();
            let wide_path = ExportTestPath::new();
            let mut wide_csv = format!("{}\n", columns.join(","));
            let row = (1..=321)
                .map(|index| format!("v{index}"))
                .collect::<Vec<_>>()
                .join(",");
            for _ in 0..101 {
                writeln!(&mut wide_csv, "{row}").unwrap();
            }
            tokio::fs::write(&wide_path.0, wide_csv).await.unwrap();
            let operation = connections
                .begin_query_operation(id, "csv-live-wide")
                .unwrap()
                .wait()
                .await
                .unwrap();
            let metadata = operation
                .driver
                .get_columns(&schema, &wide_name)
                .await
                .unwrap();
            let (manager, handle) = task().await;
            let report = import_csv_rows(
                &ImportTableCsvInput {
                    connection_id: id,
                    driver_type,
                    schema: schema.clone(),
                    table: wide_name,
                    path: wide_path.0.to_string_lossy().into_owned(),
                    has_header: true,
                    delimiter: None,
                    mapping: None,
                    empty_as_null: true,
                },
                operation,
                metadata,
                &manager,
                &handle,
            )
            .await
            .unwrap();
            assert_eq!(report.inserted_rows, 101);
            connections
                .driver(id)
                .unwrap()
                .execute_query(&format!("DROP TABLE {wide_table}"), None)
                .await
                .unwrap();
        }
        connections
            .driver(id)
            .unwrap()
            .execute_query(&format!("DROP TABLE {table}"), None)
            .await
            .unwrap();
        connections
            .driver(id)
            .unwrap()
            .execute_query(&format!("DROP TABLE {victim}"), None)
            .await
            .unwrap();
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    #[ignore = "requires native PostgreSQL live CSV environment"]
    async fn real_postgres_parameterized_csv_import_uses_production_pipeline() {
        live_parameterized_csv_import(DriverType::Postgres).await;
    }

    #[tokio::test]
    #[ignore = "requires native MySQL live CSV environment"]
    async fn real_mysql_parameterized_csv_import_uses_production_pipeline() {
        live_parameterized_csv_import(DriverType::Mysql).await;
    }

    struct DropSignal(Option<oneshot::Sender<()>>);
    impl Drop for DropSignal {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    fn summary() -> QueryStreamSummary {
        QueryStreamSummary {
            query_id: "export-test".into(),
            row_count: 1,
            affected_rows: 0,
            elapsed_ms: 0,
            truncated: false,
            max_rows: None,
        }
    }

    async fn task() -> (TaskManager, TaskHandle) {
        let manager = TaskManager::new();
        let task = manager.create_task("test", "stream export", None).await;
        let handle = manager.handle(task.id).await.unwrap();
        (manager, handle)
    }

    async fn connection() -> (ConnectionManager, Uuid) {
        let id = Uuid::new_v4();
        let config = serde_json::from_value(serde_json::json!({
            "id": id, "name": "CSV lease test", "driverType": "sqlite",
            "connectionUrl": ":memory:", "driverPaths": [],
            "createdAt": "2026-09-22T00:00:00Z", "updatedAt": "2026-09-22T00:00:00Z"
        }))
        .unwrap();
        let mut manager = ConnectionManager::new();
        manager.begin_connect(id).unwrap();
        manager
            .finish_connect(id, create_active_connection(&config, None, None).await)
            .unwrap();
        (manager, id)
    }

    #[test]
    fn full_query_export_rejects_reconnected_or_inactive_sources() {
        assert!(validate_query_export_generation(7, 7).is_ok());
        assert!(validate_query_export_generation(8, 7).is_err());
        assert!(validate_query_export_transaction(ConsoleTransactionPhase::Active).is_ok());
        assert!(validate_query_export_transaction(ConsoleTransactionPhase::Idle).is_err());
        assert!(validate_query_export_transaction(ConsoleTransactionPhase::Failed).is_err());
    }

    #[tokio::test]
    async fn staged_export_publishes_only_success_and_cleans_failed_or_cancelled_files() {
        let successful = ExportTestPath::new();
        let successful_stage = staged_export_path(&successful.0).unwrap();
        tokio::fs::write(&successful_stage, "complete")
            .await
            .unwrap();
        let report = finalize_staged_export(
            Ok(ExportReport {
                path: successful_stage.to_string_lossy().into_owned(),
                row_count: 1,
                bytes_written: 8,
            }),
            &successful_stage,
            &successful.0,
        )
        .await
        .unwrap();
        assert_eq!(report.path, successful.0.to_string_lossy());
        assert_eq!(
            tokio::fs::read_to_string(&successful.0).await.unwrap(),
            "complete"
        );
        assert!(!successful_stage.exists());

        let existing = ExportTestPath::new();
        tokio::fs::write(&existing.0, "original").await.unwrap();
        let existing_stage = staged_export_path(&existing.0).unwrap();
        tokio::fs::write(&existing_stage, "replacement")
            .await
            .unwrap();
        assert!(finalize_staged_export(
            Ok(ExportReport {
                path: existing_stage.to_string_lossy().into_owned(),
                row_count: 1,
                bytes_written: 11,
            }),
            &existing_stage,
            &existing.0,
        )
        .await
        .is_err());
        assert_eq!(
            tokio::fs::read_to_string(&existing.0).await.unwrap(),
            "original"
        );
        assert!(!existing_stage.exists());

        for cancelled in [false, true] {
            let failed = ExportTestPath::new();
            let failed_stage = staged_export_path(&failed.0).unwrap();
            tokio::fs::write(&failed_stage, "partial").await.unwrap();
            let error = if cancelled {
                ExportTaskError::Cancelled
            } else {
                ExportTaskError::Failed(AppError::ConfigError("write failed".into()))
            };
            assert!(finalize_staged_export(Err(error), &failed_stage, &failed.0)
                .await
                .is_err());
            assert!(!failed.0.exists());
            assert!(!failed_stage.exists());
        }
    }

    #[tokio::test]
    async fn stale_export_cleanup_only_removes_owned_uuid_parts() {
        let directory = ExportTestDirectory::new();
        let final_path = directory.0.join("result.csv");
        let owned = staged_export_path(&final_path).unwrap();
        let recent = staged_export_path(&final_path).unwrap();
        let malformed = directory.0.join(".vaporlensdb-export-not-a-uuid.part");
        let unrelated = directory.0.join(".other-export.part");
        for path in [&owned, &recent, &malformed, &unrelated] {
            tokio::fs::write(path, "partial").await.unwrap();
        }

        cleanup_stale_export_parts(&final_path, STALE_EXPORT_PART_AGE).await;
        assert!(owned.exists());
        assert!(recent.exists());

        cleanup_stale_export_parts(&final_path, Duration::ZERO).await;
        assert!(!owned.exists());
        assert!(!recent.exists());
        assert!(malformed.exists());
        assert!(unrelated.exists());
    }

    struct ExportTestPath(PathBuf);
    impl ExportTestPath {
        fn new() -> Self {
            Self(
                std::env::temp_dir()
                    .join(format!("vaporlensdb-export-lease-{}.csv", Uuid::new_v4())),
            )
        }
    }
    impl Drop for ExportTestPath {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    struct ExportTestDirectory(PathBuf);
    impl ExportTestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("vaporlensdb-export-directory-{}", Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for ExportTestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn cancelling_queued_csv_releases_only_its_own_occupancy() {
        let (mut connections, id) = connection().await;
        let running = connections
            .begin_query_operation(id, "ordinary")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let queued = connections.begin_query_operation(id, "export").unwrap();
        let (manager, handle) = task().await;
        let (result, ()) = tokio::join!(wait_csv_operation(queued, &handle), async {
            manager.request_cancel(handle.id).await.unwrap();
        });
        assert!(matches!(result, Err(ExportTaskError::Cancelled)));
        assert!(!connections.cancel_queued_query(id, "export"));
        assert!(connections.disconnect(id).is_err());
        assert!(running
            .driver
            .execute_query("SELECT 42", None)
            .await
            .is_ok());
        drop(running);
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn csv_task_rejects_a_retired_ready_operation_before_starting_work() {
        let (mut connections, id) = connection().await;
        let operation = connections.begin_query_operation(id, "export").unwrap();
        connections.invalidate_connection(id, "retired before background start");
        let (_, handle) = task().await;
        assert!(matches!(
            wait_csv_operation(operation, &handle).await,
            Err(ExportTaskError::Failed(_))
        ));
    }

    #[tokio::test]
    async fn shared_export_lease_survives_outer_owner_drop() {
        let (mut connections, id) = connection().await;
        let operation = Arc::new(
            connections
                .begin_query_operation(id, "export")
                .unwrap()
                .wait()
                .await
                .unwrap(),
        );
        let worker_owner = operation.clone();
        drop(operation);
        assert!(connections.disconnect(id).is_err());
        drop(worker_owner);
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn sqlite_query_and_table_exports_release_their_leases() {
        for table_export in [false, true] {
            let (mut connections, id) = connection().await;
            let operation = connections
                .begin_query_operation(id, "export")
                .unwrap()
                .wait()
                .await
                .unwrap();
            operation
                .driver
                .execute_query("CREATE TABLE items (id INTEGER, name TEXT)", None)
                .await
                .unwrap();
            operation
                .driver
                .execute_query("INSERT INTO items VALUES (1, 'Ada')", None)
                .await
                .unwrap();
            let path = ExportTestPath::new();
            let (manager, handle) = task().await;
            let result = if table_export {
                let columns = operation.driver.get_columns("main", "items").await.unwrap();
                write_table_csv(
                    &ExportTableCsvInput {
                        connection_id: id,
                        driver_type: DriverType::Sqlite,
                        schema: "main".into(),
                        table: "items".into(),
                        path: path.0.to_string_lossy().into_owned(),
                        include_header: true,
                        max_rows: None,
                    },
                    Arc::new(operation),
                    columns,
                    &path.0,
                    &manager,
                    &handle,
                )
                .await
            } else {
                write_streamed_query_csv(
                    &ExportQueryCsvInput {
                        connection_id: id,
                        connection_generation: operation.generation,
                        sql: "SELECT * FROM items".into(),
                        database: None,
                        schema: None,
                        console_id: None,
                        path: path.0.to_string_lossy().into_owned(),
                        include_header: true,
                    },
                    Arc::new(QueryExportOperation::Auto(operation)),
                    &path.0,
                    &manager,
                    &handle,
                )
                .await
            };
            assert!(matches!(result, Ok(report) if report.row_count == 1));
            assert_eq!(
                tokio::fs::read_to_string(&path.0).await.unwrap(),
                "id,name\r\n1,Ada"
            );
            connections.disconnect(id).unwrap();
        }
    }

    #[tokio::test]
    async fn table_export_keeps_readable_generated_and_defaulted_columns_with_or_without_headers() {
        for kind in ["normal", "generated-only", "mixed", "defaulted", "empty"] {
            for include_header in [true, false] {
                let (mut connections, id) = connection().await;
                let operation = connections
                    .begin_query_operation(id, "column-export")
                    .unwrap()
                    .wait()
                    .await
                    .unwrap();
                operation
                    .driver
                    .execute_query(
                        "CREATE TABLE items (id INTEGER, name TEXT DEFAULT 'Ada')",
                        None,
                    )
                    .await
                    .unwrap();
                operation
                    .driver
                    .execute_query("INSERT INTO items VALUES (1, 'Ada')", None)
                    .await
                    .unwrap();
                let mut columns = operation.driver.get_columns("main", "items").await.unwrap();
                match kind {
                    "generated-only" => {
                        columns.truncate(1);
                        columns[0].default_value = Some("GENERATED ALWAYS AS IDENTITY".into());
                    }
                    "mixed" => {
                        columns[0].default_value = Some("GENERATED ALWAYS AS IDENTITY".into())
                    }
                    "empty" => columns.clear(),
                    _ => {}
                }
                let path = ExportTestPath::new();
                let (manager, handle) = task().await;
                let result = write_table_csv(
                    &ExportTableCsvInput {
                        connection_id: id,
                        driver_type: DriverType::Sqlite,
                        schema: "main".into(),
                        table: "items".into(),
                        path: path.0.to_string_lossy().into_owned(),
                        include_header,
                        max_rows: None,
                    },
                    Arc::new(operation),
                    columns,
                    &path.0,
                    &manager,
                    &handle,
                )
                .await;
                if kind == "empty" {
                    assert!(
                        matches!(result, Err(ExportTaskError::Failed(AppError::ConfigError(message))) if message == "table has no readable/exportable columns")
                    );
                } else {
                    let report = result.unwrap();
                    assert_eq!(report.row_count, 1);
                    let expected = match (kind, include_header) {
                        ("generated-only", true) => "id\r\n1",
                        ("generated-only", false) => "1",
                        (_, true) => "id,name\r\n1,Ada",
                        (_, false) => "1,Ada",
                    };
                    assert_eq!(tokio::fs::read_to_string(&path.0).await.unwrap(), expected);
                }
                connections.disconnect(id).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn sqlite_csv_import_releases_lease_on_success_cancel_and_invalid_mapping() {
        for scenario in ["success", "cancel", "invalid", "malformed"] {
            let (mut connections, id) = connection().await;
            let operation = connections
                .begin_query_operation(id, "import")
                .unwrap()
                .wait()
                .await
                .unwrap();
            operation
                .driver
                .execute_query("CREATE TABLE items (id INTEGER, name TEXT)", None)
                .await
                .unwrap();
            let columns = operation.driver.get_columns("main", "items").await.unwrap();
            let path = ExportTestPath::new();
            tokio::fs::write(&path.0, "id,name\n1,Ada\n2,Grace")
                .await
                .unwrap();
            let preview = preview_csv_import(
                &PreviewTableCsvImportInput {
                    connection_id: id,
                    schema: "main".into(),
                    table: "items".into(),
                    path: path.0.to_string_lossy().into_owned(),
                    has_header: true,
                    delimiter: None,
                    mapping: None,
                    empty_as_null: true,
                    preview_rows: None,
                    sample_only: false,
                    task_id: None,
                },
                &columns,
            )
            .await
            .unwrap();
            assert!(preview.can_import);
            let (manager, handle) = task().await;
            if scenario == "cancel" {
                manager.request_cancel(handle.id).await.unwrap();
            }
            if scenario == "invalid" {
                tokio::fs::write(&path.0, "missing\nvalue").await.unwrap();
            } else if scenario == "malformed" {
                tokio::fs::write(&path.0, "id,name\n1,Ada\n2,\"unterminated")
                    .await
                    .unwrap();
            }
            let result = import_csv_rows(
                &ImportTableCsvInput {
                    connection_id: id,
                    driver_type: DriverType::Sqlite,
                    schema: "main".into(),
                    table: "items".into(),
                    path: path.0.to_string_lossy().into_owned(),
                    has_header: true,
                    delimiter: None,
                    mapping: None,
                    empty_as_null: true,
                },
                operation,
                columns,
                &manager,
                &handle,
            )
            .await;
            match scenario {
                "success" => assert!(matches!(result, Ok(report) if report.inserted_rows == 2)),
                "cancel" => assert!(matches!(result, Err(ExportTaskError::Cancelled))),
                _ => assert!(matches!(result, Err(ExportTaskError::Failed(_)))),
            }
            let result = connections
                .driver(id)
                .unwrap()
                .execute_query("SELECT COUNT(*) FROM items", None)
                .await
                .unwrap();
            assert_eq!(
                result.rows[0][0],
                serde_json::json!(if scenario == "success" { 2 } else { 0 })
            );
            connections.disconnect(id).unwrap();
        }
    }

    #[tokio::test]
    async fn csv_workflow_options_preview_and_import_share_semantics() {
        for delimiter in [",", "\t", ";", "|"] {
            for has_header in [true, false] {
                for empty_as_null in [true, false] {
                    let (mut connections, id) = connection().await;
                    let operation = connections
                        .begin_query_operation(id, "csv-options")
                        .unwrap()
                        .wait()
                        .await
                        .unwrap();
                    operation.driver.execute_query("CREATE TABLE items (id INTEGER, note TEXT, optional TEXT DEFAULT 'default', generated TEXT GENERATED ALWAYS AS (note) VIRTUAL)", None).await.unwrap();
                    let columns = operation.driver.get_columns("main", "items").await.unwrap();
                    let path = ExportTestPath::new();
                    let csv = format!("{}1{delimiter}{delimiter}extra\n2{delimiter}\"\"{delimiter}extra\n3{delimiter}NULL{delimiter}extra\n", if has_header { format!("\u{feff}source_id{delimiter}note{delimiter}ignored\n") } else { "\u{feff}".into() });
                    tokio::fs::write(&path.0, csv).await.unwrap();
                    let mapping = vec![Some("id".into()), Some("note".into()), None];
                    let preview_input = PreviewTableCsvImportInput {
                        connection_id: id,
                        schema: "main".into(),
                        table: "items".into(),
                        path: path.0.to_string_lossy().into(),
                        has_header,
                        delimiter: Some(delimiter.into()),
                        mapping: Some(mapping.clone()),
                        empty_as_null,
                        preview_rows: Some(20),
                        sample_only: false,
                        task_id: None,
                    };
                    let preview = preview_csv_import(&preview_input, &columns).await.unwrap();
                    assert_eq!(preview.total_rows, 3);
                    assert_eq!(
                        preview.headers[0],
                        if has_header { "source_id" } else { "Column 1" }
                    );
                    assert_eq!(preview.rows[0], vec!["1", "", "extra"]);
                    assert_eq!(preview.rows[1][1], ""); // Quote origin is intentionally not retained.
                    assert_eq!(preview.rows[2][1], "NULL");
                    assert!(!preview.target_columns.contains(&"generated".to_string()));
                    let (manager, handle) = task().await;
                    let report = import_csv_rows(
                        &ImportTableCsvInput {
                            connection_id: id,
                            driver_type: DriverType::Sqlite,
                            schema: "main".into(),
                            table: "items".into(),
                            path: preview_input.path,
                            has_header,
                            delimiter: preview_input.delimiter,
                            mapping: preview_input.mapping,
                            empty_as_null: preview_input.empty_as_null,
                        },
                        operation,
                        columns,
                        &manager,
                        &handle,
                    )
                    .await
                    .unwrap();
                    assert_eq!(report.inserted_rows, 3);
                    let result = connections
                        .driver(id)
                        .unwrap()
                        .execute_query("SELECT note, optional FROM items ORDER BY id", None)
                        .await
                        .unwrap();
                    let expected = if empty_as_null {
                        serde_json::Value::Null
                    } else {
                        json!("")
                    };
                    assert_eq!(result.rows[0][0], expected);
                    assert_eq!(result.rows[1][0], expected);
                    assert_eq!(result.rows[2][0], json!("NULL"));
                    assert_eq!(result.rows[2][1], json!("default"));
                    connections.disconnect(id).unwrap();
                }
            }
        }
    }

    #[tokio::test]
    async fn csv_workflow_partial_and_full_failure_report_row_numbers() {
        for csv in [
            "id,note\n1,first\n1,second\n2,third",
            "id,note\n0,first\n0,second",
        ] {
            let (mut connections, id) = connection().await;
            let operation = connections
                .begin_query_operation(id, "csv-report")
                .unwrap()
                .wait()
                .await
                .unwrap();
            operation
                .driver
                .execute_query(
                    "CREATE TABLE items (id INTEGER PRIMARY KEY CHECK(id > 0), note TEXT)",
                    None,
                )
                .await
                .unwrap();
            let columns = operation.driver.get_columns("main", "items").await.unwrap();
            let path = ExportTestPath::new();
            tokio::fs::write(&path.0, csv).await.unwrap();
            let (manager, handle) = task().await;
            let report = import_csv_rows(
                &ImportTableCsvInput {
                    connection_id: id,
                    driver_type: DriverType::Sqlite,
                    schema: "main".into(),
                    table: "items".into(),
                    path: path.0.to_string_lossy().into(),
                    has_header: true,
                    delimiter: None,
                    mapping: Some(vec![Some("id".into()), Some("note".into())]),
                    empty_as_null: true,
                },
                operation,
                columns,
                &manager,
                &handle,
            )
            .await
            .unwrap();
            let ui = csv_ui_report(&report);
            if csv.contains("third") {
                assert_eq!((ui.inserted_rows, ui.failed_rows), (2, 1));
                assert_eq!(ui.failures[0].row_number, 3);
            } else {
                assert_eq!((ui.inserted_rows, ui.failed_rows), (0, 2));
                assert_eq!(ui.failures[0].row_number, 2);
            }
            assert!(ui.failures.iter().all(|row| row.values.is_empty()));
            let _ = tokio::fs::remove_file(&report.path).await;
            connections.disconnect(id).unwrap();
        }
    }

    #[tokio::test]
    async fn sqlite_parameterized_import_preserves_sql_looking_values() {
        let (mut connections, id) = connection().await;
        let operation = connections
            .begin_query_operation(id, "parameterized-import")
            .unwrap()
            .wait()
            .await
            .unwrap();
        operation
            .driver
            .execute_query("CREATE TABLE victim (marker TEXT)", None)
            .await
            .unwrap();
        operation
            .driver
            .execute_query("CREATE TABLE items (id INTEGER, note TEXT)", None)
            .await
            .unwrap();
        let columns = operation.driver.get_columns("main", "items").await.unwrap();
        let path = ExportTestPath::new();
        tokio::fs::write(
            &path.0,
            "id,note\n1,\"O'Reilly\"\n2,\"\"\"a\"\"\"\n3,\"back\\slash\"\n4,\"semi;colon\"\n5,\"line\nbreak\"\n6,\"中文 😀\"\n7,\"'); DROP TABLE victim; --\"\n8,\n",
        )
        .await
        .unwrap();
        let (manager, handle) = task().await;
        let report = import_csv_rows(
            &ImportTableCsvInput {
                connection_id: id,
                driver_type: DriverType::Sqlite,
                schema: "main".into(),
                table: "items".into(),
                path: path.0.to_string_lossy().into_owned(),
                has_header: true,
                delimiter: None,
                mapping: None,
                empty_as_null: true,
            },
            operation,
            columns,
            &manager,
            &handle,
        )
        .await
        .unwrap();
        assert_eq!(report.inserted_rows, 8);
        let values = connections
            .driver(id)
            .unwrap()
            .execute_query("SELECT note FROM items ORDER BY id", None)
            .await
            .unwrap();
        assert_eq!(values.rows.len(), 8);
        assert_eq!(values.rows[0][0], json!("O'Reilly"));
        assert_eq!(values.rows[1][0], json!("\"a\""));
        assert_eq!(values.rows[2][0], json!("back\\slash"));
        assert_eq!(values.rows[3][0], json!("semi;colon"));
        assert_eq!(values.rows[4][0], json!("line\nbreak"));
        assert_eq!(values.rows[5][0], json!("中文 😀"));
        assert_eq!(values.rows[6][0], json!("'); DROP TABLE victim; --"));
        assert_eq!(values.rows[7][0], serde_json::Value::Null);
        assert_eq!(
            connections
                .driver(id)
                .unwrap()
                .execute_query("SELECT COUNT(*) FROM victim", None)
                .await
                .unwrap()
                .rows[0][0],
            json!(0)
        );
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn sqlite_parameterized_import_batches_rows_and_respects_nulls() {
        let (mut connections, id) = connection().await;
        let operation = connections
            .begin_query_operation(id, "parameterized-batch-import")
            .unwrap()
            .wait()
            .await
            .unwrap();
        operation
            .driver
            .execute_query("CREATE TABLE items (id INTEGER, note TEXT)", None)
            .await
            .unwrap();
        let columns = operation.driver.get_columns("main", "items").await.unwrap();
        let mut csv = String::from("id,note\n");
        for id in 1..=250 {
            writeln!(&mut csv, "{id},note-{id}").unwrap();
        }
        csv.push_str("251,\n");
        let path = ExportTestPath::new();
        tokio::fs::write(&path.0, csv).await.unwrap();
        let (manager, handle) = task().await;
        let report = import_csv_rows(
            &ImportTableCsvInput {
                connection_id: id,
                driver_type: DriverType::Sqlite,
                schema: "main".into(),
                table: "items".into(),
                path: path.0.to_string_lossy().into_owned(),
                has_header: true,
                delimiter: None,
                mapping: None,
                empty_as_null: true,
            },
            operation,
            columns,
            &manager,
            &handle,
        )
        .await
        .unwrap();
        assert_eq!(report.inserted_rows, 251);
        let result = connections
            .driver(id)
            .unwrap()
            .execute_query(
                "SELECT COUNT(*), MAX(id), SUM(note IS NULL) FROM items",
                None,
            )
            .await
            .unwrap();
        assert_eq!(result.rows[0][0], json!(251));
        assert_eq!(result.rows[0][1], json!(251));
        assert_eq!(result.rows[0][2], json!(1));
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn file_creation_error_and_pre_cancel_release_export_leases() {
        for pre_cancel in [false, true] {
            let (mut connections, id) = connection().await;
            let operation = connections
                .begin_query_operation(id, "export")
                .unwrap()
                .wait()
                .await
                .unwrap();
            let (manager, handle) = task().await;
            if pre_cancel {
                manager.request_cancel(handle.id).await.unwrap();
            }
            // A fresh random path is absent, so a child file cannot be created.
            let missing_parent = ExportTestPath::new();
            let path = missing_parent.0.join("output.csv");
            let result = write_streamed_query_csv(
                &ExportQueryCsvInput {
                    connection_id: id,
                    connection_generation: operation.generation,
                    sql: "SELECT 1".into(),
                    database: None,
                    schema: None,
                    console_id: None,
                    path: path.to_string_lossy().into_owned(),
                    include_header: true,
                },
                Arc::new(QueryExportOperation::Auto(operation)),
                &path,
                &manager,
                &handle,
            )
            .await;
            if pre_cancel {
                assert!(matches!(result, Err(ExportTaskError::Cancelled)));
            } else {
                assert!(matches!(result, Err(ExportTaskError::Failed(_))));
            }
            assert!(!path.exists());
            connections.disconnect(id).unwrap();
        }
    }

    #[tokio::test]
    async fn successful_stream_drains_rows_and_does_not_cancel() {
        let (_, handle) = task().await;
        let (tx, mut rx) = mpsc::channel(1);
        let result = run_export_stream(
            &handle,
            async move {
                tx.send(7_u64).await.unwrap();
                Ok(summary())
            },
            async move {
                let mut total = 0;
                while let Some(value) = rx.recv().await {
                    total += value;
                }
                Ok(total)
            },
            async { panic!("successful query must not be cancelled") },
            Duration::from_millis(20),
        )
        .await;
        let Ok((bytes, summary)) = result else {
            panic!("export should succeed")
        };
        assert_eq!(bytes, 7);
        assert_eq!(summary.row_count, 1);
    }

    #[tokio::test]
    async fn pre_cancelled_export_does_not_start_query_or_writer() {
        let (manager, handle) = task().await;
        manager.request_cancel(handle.id).await.unwrap();
        let result = run_export_stream::<()>(
            &handle,
            async { panic!("query must not start") },
            async { panic!("writer must not start") },
            async { panic!("driver cancellation is unnecessary") },
            Duration::from_millis(20),
        )
        .await;
        assert!(matches!(result, Err(ExportTaskError::Cancelled)));
    }

    #[tokio::test]
    async fn cancellation_before_first_chunk_or_during_summary_wait_reaps_query() {
        for waiting_for_summary in [false, true] {
            let (manager, handle) = task().await;
            let (ready_tx, ready_rx) = oneshot::channel();
            let (dropped_tx, dropped_rx) = oneshot::channel();
            let (tx, mut rx) = mpsc::channel::<()>(1);
            let export = run_export_stream(
                &handle,
                async move {
                    let _guard = DropSignal(Some(dropped_tx));
                    let _sender = if waiting_for_summary {
                        drop(tx);
                        None
                    } else {
                        Some(tx)
                    };
                    ready_tx.send(()).unwrap();
                    std::future::pending::<Result<QueryStreamSummary, AppError>>().await
                },
                async move {
                    while rx.recv().await.is_some() {}
                    Ok(())
                },
                async { Ok(()) },
                Duration::from_millis(20),
            );
            timeout(Duration::from_secs(1), async {
                let (result, ()) = tokio::join!(export, async {
                    ready_rx.await.unwrap();
                    manager.request_cancel(handle.id).await.unwrap();
                });
                assert!(matches!(result, Err(ExportTaskError::Cancelled)));
                dropped_rx
                    .await
                    .expect("query must be dropped before returning");
            })
            .await
            .expect("cancellation cannot wait for a chunk or summary");
        }
    }

    #[tokio::test]
    async fn writer_failure_closes_receiver_before_bounded_driver_cancellation() {
        let (_, handle) = task().await;
        let (ready_tx, ready_rx) = oneshot::channel();
        let (dropped_tx, dropped_rx) = oneshot::channel();
        let (tx, rx) = mpsc::channel::<()>(1);
        let observer = tx.clone();
        let result = timeout(
            Duration::from_secs(1),
            run_export_stream::<()>(
                &handle,
                async move {
                    let _guard = DropSignal(Some(dropped_tx));
                    let _sender = tx;
                    ready_tx.send(()).unwrap();
                    std::future::pending::<Result<QueryStreamSummary, AppError>>().await
                },
                async move {
                    let _receiver = rx;
                    ready_rx.await.unwrap();
                    Err(AppError::ConfigError("simulated disk error".into()).into())
                },
                async move {
                    assert!(
                        observer.is_closed(),
                        "drop receiver before cancelling producer"
                    );
                    // A stuck cancellation RPC must not hang the export indefinitely.
                    std::future::pending::<Result<(), AppError>>().await
                },
                Duration::from_millis(20),
            ),
        )
        .await
        .unwrap();
        assert!(
            matches!(result, Err(ExportTaskError::Failed(AppError::ConfigError(message))) if message == "simulated disk error")
        );
        dropped_rx.await.unwrap();
    }

    #[tokio::test]
    async fn dropping_export_aborts_its_owned_query_worker() {
        let (_, handle) = task().await;
        let (ready_tx, ready_rx) = oneshot::channel();
        let (dropped_tx, dropped_rx) = oneshot::channel();
        let export = tokio::spawn(async move {
            run_export_stream::<()>(
                &handle,
                async move {
                    let _guard = DropSignal(Some(dropped_tx));
                    ready_tx.send(()).unwrap();
                    std::future::pending::<Result<QueryStreamSummary, AppError>>().await
                },
                std::future::pending(),
                async { Ok(()) },
                Duration::from_millis(20),
            )
            .await
        });
        ready_rx.await.unwrap();
        export.abort();
        assert!(matches!(export.await, Err(error) if error.is_cancelled()));
        timeout(Duration::from_secs(1), dropped_rx)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn driver_failure_is_not_reported_as_success_after_channel_closes() {
        let (_, handle) = task().await;
        let (tx, mut rx) = mpsc::channel::<()>(1);
        let result = run_export_stream(
            &handle,
            async move {
                drop(tx);
                Err(AppError::ConfigError("simulated driver error".into()))
            },
            async move {
                assert!(rx.recv().await.is_none());
                Ok(())
            },
            async { Ok(()) },
            Duration::from_millis(20),
        )
        .await;
        assert!(
            matches!(result, Err(ExportTaskError::DatabaseFailed(AppError::ConfigError(message))) if message == "simulated driver error")
        );
    }
}

#[cfg(test)]
mod csv_workflow_tests {
    use super::*;

    #[tokio::test]
    async fn strict_csv_options_fail_in_preview_before_import() {
        let mut input: PreviewTableCsvImportInput = serde_json::from_value(serde_json::json!({
            "connectionId": Uuid::nil(), "schema": "main", "table": "items", "path": "fixture.csv", "mapping": []
        })).unwrap();
        for bytes in [
            &b"a\n\xff"[..],
            &b"a\nx\"y"[..],
            &b"a\n\"x\"tail"[..],
            &b"a\n\"x"[..],
        ] {
            assert!(preview_csv_reader(&input, bytes, vec!["a".into()])
                .await
                .is_err());
        }
        let preview = preview_csv_reader(&input, &b"a,b\n1\n"[..], vec!["a".into()])
            .await
            .unwrap();
        assert_eq!(preview.invalid_rows[0].row_number, 2);
        input.delimiter = Some("||".into());
        assert!(preview_csv_reader(&input, &b"a\n1"[..], vec!["a".into()])
            .await
            .is_err());
        input.path = std::env::temp_dir()
            .join(format!("missing-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into();
        assert!(preview_csv_import(&input, &[]).await.is_err());
    }

    #[tokio::test]
    async fn ui_preview_returns_a_bounded_prefix_without_requiring_full_scan() {
        let input: PreviewTableCsvImportInput = serde_json::from_value(serde_json::json!({
            "connectionId": Uuid::nil(), "schema": "main", "table": "items", "path": "fixture.csv",
            "mapping": [], "sampleOnly": true, "previewRows": 2
        }))
        .unwrap();
        let preview = preview_csv_reader(&input, &b"id\n1\n2\n3\n\xff"[..], vec!["id".into()])
            .await
            .unwrap();
        assert_eq!(preview.rows, vec![vec!["1"], vec!["2"]]);
        assert_eq!(preview.total_rows, 2); // Scanned count, not a claim about the full file.
        assert!(preview.has_more);
        assert!(preview.can_import);
    }

    #[test]
    fn explicit_mapping_is_exact_unique_and_can_ignore_sources() {
        let headers = vec!["renamed".into(), "extra".into()];
        let targets = vec!["name".into(), "optional".into()];
        assert_eq!(
            resolve_csv_mapping(&headers, &targets, Some(&[Some("name".into()), None])).unwrap(),
            vec![(0, "name".into())]
        );
        for mapping in [
            vec![Some("name".into()), Some("name".into())],
            vec![Some("NAME".into()), None],
            vec![None, None],
            vec![Some("name".into())],
        ] {
            assert!(resolve_csv_mapping(&headers, &targets, Some(&mapping)).is_err());
        }
    }

    #[test]
    fn ui_report_is_bounded_and_does_not_include_business_values_or_path() {
        let error = AppError::ConfigError(
            "duplicate private-business-value; password=fixture-secret".into(),
        );
        let message = csv_row_error(&error, &["private-business-value".into()]);
        assert!(!message.contains("private-business-value"));
        assert!(!message.contains("fixture-secret"));
        let report = ImportReport {
            path: "/private/input.csv".into(),
            table: "items".into(),
            total_rows: 150,
            inserted_rows: 0,
            invalid_row_count: 0,
            invalid_rows_omitted: 0,
            invalid_rows: vec![],
            failed_write_count: 150,
            failed_writes_omitted: 0,
            failed_writes: (1..=150)
                .map(|i| RowReport {
                    row_number: i,
                    message: message.clone(),
                    values: vec!["private-business-value".into()],
                })
                .collect(),
        };
        let ui = csv_ui_report(&report);
        assert_eq!(ui.failures.len(), 100);
        assert_eq!(ui.failed_rows, 150);
        let serialized = serde_json::to_string(&ui).unwrap();
        assert!(!serialized.contains("private-business-value"));
        assert!(!serialized.contains("/private/input.csv"));
    }
}
