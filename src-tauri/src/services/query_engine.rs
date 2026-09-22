use std::{sync::Arc, time::Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        error::AppError,
        query_result::{
            ExplainResult, QueryResult, QueryResultChunk, QueryStreamDone, QueryStreamError,
        },
    },
    utils::sql_parser::split_sql_statements,
};

const QUERY_RESULT_CHUNK_EVENT: &str = "query_result_chunk";
const QUERY_RESULT_DONE_EVENT: &str = "query_result_done";
const QUERY_RESULT_ERROR_EVENT: &str = "query_result_error";
const DEFAULT_STREAM_CHUNK_SIZE: usize = 1_000;
const DEFAULT_INTERACTIVE_MAX_ROWS: u64 = 50_000;
/// The UI may expose a smaller preference, but no interactive result is allowed
/// to bypass this process-wide budget. Full exports use a separate streaming
/// path and are not constrained by this value.
pub const MAX_INTERACTIVE_RESULT_ROWS: u64 = 50_000;
const MAX_STREAM_CHUNK_SIZE: usize = 2_000;
const MAX_INTERACTIVE_STATEMENTS: usize = 32;

#[derive(Default)]
pub struct QueryEngine;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResponse {
    pub query_id: Option<String>,
    pub results: Vec<QueryResult>,
}

pub struct StreamQueryRequest {
    pub sql: String,
    pub query_id: String,
    pub chunk_size: Option<usize>,
    pub max_rows: Option<u64>,
}

#[derive(Default)]
struct StreamMetrics {
    first_row_ms: Option<u64>,
    received_bytes: u64,
}

impl QueryEngine {
    pub fn new() -> Self {
        Self
    }

    pub async fn execute_query(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        sql: &str,
        query_id: Option<String>,
    ) -> Result<ExecuteQueryResponse, AppError> {
        let statements = split_sql_statements(sql);
        // Reject the entire batch before executing any statement, including DML.
        if statements.len() > MAX_INTERACTIVE_STATEMENTS {
            return Err(AppError::ConfigError(format!(
                "interactive batches support at most {MAX_INTERACTIVE_STATEMENTS} statements"
            )));
        }
        if statements.is_empty() {
            return Ok(ExecuteQueryResponse {
                query_id,
                results: Vec::new(),
            });
        }

        let mut results = Vec::with_capacity(statements.len());
        let mut remaining_rows = MAX_INTERACTIVE_RESULT_ROWS;
        let execution_id = query_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        for statement in statements {
            let mut result = collect_interactive_result(
                driver.as_ref(),
                &statement,
                &execution_id,
                remaining_rows,
            )
            .await?;
            remaining_rows = remaining_rows.saturating_sub(result.row_count);
            result.query_id = query_id.clone();
            results.push(result);
        }

        Ok(ExecuteQueryResponse { query_id, results })
    }

    pub async fn execute_query_stream(
        &self,
        app: AppHandle,
        driver: Arc<dyn DatabaseDriver>,
        request: StreamQueryRequest,
    ) -> Result<(), String> {
        let (chunk_tx, mut chunk_rx) = mpsc::channel::<Result<QueryResultChunk, AppError>>(8);
        let query_id = request.query_id.clone();
        let emit_app = app.clone();
        let emit_query_id = query_id.clone();
        let stream_started = Instant::now();

        let emit_task = tokio::spawn(async move {
            let mut metrics = StreamMetrics::default();
            while let Some(chunk) = chunk_rx.recv().await {
                match chunk {
                    Ok(chunk) => {
                        if metrics.first_row_ms.is_none() && !chunk.rows.is_empty() {
                            metrics.first_row_ms =
                                Some(stream_started.elapsed().as_millis() as u64);
                        }
                        metrics.received_bytes += serde_json::to_vec(&chunk)
                            .map(|payload| payload.len() as u64)
                            .unwrap_or(0);
                        if emit_app.emit(QUERY_RESULT_CHUNK_EVENT, chunk).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = emit_app.emit(
                            QUERY_RESULT_ERROR_EVENT,
                            stream_error_payload(&emit_query_id, &error),
                        );
                        break;
                    }
                }
            }
            metrics
        });

        match driver
            .execute_query_stream(
                &request.sql,
                &query_id,
                request
                    .chunk_size
                    .unwrap_or(DEFAULT_STREAM_CHUNK_SIZE)
                    .clamp(1, MAX_STREAM_CHUNK_SIZE),
                Some(
                    request
                        .max_rows
                        .unwrap_or(DEFAULT_INTERACTIVE_MAX_ROWS)
                        .clamp(1, MAX_INTERACTIVE_RESULT_ROWS),
                ),
                chunk_tx,
            )
            .await
        {
            Ok(summary) => {
                let metrics = emit_task.await.unwrap_or_default();
                app.emit(
                    QUERY_RESULT_DONE_EVENT,
                    QueryStreamDone {
                        query_id: summary.query_id,
                        row_count: summary.row_count,
                        affected_rows: summary.affected_rows,
                        elapsed_ms: summary.elapsed_ms,
                        truncated: summary.truncated,
                        max_rows: summary.max_rows,
                        first_row_ms: metrics.first_row_ms,
                        received_bytes: metrics.received_bytes,
                    },
                )
                .map_err(|error| error.to_string())
            }
            Err(error) => {
                let _ = emit_task.await;
                let _ = app.emit(
                    QUERY_RESULT_ERROR_EVENT,
                    stream_error_payload(&query_id, &error),
                );
                Err(error.into())
            }
        }
    }

    pub async fn explain_query(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        sql: &str,
    ) -> Result<ExplainResult, AppError> {
        driver.explain_query(sql).await
    }

    pub async fn cancel_query(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        query_id: &str,
    ) -> Result<(), AppError> {
        driver.cancel_query(query_id).await
    }
}

/// Consume a bounded channel concurrently with the driver. No detached task can
/// outlive the query operation lease. Even when the batch row budget is spent,
/// execute remaining statements (including DML) and retain their metadata/status.
async fn collect_interactive_result(
    driver: &dyn DatabaseDriver,
    sql: &str,
    query_id: &str,
    max_rows: u64,
) -> Result<QueryResult, AppError> {
    let (tx, mut rx) = mpsc::channel::<Result<QueryResultChunk, AppError>>(2);
    let producer = driver.execute_query_stream(
        sql,
        query_id,
        DEFAULT_STREAM_CHUNK_SIZE,
        // JDBC requires a positive limit. Once exhausted, observe at most one
        // row to distinguish a truncated result from an empty result/DDL.
        Some(max_rows.max(1)),
        tx,
    );
    let consumer = async move {
        let mut result = QueryResult::empty(0, 0);
        while let Some(chunk) = rx.recv().await {
            let chunk = chunk?;
            if result.columns.is_empty() {
                result.columns = chunk.columns;
            }
            let available = max_rows.saturating_sub(result.rows.len() as u64) as usize;
            result.truncated |= chunk.rows.len() > available;
            result.rows.extend(chunk.rows.into_iter().take(available));
        }
        Ok::<_, AppError>(result)
    };
    let (summary, result) = tokio::join!(producer, consumer);
    let mut result = result?;
    let summary = summary?;
    result.row_count = result.rows.len() as u64;
    result.affected_rows = summary.affected_rows;
    result.elapsed_ms = summary.elapsed_ms;
    result.truncated |= summary.truncated;
    result.max_rows = Some(max_rows);
    Ok(result)
}

fn stream_error_payload(query_id: &str, error: &AppError) -> QueryStreamError {
    QueryStreamError {
        query_id: query_id.to_string(),
        code: error.code().to_string(),
        message: error.to_string(),
        detail: error.detail(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::sqlite::SqliteDriver;

    #[tokio::test]
    async fn batch_shares_row_budget_and_still_executes_later_statements() {
        let driver = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        let engine = QueryEngine::new();
        let many_rows = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<60000) SELECT x FROM n";
        let sql = format!(
            "{many_rows}; {many_rows}; CREATE TABLE kept(x INTEGER); INSERT INTO kept VALUES(7)"
        );
        let response = engine
            .execute_query(driver.clone(), &sql, Some("batch".into()))
            .await
            .unwrap();
        assert_eq!(response.results.len(), 4);
        assert_eq!(response.results[0].row_count, MAX_INTERACTIVE_RESULT_ROWS);
        assert!(response.results[0].truncated);
        assert_eq!(response.results[1].row_count, 0);
        assert!(response.results[1].truncated);
        assert_eq!(response.results[1].columns.len(), 1);
        assert_eq!(response.results[3].affected_rows, 1);
        assert!(response
            .results
            .iter()
            .all(|result| result.query_id.as_deref() == Some("batch")));
        let next = engine
            .execute_query(driver, "SELECT x FROM kept", None)
            .await
            .unwrap();
        assert_eq!(next.results[0].rows, vec![vec![serde_json::json!(7)]]);
    }

    #[tokio::test]
    async fn oversized_batch_is_rejected_before_side_effects() {
        let driver = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        driver
            .execute_query("CREATE TABLE kept(x INTEGER)", None)
            .await
            .unwrap();
        let sql = "INSERT INTO kept VALUES(1);".repeat(MAX_INTERACTIVE_STATEMENTS + 1);
        assert!(QueryEngine::new()
            .execute_query(driver.clone(), &sql, None)
            .await
            .is_err());
        let result = driver
            .execute_query("SELECT COUNT(*) FROM kept", None)
            .await
            .unwrap();
        assert_eq!(result.rows[0][0], serde_json::json!(0));
    }

    #[tokio::test]
    async fn exact_limit_and_empty_results_are_not_truncated() {
        let driver = SqliteDriver::connect(":memory:").await.unwrap();
        let result = collect_interactive_result(&driver, "SELECT 1 UNION ALL SELECT 2", "exact", 2)
            .await
            .unwrap();
        assert_eq!(result.row_count, 2);
        assert!(!result.truncated);
        let empty = collect_interactive_result(&driver, "SELECT 1 AS x WHERE 0", "empty", 0)
            .await
            .unwrap();
        assert_eq!(empty.columns.len(), 1);
        assert!(!empty.truncated);
        assert!(
            collect_interactive_result(&driver, "SELECT * FROM missing", "error", 2)
                .await
                .is_err()
        );
    }
}
