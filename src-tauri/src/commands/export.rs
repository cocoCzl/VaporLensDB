use std::{collections::HashSet, path::PathBuf, sync::Arc};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::{
    fs::File,
    io::{AsyncWriteExt, BufWriter},
    sync::mpsc,
    task::yield_now,
};
use uuid::Uuid;

use crate::{
    commands::task::emit_task_update,
    drivers::trait_def::DatabaseDriver,
    models::{
        connection::DriverType,
        error::AppError,
        metadata::ColumnInfo,
        query_result::{QueryResult, QueryResultChunk},
    },
    services::task_manager::{TaskHandle, TaskInfo},
    AppState,
};

const TABLE_EXPORT_CHUNK_SIZE: usize = 1_000;
const IMPORT_PREVIEW_ROWS: usize = 20;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQueryResultCsvInput {
    pub result: QueryResult,
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
    pub preview_rows: Option<usize>,
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
    pub invalid_rows: Vec<RowReport>,
    pub failed_writes: Vec<RowReport>,
}

#[tauri::command]
pub async fn export_query_result_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExportQueryResultCsvInput,
) -> Result<TaskInfo, AppError> {
    let path = PathBuf::from(&input.path);
    let row_count = input.result.rows.len() as u64;
    let manager = state.task_manager.clone();
    let task = manager
        .create_task(
            "export.csv.result",
            &format!("Export CSV: {}", display_file_name(&path)),
            Some(row_count),
        )
        .await;
    let handle = manager.handle(task.id).await?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Ok(task) = manager.start_task(handle.id, "Preparing CSV export").await {
            emit_task_update(&app_for_task, &task);
        }

        match write_query_result_csv(&input.result, &path, input.include_header, &manager, &handle)
            .await
        {
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
    input: ExportTableCsvInput,
) -> Result<TaskInfo, AppError> {
    let driver = active_driver(&state, input.connection_id).await?;
    let columns = driver.get_columns(&input.schema, &input.table).await?;
    let path = PathBuf::from(&input.path);
    let manager = state.task_manager.clone();
    let task = manager
        .create_task(
            "export.csv.table",
            &format!("Export table CSV: {}", display_file_name(&path)),
            input.max_rows,
        )
        .await;
    let handle = manager.handle(task.id).await?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Ok(task) = manager.start_task(handle.id, "Starting table CSV export").await {
            emit_task_update(&app_for_task, &task);
        }

        match write_table_csv(&input, driver, columns, &path, &manager, &handle).await {
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
            Err(ExportTaskError::Failed(error)) => {
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
    let driver = active_driver(&state, input.connection_id).await?;
    let columns = driver.get_columns(&input.schema, &input.table).await?;
    preview_csv_import(&input, &columns).await
}

#[tauri::command]
pub async fn import_table_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ImportTableCsvInput,
) -> Result<TaskInfo, AppError> {
    let driver = active_driver(&state, input.connection_id).await?;
    let columns = driver.get_columns(&input.schema, &input.table).await?;
    let path = PathBuf::from(&input.path);
    let manager = state.task_manager.clone();
    let preview = preview_csv_import(
        &PreviewTableCsvImportInput {
            connection_id: input.connection_id,
            schema: input.schema.clone(),
            table: input.table.clone(),
            path: input.path.clone(),
            has_header: input.has_header,
            preview_rows: Some(IMPORT_PREVIEW_ROWS),
        },
        &columns,
    )
    .await?;
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
        if let Ok(task) = manager.start_task(handle.id, "Starting table CSV import").await {
            emit_task_update(&app_for_task, &task);
        }

        match import_csv_rows(&input, driver, columns, preview, &manager, &handle).await {
            Ok(report) => {
                let failed = report.invalid_rows.len() + report.failed_writes.len();
                let message = if failed == 0 {
                    format!("Imported {} rows into {}", report.inserted_rows, report.table)
                } else {
                    format!(
                        "Imported {} rows into {}; {} rows reported in {}",
                        report.inserted_rows, report.table, failed, report.path
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
            Err(ExportTaskError::Failed(error)) => {
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

enum ExportTaskError {
    Cancelled,
    Failed(AppError),
}

impl From<AppError> for ExportTaskError {
    fn from(value: AppError) -> Self {
        Self::Failed(value)
    }
}

async fn active_driver(
    state: &State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Arc<dyn DatabaseDriver>, AppError> {
    let manager = state.connection_manager.lock().await;
    manager.driver(connection_id)
}

async fn write_table_csv(
    input: &ExportTableCsvInput,
    driver: Arc<dyn DatabaseDriver>,
    columns: Vec<ColumnInfo>,
    path: &PathBuf,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ExportReport, ExportTaskError> {
    let file = File::create(path).await.map_err(AppError::from)?;
    let mut writer = BufWriter::new(file);
    let mut bytes_written = 0_u64;
    let mut wrote_any = false;
    let selected_columns = columns
        .iter()
        .filter(|column| !generated_column_default(&column.default_value))
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

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
    let query_task = tokio::spawn(async move {
        driver_for_query
            .execute_query_stream(
                &sql_for_query,
                &query_id_for_query,
                TABLE_EXPORT_CHUNK_SIZE,
                max_rows,
                tx,
            )
            .await
    });

    let mut row_count = 0_u64;
    while let Some(chunk) = rx.recv().await {
        if handle.is_cancel_requested() {
            let _ = driver.cancel_query(&query_id).await;
            return Err(ExportTaskError::Cancelled);
        }

        let chunk = chunk?;
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

    let summary = query_task
        .await
        .map_err(|error| AppError::ConfigError(error.to_string()))??;
    row_count = summary.row_count;
    writer.flush().await.map_err(AppError::from)?;

    Ok(ExportReport {
        path: path.to_string_lossy().to_string(),
        row_count,
        bytes_written,
    })
}

async fn preview_csv_import(
    input: &PreviewTableCsvImportInput,
    columns: &[ColumnInfo],
) -> Result<ImportPreview, AppError> {
    let content = tokio::fs::read_to_string(&input.path).await?;
    let parsed = parse_csv(&content)?;
    let target_columns = importable_column_names(columns);
    let (headers, rows, first_data_row) = csv_headers_and_rows(parsed, input.has_header);
    let mut invalid_rows = validate_import_rows(&headers, &rows, first_data_row, &target_columns);
    invalid_rows.truncate(100);
    let valid_rows = rows.len().saturating_sub(invalid_rows.len()) as u64;

    Ok(ImportPreview {
        path: input.path.clone(),
        headers,
        target_columns,
        rows: rows
            .into_iter()
            .take(input.preview_rows.unwrap_or(IMPORT_PREVIEW_ROWS))
            .collect(),
        total_rows: valid_rows + invalid_rows.len() as u64,
        valid_rows,
        invalid_rows: invalid_rows
            .into_iter()
            .take(input.preview_rows.unwrap_or(IMPORT_PREVIEW_ROWS))
            .collect(),
        can_import: valid_rows > 0,
    })
}

async fn import_csv_rows(
    input: &ImportTableCsvInput,
    driver: Arc<dyn DatabaseDriver>,
    columns: Vec<ColumnInfo>,
    preview: ImportPreview,
    manager: &crate::services::task_manager::TaskManager,
    handle: &TaskHandle,
) -> Result<ImportReport, ExportTaskError> {
    let content = tokio::fs::read_to_string(&input.path)
        .await
        .map_err(AppError::from)?;
    let parsed = parse_csv(&content)?;
    let target_columns = importable_column_names(&columns);
    let (headers, rows, first_data_row) = csv_headers_and_rows(parsed, input.has_header);
    let mut invalid_rows = validate_import_rows(&headers, &rows, first_data_row, &target_columns);
    let invalid_numbers = invalid_rows
        .iter()
        .map(|row| row.row_number)
        .collect::<HashSet<_>>();
    let import_columns = headers;
    let table = qualified_table(input.driver_type, &input.schema, &input.table);
    let mut inserted_rows = 0_u64;
    let mut failed_writes = Vec::new();

    for (index, row) in rows.into_iter().enumerate() {
        let row_number = first_data_row + index as u64;
        if handle.is_cancel_requested() {
            return Err(ExportTaskError::Cancelled);
        }
        if invalid_numbers.contains(&row_number) {
            continue;
        }

        let sql = build_insert_sql(input.driver_type, &table, &import_columns, &row, input.empty_as_null);
        match driver.execute_query(&sql, Some(&format!("table-import-{}", handle.id))).await {
            Ok(_) => inserted_rows += 1,
            Err(error) => failed_writes.push(RowReport {
                row_number,
                message: error.to_string(),
                values: row,
            }),
        }

        let current = index as u64 + 1;
        if current == preview.total_rows || current % 100 == 0 {
            manager
                .update_progress(
                    handle.id,
                    current,
                    format!("Imported {inserted_rows} of {} rows", preview.total_rows),
                )
                .await?;
        }
        if current % 100 == 0 {
            yield_now().await;
        }
    }

    let report_path = format!("{}.import-report.json", input.path);
    let report = ImportReport {
        path: report_path.clone(),
        table,
        total_rows: preview.total_rows,
        inserted_rows,
        invalid_rows: std::mem::take(&mut invalid_rows),
        failed_writes,
    };
    if !report.invalid_rows.is_empty() || !report.failed_writes.is_empty() {
        let content = serde_json::to_string_pretty(&report).map_err(AppError::from)?;
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
        if current == result.rows.len() as u64 || current % 500 == 0 {
            manager
                .update_progress(
                    handle.id,
                    current,
                    format!("Exported {current} of {} rows", result.rows.len()),
                )
                .await
                .map_err(ExportTaskError::from)?;
        }

        if current % 500 == 0 {
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

fn parse_csv(content: &str) -> Result<Vec<Vec<String>>, AppError> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut chars = content.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                row.push(std::mem::take(&mut cell));
            }
            '\n' if !in_quotes => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            '\r' if !in_quotes => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            _ => cell.push(ch),
        }
    }

    if in_quotes {
        return Err(AppError::SerializationError(
            "CSV has an unterminated quoted field".to_string(),
        ));
    }

    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }

    Ok(rows)
}

fn csv_headers_and_rows(
    parsed: Vec<Vec<String>>,
    has_header: bool,
) -> (Vec<String>, Vec<Vec<String>>, u64) {
    if parsed.is_empty() {
        return (Vec::new(), Vec::new(), 1);
    }
    if has_header {
        let mut iter = parsed.into_iter();
        let headers = iter.next().unwrap_or_default();
        (headers, iter.collect(), 2)
    } else {
        let width = parsed.first().map_or(0, Vec::len);
        let headers = (1..=width).map(|index| format!("column_{index}")).collect();
        (headers, parsed, 1)
    }
}

fn validate_import_rows(
    headers: &[String],
    rows: &[Vec<String>],
    first_data_row: u64,
    target_columns: &[String],
) -> Vec<RowReport> {
    let mut reports = Vec::new();
    let target_set = target_columns
        .iter()
        .map(|column| column.to_lowercase())
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();

    for header in headers {
        let normalized = header.to_lowercase();
        if header.trim().is_empty() {
            reports.push(RowReport {
                row_number: 1,
                message: "Header contains an empty column name".to_string(),
                values: headers.to_vec(),
            });
        } else if !seen.insert(normalized.clone()) {
            reports.push(RowReport {
                row_number: 1,
                message: format!("Duplicate CSV column: {header}"),
                values: headers.to_vec(),
            });
        } else if !target_set.contains(&normalized) {
            reports.push(RowReport {
                row_number: 1,
                message: format!("CSV column is not importable for target table: {header}"),
                values: headers.to_vec(),
            });
        }
    }

    for (index, row) in rows.iter().enumerate() {
        if row.len() != headers.len() {
            reports.push(RowReport {
                row_number: first_data_row + index as u64,
                message: format!("Expected {} fields, found {}", headers.len(), row.len()),
                values: row.clone(),
            });
        }
    }

    reports
}

fn importable_column_names(columns: &[ColumnInfo]) -> Vec<String> {
    columns
        .iter()
        .filter(|column| !generated_column_default(&column.default_value))
        .map(|column| column.name.clone())
        .collect()
}

fn generated_column_default(default_value: &Option<String>) -> bool {
    default_value
        .as_deref()
        .is_some_and(|value| value.to_lowercase().contains("generated"))
}

fn build_insert_sql(
    driver_type: DriverType,
    table: &str,
    columns: &[String],
    row: &[String],
    empty_as_null: bool,
) -> String {
    format!(
        "INSERT INTO {table} ({}) VALUES ({});",
        columns
            .iter()
            .map(|column| quote_identifier(driver_type, column))
            .collect::<Vec<_>>()
            .join(", "),
        row.iter()
            .map(|value| sql_literal(value, empty_as_null))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn sql_literal(value: &str, empty_as_null: bool) -> String {
    if empty_as_null && value.is_empty() {
        "NULL".to_string()
    } else {
        format!("'{}'", value.replace('\'', "''"))
    }
}

fn qualified_table(driver_type: DriverType, schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_identifier(driver_type, schema),
        quote_identifier(driver_type, table)
    )
}

fn quote_identifier(driver_type: DriverType, value: &str) -> String {
    let quote = if matches!(driver_type, DriverType::Mysql) {
        '`'
    } else {
        '"'
    };
    format!("{quote}{}{quote}", value.replace(quote, &format!("{quote}{quote}")))
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

fn display_file_name(path: &PathBuf) -> String {
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
    use serde_json::json;

    use super::{
        build_insert_sql, parse_csv, qualified_table, query_result_to_csv, validate_import_rows,
    };
    use crate::models::connection::DriverType;
    use crate::models::query_result::{ColumnMeta, QueryResult};

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
    fn insert_sql_quotes_identifiers_and_string_values() {
        let table = qualified_table(DriverType::Postgres, "public", "people");
        assert_eq!(
            build_insert_sql(
                DriverType::Postgres,
                &table,
                &["name".to_string(), "note".to_string()],
                &["Ada".to_string(), "it's ok".to_string()],
                true,
            ),
            "INSERT INTO \"public\".\"people\" (\"name\", \"note\") VALUES ('Ada', 'it''s ok');"
        );
    }
}
