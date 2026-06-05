use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{models::error::AppError, models::query_result::QueryResult};

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
    input: ExportQueryResultCsvInput,
) -> Result<ExportReport, AppError> {
    let csv = query_result_to_csv(&input.result, input.include_header);
    let path = PathBuf::from(&input.path);
    tokio::fs::write(&path, csv.as_bytes()).await?;

    Ok(ExportReport {
        path: path.to_string_lossy().to_string(),
        row_count: input.result.rows.len() as u64,
        bytes_written: csv.len() as u64,
    })
}

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
}
