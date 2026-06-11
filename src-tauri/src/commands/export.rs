use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::{
    fs::File,
    io::{AsyncWriteExt, BufWriter},
    task::yield_now,
};

use crate::{
    commands::task::emit_task_update,
    models::{error::AppError, query_result::QueryResult},
    services::task_manager::{TaskHandle, TaskInfo},
    AppState,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQueryResultCsvInput {
    pub result: QueryResult,
    pub path: String,
    #[serde(default = "default_include_header")]
    pub include_header: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    pub row_count: u64,
    pub bytes_written: u64,
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

enum ExportTaskError {
    Cancelled,
    Failed(AppError),
}

impl From<AppError> for ExportTaskError {
    fn from(value: AppError) -> Self {
        Self::Failed(value)
    }
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::query_result_to_csv;
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
}
