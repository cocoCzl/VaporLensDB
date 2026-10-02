use std::{sync::Arc, time::Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::{
    drivers::trait_def::{
        DatabaseDriver, DriverStreamRequest, StreamControl, StreamStopReason, StreamTransactionMode,
    },
    models::{
        error::AppError,
        query_result::{
            ExplainResult, QueryResult, QueryResultChunk, QueryStreamDone, QueryStreamError,
        },
    },
    utils::{
        query_budget::row_json_bytes,
        sql_parser::{split_sql_statements, unsupported_client_directive},
    },
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
pub const MAX_INTERACTIVE_CELL_BYTES: usize = 1024 * 1024;
pub const MAX_INTERACTIVE_RESULT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_INTERACTIVE_STREAM_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const MAX_STREAM_CHUNK_SIZE: usize = 2_000;
const MAX_INTERACTIVE_STATEMENTS: usize = 32;

#[derive(Default)]
pub struct QueryEngine;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryResponse {
    pub query_id: Option<String>,
    pub results: Vec<QueryResult>,
    pub connection_generation: Option<u64>,
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
    emitted_rows: u64,
    truncated: bool,
    error: Option<AppError>,
    emitted_columns: bool,
}

pub(crate) enum QueryStreamEvent {
    Chunk(QueryResultChunk),
    Done(QueryStreamDone),
    Error(QueryStreamError),
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
        max_rows: Option<u64>,
    ) -> Result<ExecuteQueryResponse, AppError> {
        self.execute_query_in_mode(driver, sql, query_id, max_rows, StreamTransactionMode::Auto)
            .await
    }

    pub async fn execute_query_in_mode(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        sql: &str,
        query_id: Option<String>,
        max_rows: Option<u64>,
        mode: StreamTransactionMode,
    ) -> Result<ExecuteQueryResponse, AppError> {
        if let Some(directive) = unsupported_client_directive(sql) {
            return Err(AppError::ResultProcessingError(format!(
                "client directive {directive} is not supported; remove it before execution"
            )));
        }
        let statements = split_sql_statements(sql);
        // Reject the entire batch before executing any statement, including DML.
        if statements.len() > MAX_INTERACTIVE_STATEMENTS {
            return Err(AppError::ResultLimitExceeded(format!(
                "interactive batches support at most {MAX_INTERACTIVE_STATEMENTS} statements"
            )));
        }
        if statements.is_empty() {
            return Ok(ExecuteQueryResponse {
                query_id,
                results: Vec::new(),
                connection_generation: None,
            });
        }

        let mut results = Vec::with_capacity(statements.len());
        let per_result_max_rows = max_rows
            .unwrap_or(DEFAULT_INTERACTIVE_MAX_ROWS)
            .clamp(1, MAX_INTERACTIVE_RESULT_ROWS);
        let mut remaining_rows = MAX_INTERACTIVE_RESULT_ROWS;
        let mut remaining_bytes = MAX_INTERACTIVE_RESULT_BYTES;
        let execution_id = query_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        for statement in statements {
            let effective_max_rows = per_result_max_rows.min(remaining_rows);
            let (mut result, retained_bytes) = collect_interactive_result(
                driver.as_ref(),
                &statement,
                &execution_id,
                effective_max_rows,
                remaining_bytes,
                mode,
            )
            .await?;
            remaining_rows = remaining_rows.saturating_sub(result.row_count);
            remaining_bytes = remaining_bytes.saturating_sub(retained_bytes);
            result.max_rows = Some(per_result_max_rows);
            result.query_id = query_id.clone();
            results.push(result);
        }

        Ok(ExecuteQueryResponse {
            query_id,
            results,
            connection_generation: None,
        })
    }

    pub async fn execute_query_stream(
        &self,
        app: AppHandle,
        driver: Arc<dyn DatabaseDriver>,
        request: StreamQueryRequest,
    ) -> Result<(), AppError> {
        self.execute_query_stream_in_mode(app, driver, request, StreamTransactionMode::Auto)
            .await
    }

    pub async fn execute_query_stream_in_mode(
        &self,
        app: AppHandle,
        driver: Arc<dyn DatabaseDriver>,
        request: StreamQueryRequest,
        mode: StreamTransactionMode,
    ) -> Result<(), AppError> {
        self.execute_query_stream_with_sink_in_mode(driver, request, mode, move |event| {
            let result = match event {
                QueryStreamEvent::Chunk(chunk) => app.emit(QUERY_RESULT_CHUNK_EVENT, chunk),
                QueryStreamEvent::Done(done) => app.emit(QUERY_RESULT_DONE_EVENT, done),
                QueryStreamEvent::Error(error) => app.emit(QUERY_RESULT_ERROR_EVENT, error),
            };
            result.map_err(|_| {
                AppError::ResultProcessingError("query result event delivery failed".into())
            })
        })
        .await
    }

    #[cfg(test)]
    pub(crate) async fn execute_query_stream_with_sink(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        request: StreamQueryRequest,
        emit: impl Fn(QueryStreamEvent) -> Result<(), AppError> + Send + Sync,
    ) -> Result<(), AppError> {
        self.execute_query_stream_with_sink_in_mode(
            driver,
            request,
            StreamTransactionMode::Auto,
            emit,
        )
        .await
    }

    pub(crate) async fn execute_query_stream_with_sink_in_mode(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        request: StreamQueryRequest,
        mode: StreamTransactionMode,
        emit: impl Fn(QueryStreamEvent) -> Result<(), AppError> + Send + Sync,
    ) -> Result<(), AppError> {
        if let Some(directive) = unsupported_client_directive(&request.sql) {
            return Err(AppError::ResultProcessingError(format!(
                "client directive {directive} is not supported; remove it before execution"
            )));
        }
        let (chunk_tx, mut chunk_rx) = mpsc::channel::<Result<QueryResultChunk, AppError>>(8);
        let query_id = request.query_id.clone();
        let stream_started = Instant::now();
        let control = StreamControl::new(mode);

        let consume = async {
            let mut metrics = StreamMetrics::default();
            while let Some(chunk) = chunk_rx.recv().await {
                match chunk {
                    Ok(chunk) => {
                        if metrics.error.is_some() || metrics.truncated {
                            continue;
                        }
                        match bounded_stream_chunks(
                            chunk,
                            metrics.emitted_rows,
                            MAX_INTERACTIVE_RESULT_BYTES
                                .saturating_sub(metrics.received_bytes as usize),
                            MAX_INTERACTIVE_STREAM_CHUNK_BYTES,
                            !metrics.emitted_columns,
                        ) {
                            Ok((chunks, truncated)) => {
                                metrics.truncated |= truncated;
                                if truncated {
                                    control.stop(StreamStopReason::ResultBytes);
                                }
                                for chunk in chunks {
                                    if metrics.first_row_ms.is_none() && !chunk.rows.is_empty() {
                                        metrics.first_row_ms =
                                            Some(stream_started.elapsed().as_millis() as u64);
                                    }
                                    let payload_bytes = match serde_json::to_vec(&chunk) {
                                        Ok(payload) => payload.len() as u64,
                                        Err(error) => {
                                            control.stop(StreamStopReason::ReceiverUnavailable);
                                            metrics.error = Some(AppError::from(error));
                                            break;
                                        }
                                    };
                                    let row_count = chunk.rows.len() as u64;
                                    let has_columns = !chunk.columns.is_empty();
                                    if let Err(error) = emit(QueryStreamEvent::Chunk(chunk)) {
                                        control.stop(StreamStopReason::ReceiverUnavailable);
                                        metrics.error = Some(error);
                                        break;
                                    }
                                    metrics.received_bytes =
                                        metrics.received_bytes.saturating_add(payload_bytes);
                                    metrics.emitted_rows =
                                        metrics.emitted_rows.saturating_add(row_count);
                                    metrics.emitted_columns |= has_columns;
                                }
                            }
                            Err(error) => {
                                control.stop(StreamStopReason::CellOrChunkLimit);
                                metrics.error = Some(error);
                            }
                        }
                    }
                    Err(error) => {
                        if !error.affects_transaction() {
                            control.stop(StreamStopReason::CellOrChunkLimit);
                        }
                        if metrics.error.is_none() || error.affects_transaction() {
                            metrics.error = Some(error);
                        }
                    }
                }
            }
            metrics
        };

        let produce = driver.execute_query_stream_controlled(
            DriverStreamRequest {
                sql: &request.sql,
                query_id: &query_id,
                chunk_size: request
                    .chunk_size
                    .unwrap_or(DEFAULT_STREAM_CHUNK_SIZE)
                    .clamp(1, MAX_STREAM_CHUNK_SIZE),
                max_rows: Some(
                    request
                        .max_rows
                        .unwrap_or(DEFAULT_INTERACTIVE_MAX_ROWS)
                        .clamp(1, MAX_INTERACTIVE_RESULT_ROWS),
                ),
            },
            chunk_tx,
            control.clone(),
        );
        let (execution, metrics) = tokio::join!(produce, consume);
        let result = match execution {
            Ok(summary) => {
                if let Some(error) = metrics.error {
                    Err(error)
                } else {
                    emit(QueryStreamEvent::Done(QueryStreamDone {
                        query_id: summary.query_id,
                        row_count: metrics.emitted_rows,
                        affected_rows: summary.affected_rows,
                        elapsed_ms: summary.elapsed_ms,
                        truncated: summary.truncated || metrics.truncated,
                        max_rows: summary.max_rows,
                        first_row_ms: metrics.first_row_ms,
                        received_bytes: metrics.received_bytes,
                    }))
                }
            }
            Err(error) => Err(error),
        };
        if let Err(error) = &result {
            let _ = emit(QueryStreamEvent::Error(stream_error_payload(
                &query_id, error,
            )));
        }
        result
    }

    pub async fn explain_query(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<ExplainResult, AppError> {
        driver.explain_query(sql, query_id).await
    }

    pub async fn cancel_query(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        query_id: &str,
    ) -> Result<(), AppError> {
        driver.cancel_query(query_id).await
    }
}

fn bounded_stream_chunks(
    chunk: QueryResultChunk,
    row_offset: u64,
    remaining_bytes: usize,
    max_chunk_bytes: usize,
    include_columns: bool,
) -> Result<(Vec<QueryResultChunk>, bool), AppError> {
    let mut output = Vec::new();
    let mut rows = Vec::new();
    let mut estimated_rows_bytes = 0_usize;
    let mut emitted_bytes = 0_usize;
    let mut next_offset = row_offset;
    let mut columns = if include_columns {
        chunk.columns
    } else {
        Vec::new()
    };
    // Reserve space for the event envelope and the first chunk's column
    // metadata. Exact serialization below remains the final authority.
    let row_budget = max_chunk_bytes.saturating_sub(1024);

    let flush = |rows: &mut Vec<Vec<serde_json::Value>>,
                 columns: &mut Vec<crate::models::query_result::ColumnMeta>,
                 output: &mut Vec<QueryResultChunk>,
                 next_offset: &mut u64,
                 emitted_bytes: &mut usize|
     -> Result<bool, AppError> {
        if rows.is_empty() && columns.is_empty() {
            return Ok(false);
        }
        let outgoing = QueryResultChunk {
            query_id: chunk.query_id.clone(),
            columns: std::mem::take(columns),
            rows: std::mem::take(rows),
            row_offset: *next_offset,
        };
        let bytes = serde_json::to_vec(&outgoing)?.len();
        if bytes > max_chunk_bytes {
            return Err(AppError::ResultLimitExceeded(format!(
                "interactive result chunk exceeds the {max_chunk_bytes} byte limit"
            )));
        }
        if bytes > remaining_bytes.saturating_sub(*emitted_bytes) {
            return Ok(true);
        }
        *emitted_bytes += bytes;
        *next_offset = next_offset.saturating_add(outgoing.rows.len() as u64);
        output.push(outgoing);
        Ok(false)
    };

    for row in chunk.rows {
        let row_bytes = interactive_row_bytes(&row)?;
        if row_bytes > max_chunk_bytes {
            return Err(AppError::ResultLimitExceeded(format!(
                "interactive result row exceeds the {max_chunk_bytes} byte limit"
            )));
        }
        if !rows.is_empty() && estimated_rows_bytes.saturating_add(row_bytes) > row_budget {
            if flush(
                &mut rows,
                &mut columns,
                &mut output,
                &mut next_offset,
                &mut emitted_bytes,
            )? {
                return Ok((output, true));
            }
            estimated_rows_bytes = 0;
        }
        estimated_rows_bytes = estimated_rows_bytes.saturating_add(row_bytes);
        rows.push(row);
    }
    let truncated = flush(
        &mut rows,
        &mut columns,
        &mut output,
        &mut next_offset,
        &mut emitted_bytes,
    )?;
    Ok((output, truncated))
}

/// Consume a bounded channel concurrently with the driver. No detached task can
/// outlive the query operation lease. Even when the batch row budget is spent,
/// execute remaining statements (including DML) and retain their metadata/status.
async fn collect_interactive_result(
    driver: &dyn DatabaseDriver,
    sql: &str,
    query_id: &str,
    max_rows: u64,
    max_bytes: usize,
    mode: StreamTransactionMode,
) -> Result<(QueryResult, usize), AppError> {
    let (tx, mut rx) = mpsc::channel::<Result<QueryResultChunk, AppError>>(2);
    let control = StreamControl::new(mode);
    let producer = driver.execute_query_stream_controlled(
        DriverStreamRequest {
            sql,
            query_id,
            chunk_size: DEFAULT_STREAM_CHUNK_SIZE,
            // JDBC requires a positive limit. Once exhausted, observe at most one
            // row to distinguish a truncated result from an empty result/DDL.
            max_rows: Some(max_rows.max(1)),
        },
        tx,
        control.clone(),
    );
    let consumer = async move {
        let mut result = QueryResult::empty(0, 0);
        let mut retained_bytes = 0_usize;
        let mut failure: Option<AppError> = None;
        while let Some(chunk) = rx.recv().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    if !error.affects_transaction() {
                        control.stop(StreamStopReason::CellOrChunkLimit);
                    }
                    if failure.is_none() || error.affects_transaction() {
                        failure = Some(error);
                    }
                    continue;
                }
            };
            if result.columns.is_empty() {
                result.columns = chunk.columns;
            }
            if failure.is_some() || result.truncated {
                continue;
            }
            for row in chunk.rows {
                let row_bytes = match interactive_row_bytes(&row) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        control.stop(StreamStopReason::CellOrChunkLimit);
                        failure = Some(error);
                        break;
                    }
                };
                let row_available = (result.rows.len() as u64) < max_rows;
                let bytes_available = row_bytes <= max_bytes.saturating_sub(retained_bytes);
                if row_available && bytes_available {
                    retained_bytes += row_bytes;
                    result.rows.push(row);
                } else {
                    result.truncated = true;
                    control.stop(if row_available {
                        StreamStopReason::ResultBytes
                    } else {
                        StreamStopReason::MaxRows
                    });
                    break;
                }
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok((result, retained_bytes)),
        }
    };
    let (summary, result) = tokio::join!(producer, consumer);
    let (mut result, retained_bytes) = result?;
    let summary = summary?;
    result.row_count = result.rows.len() as u64;
    result.affected_rows = summary.affected_rows;
    result.elapsed_ms = summary.elapsed_ms;
    result.truncated |= summary.truncated;
    result.max_rows = Some(max_rows);
    Ok((result, retained_bytes))
}

fn interactive_row_bytes(row: &[serde_json::Value]) -> Result<usize, AppError> {
    row_json_bytes(row)
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
    use crate::models::metadata::*;
    use crate::models::query_result::QueryStreamSummary;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct CountingProducer {
        produced: AtomicUsize,
        rows: usize,
        cell_bytes: usize,
        user_cancel: tokio_util::sync::CancellationToken,
        database_failure: bool,
    }

    fn counting_producer(rows: usize, cell_bytes: usize) -> Arc<CountingProducer> {
        Arc::new(CountingProducer {
            produced: AtomicUsize::new(0),
            rows,
            cell_bytes,
            user_cancel: tokio_util::sync::CancellationToken::new(),
            database_failure: false,
        })
    }

    fn counting_request(max_rows: Option<u64>) -> StreamQueryRequest {
        StreamQueryRequest {
            sql: "SELECT fixture".into(),
            query_id: "counting".into(),
            chunk_size: Some(1),
            max_rows,
        }
    }

    #[async_trait::async_trait]
    impl DatabaseDriver for CountingProducer {
        fn driver_name(&self) -> &'static str {
            "counting producer"
        }
        fn capabilities(&self) -> DriverCapabilities {
            DriverCapabilities {
                has_database: false,
                has_schema: false,
                supports_transactions: true,
                supports_explain: false,
                supports_cancel: false,
                supports_ddl: false,
                supports_streaming: true,
            }
        }
        async fn ping(&self) -> Result<(), AppError> {
            Ok(())
        }
        async fn execute_query(&self, _: &str, _: Option<&str>) -> Result<QueryResult, AppError> {
            Ok(QueryResult::empty(0, 0))
        }
        async fn execute_query_stream(
            &self,
            sql: &str,
            query_id: &str,
            chunk_size: usize,
            max_rows: Option<u64>,
            chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
        ) -> Result<QueryStreamSummary, AppError> {
            self.execute_query_stream_controlled(
                DriverStreamRequest {
                    sql,
                    query_id,
                    chunk_size,
                    max_rows,
                },
                chunks,
                StreamControl::new(StreamTransactionMode::Manual),
            )
            .await
        }
        async fn execute_query_stream_controlled(
            &self,
            request: DriverStreamRequest<'_>,
            chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
            control: StreamControl,
        ) -> Result<QueryStreamSummary, AppError> {
            let DriverStreamRequest {
                query_id, max_rows, ..
            } = request;
            let mut truncated = false;
            for offset in 0..self.rows {
                if self.user_cancel.is_cancelled() {
                    return Err(AppError::QueryFailed {
                        sql: request.sql.into(),
                        message: "statement cancelled".into(),
                    });
                }
                if control.mode == StreamTransactionMode::Auto && control.is_stopped() {
                    break;
                }
                self.produced.fetch_add(1, Ordering::Relaxed);
                if control.is_stopped() {
                    continue;
                }
                if max_rows.is_some_and(|limit| offset as u64 >= limit) {
                    truncated = true;
                    break;
                }
                chunks
                    .send(Ok(QueryResultChunk {
                        query_id: query_id.into(),
                        columns: vec![],
                        rows: vec![vec![serde_json::Value::String("x".repeat(self.cell_bytes))]],
                        row_offset: offset as u64,
                    }))
                    .await
                    .unwrap();
            }
            if self.database_failure {
                return Err(AppError::QueryFailed {
                    sql: request.sql.into(),
                    message: "database execution failed while draining".into(),
                });
            }
            Ok(QueryStreamSummary {
                query_id: query_id.into(),
                row_count: self.produced.load(Ordering::Relaxed) as u64,
                affected_rows: 0,
                elapsed_ms: 0,
                truncated,
                max_rows,
            })
        }
        async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_schemas(&self, _: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_tables(&self, _: &str) -> Result<Vec<TableInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_columns(&self, _: &str, _: &str) -> Result<Vec<ColumnInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_indexes(&self, _: &str, _: &str) -> Result<Vec<IndexInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_foreign_keys(
            &self,
            _: &str,
            _: &str,
        ) -> Result<Vec<ForeignKeyInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_views(&self, _: &str) -> Result<Vec<TableInfo>, AppError> {
            Ok(vec![])
        }
        async fn get_functions(&self, _: &str) -> Result<Vec<String>, AppError> {
            Ok(vec![])
        }
        async fn get_table_ddl(&self, _: &str, _: &str) -> Result<String, AppError> {
            Ok(String::new())
        }
        async fn explain_query(&self, _: &str, _: Option<&str>) -> Result<ExplainResult, AppError> {
            unreachable!()
        }
        async fn cancel_query(&self, _: &str) -> Result<(), AppError> {
            self.user_cancel.cancel();
            Ok(())
        }
    }

    #[tokio::test]
    async fn hard_cell_budget_stops_auto_producer_before_full_scan() {
        let driver = counting_producer(200, MAX_INTERACTIVE_CELL_BYTES + 1);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            QueryEngine::new().execute_query_stream_with_sink(
                driver.clone(),
                StreamQueryRequest {
                    sql: "SELECT fixture".into(),
                    query_id: "cell-stop".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                |_| Ok(()),
            ),
        )
        .await
        .expect("producer must exit without blocking on the bounded channel");
        assert_eq!(result.unwrap_err().code(), "RESULT_LIMIT_EXCEEDED");
        assert!(
            driver.produced.load(Ordering::Relaxed) < driver.rows,
            "budget failure must stop the producer, not scan every row"
        );
    }

    #[tokio::test]
    async fn max_rows_limits_production_and_is_normal_truncation() {
        let driver = counting_producer(10000, 1);
        let done = std::sync::Mutex::new(None);
        QueryEngine::new()
            .execute_query_stream_with_sink(driver.clone(), counting_request(Some(3)), |event| {
                if let QueryStreamEvent::Done(summary) = event {
                    *done.lock().unwrap() = Some(summary);
                }
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(driver.produced.load(Ordering::Relaxed), 4);
        let done = done.lock().unwrap().take().unwrap();
        assert_eq!(done.row_count, 3);
        assert!(done.truncated);
    }

    #[tokio::test]
    async fn total_byte_budget_stops_auto_producer_but_still_emits_truncated_done() {
        let driver = counting_producer(200, MAX_INTERACTIVE_CELL_BYTES - 2);
        let truncated = std::sync::atomic::AtomicBool::new(false);
        QueryEngine::new()
            .execute_query_stream_with_sink(driver.clone(), counting_request(None), |event| {
                if let QueryStreamEvent::Done(done) = event {
                    truncated.store(done.truncated, Ordering::Relaxed);
                }
                Ok(())
            })
            .await
            .unwrap();
        assert!(truncated.load(Ordering::Relaxed));
        assert!(driver.produced.load(Ordering::Relaxed) < 80);
    }

    #[tokio::test]
    async fn receiver_failure_stops_producer_joins_it_and_releases_operation_lease() {
        use crate::services::connection_manager::{create_active_connection, ConnectionManager};
        let id = uuid::Uuid::new_v4();
        let config = serde_json::from_value(serde_json::json!({ "id": id, "name": "Producer lease fixture", "driverType": "sqlite", "connectionUrl": ":memory:", "driverPaths": [], "createdAt": chrono::Utc::now(), "updatedAt": chrono::Utc::now() })).unwrap();
        let mut connections = ConnectionManager::new();
        connections.begin_connect(id).unwrap();
        connections
            .finish_connect(id, create_active_connection(&config, None, None).await)
            .unwrap();
        let operation = connections
            .begin_query_operation(id, "counting")
            .unwrap()
            .wait()
            .await
            .unwrap();
        assert!(connections.disconnect(id).is_err());
        let driver = counting_producer(10000, 1);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            QueryEngine::new().execute_query_stream_with_sink(
                driver.clone(),
                counting_request(None),
                |event| match event {
                    QueryStreamEvent::Chunk(_) => Err(AppError::ResultProcessingError(
                        "receiver unavailable".into(),
                    )),
                    _ => Ok(()),
                },
            ),
        )
        .await
        .unwrap();
        assert_eq!(result.unwrap_err().code(), "RESULT_PROCESSING_ERROR");
        assert!(driver.produced.load(Ordering::Relaxed) <= 10);
        drop(operation);
        connections.disconnect(id).unwrap();
    }

    #[tokio::test]
    async fn manual_budget_stop_intentionally_drains_and_preserves_real_database_failure() {
        for database_failure in [false, true] {
            let mut driver = counting_producer(200, MAX_INTERACTIVE_CELL_BYTES + 1);
            Arc::get_mut(&mut driver).unwrap().database_failure = database_failure;
            let result = QueryEngine::new()
                .execute_query_stream_with_sink_in_mode(
                    driver.clone(),
                    counting_request(None),
                    StreamTransactionMode::Manual,
                    |_| Ok(()),
                )
                .await;
            assert_eq!(driver.produced.load(Ordering::Relaxed), 200);
            assert_eq!(result.unwrap_err().affects_transaction(), database_failure);
        }
    }

    #[tokio::test]
    async fn user_cancel_is_execution_failure_not_a_client_budget_stop() {
        let driver = counting_producer(10000, 1);
        let cancellation = driver.user_cancel.clone();
        let result = QueryEngine::new()
            .execute_query_stream_with_sink(driver.clone(), counting_request(None), |event| {
                if matches!(event, QueryStreamEvent::Chunk(_)) {
                    cancellation.cancel();
                }
                Ok(())
            })
            .await;
        assert_eq!(result.as_ref().unwrap_err().code(), "QUERY_FAILED");
        assert!(result.unwrap_err().affects_transaction());
        assert!(driver.produced.load(Ordering::Relaxed) <= 10);
    }

    #[tokio::test]
    async fn event_delivery_failure_is_structured_and_does_not_poison_the_database_session() {
        let driver = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        driver.begin_transaction().await.unwrap();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let failures = count.clone();
        let result = QueryEngine::new()
            .execute_query_stream_with_sink(
                driver.clone(),
                StreamQueryRequest {
                    sql: "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3".into(),
                    query_id: "delivery".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                move |event| match event {
                    QueryStreamEvent::Chunk(_) => Err(AppError::ResultProcessingError(
                        "renderer delivery unavailable".into(),
                    )),
                    QueryStreamEvent::Error(_) => {
                        failures.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        Ok(())
                    }
                    QueryStreamEvent::Done(_) => panic!("delivery failure must not emit DONE"),
                },
            )
            .await;
        let error = result.unwrap_err();
        assert_eq!(error.code(), "RESULT_PROCESSING_ERROR");
        assert!(!error.affects_transaction());
        assert_eq!(count.load(std::sync::atomic::Ordering::Relaxed), 1);
        driver.execute_query("SELECT 4", None).await.unwrap();
        driver.commit_transaction().await.unwrap();
    }

    #[tokio::test]
    async fn database_stream_failure_retains_execution_error_type_and_emits_one_error() {
        let driver = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let failures = count.clone();
        let result = QueryEngine::new()
            .execute_query_stream_with_sink(
                driver,
                StreamQueryRequest {
                    sql: "SELECT * FROM missing_table".into(),
                    query_id: "database-failure".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                move |event| {
                    if let QueryStreamEvent::Error(_) = event {
                        failures.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                    Ok(())
                },
            )
            .await;
        assert!(result.unwrap_err().affects_transaction());
        assert_eq!(count.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn completion_delivery_failure_is_not_reported_as_database_success_or_failure() {
        let driver = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        let result = QueryEngine::new()
            .execute_query_stream_with_sink(
                driver,
                StreamQueryRequest {
                    sql: "SELECT 1".into(),
                    query_id: "done-delivery".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                |event| match event {
                    QueryStreamEvent::Done(_) => Err(AppError::ResultProcessingError(
                        "completion delivery failed".into(),
                    )),
                    _ => Ok(()),
                },
            )
            .await;
        assert!(!result.unwrap_err().affects_transaction());
    }

    #[tokio::test]
    async fn batch_respects_per_result_row_preference_and_executes_later_statements() {
        let driver = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        let engine = QueryEngine::new();
        let many_rows = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<60000) SELECT x FROM n";
        let sql = format!(
            "{many_rows}; {many_rows}; CREATE TABLE kept(x INTEGER); INSERT INTO kept VALUES(7)"
        );
        let response = engine
            .execute_query(driver.clone(), &sql, Some("batch".into()), Some(3))
            .await
            .unwrap();
        assert_eq!(response.results.len(), 4);
        assert_eq!(response.results[0].row_count, 3);
        assert!(response.results[0].truncated);
        assert_eq!(response.results[1].row_count, 3);
        assert!(response.results[1].truncated);
        assert_eq!(response.results[1].columns.len(), 1);
        assert!(response
            .results
            .iter()
            .all(|result| result.max_rows == Some(3)));
        assert_eq!(response.results[3].affected_rows, 1);
        assert!(response
            .results
            .iter()
            .all(|result| result.query_id.as_deref() == Some("batch")));
        let next = engine
            .execute_query(driver, "SELECT x FROM kept", None, None)
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
            .execute_query(driver.clone(), &sql, None, None)
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
        let (result, _) = collect_interactive_result(
            &driver,
            "SELECT 1 UNION ALL SELECT 2",
            "exact",
            2,
            MAX_INTERACTIVE_RESULT_BYTES,
            StreamTransactionMode::Auto,
        )
        .await
        .unwrap();
        assert_eq!(result.row_count, 2);
        assert!(!result.truncated);
        let (empty, _) = collect_interactive_result(
            &driver,
            "SELECT 1 AS x WHERE 0",
            "empty",
            0,
            MAX_INTERACTIVE_RESULT_BYTES,
            StreamTransactionMode::Auto,
        )
        .await
        .unwrap();
        assert_eq!(empty.columns.len(), 1);
        assert!(!empty.truncated);
        assert!(collect_interactive_result(
            &driver,
            "SELECT * FROM missing",
            "error",
            2,
            MAX_INTERACTIVE_RESULT_BYTES,
            StreamTransactionMode::Auto,
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn interactive_results_enforce_cell_and_total_byte_budgets() {
        let exact = "x".repeat(MAX_INTERACTIVE_CELL_BYTES - 2);
        assert_eq!(
            interactive_row_bytes(&[serde_json::json!(exact)]).unwrap(),
            MAX_INTERACTIVE_CELL_BYTES + 3
        );
        let oversized = "x".repeat(MAX_INTERACTIVE_CELL_BYTES - 1);
        assert!(interactive_row_bytes(&[serde_json::json!(oversized)]).is_err());
        assert_eq!(
            interactive_row_bytes(&[serde_json::json!("\"\n中")]).unwrap(),
            12
        );

        let driver = SqliteDriver::connect(":memory:").await.unwrap();
        let (result, retained_bytes) = collect_interactive_result(
            &driver,
            "SELECT printf('%060d', 1) UNION ALL SELECT printf('%060d', 2)",
            "bytes",
            10,
            65,
            StreamTransactionMode::Auto,
        )
        .await
        .unwrap();
        assert_eq!(retained_bytes, 65);
        assert_eq!(result.row_count, 1);
        assert!(result.truncated);
    }

    #[test]
    fn streamed_chunks_are_repartitioned_by_bytes_and_share_a_total_budget() {
        let chunk = || QueryResultChunk {
            query_id: "stream-budget".into(),
            columns: vec![crate::models::query_result::ColumnMeta {
                name: "value".into(),
                data_type: "text".into(),
                nullable: false,
            }],
            rows: (0..5)
                .map(|index| vec![serde_json::json!(format!("{index}-{}", "x".repeat(40)))])
                .collect(),
            row_offset: 0,
        };
        let (chunks, truncated) = bounded_stream_chunks(chunk(), 0, usize::MAX, 220, true).unwrap();
        assert!(!truncated);
        assert!(chunks.len() > 1);
        assert!(chunks
            .iter()
            .all(|chunk| serde_json::to_vec(chunk).unwrap().len() <= 220));
        assert_eq!(
            chunks.iter().map(|chunk| chunk.rows.len()).sum::<usize>(),
            5
        );
        for pair in chunks.windows(2) {
            assert_eq!(
                pair[1].row_offset,
                pair[0].row_offset + pair[0].rows.len() as u64
            );
            assert!(pair[1].columns.is_empty());
        }

        let first_bytes = serde_json::to_vec(&chunks[0]).unwrap().len();
        let (limited, truncated) =
            bounded_stream_chunks(chunk(), 7, first_bytes, 220, true).unwrap();
        assert!(truncated);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].row_offset, 7);

        let (subsequent, truncated) =
            bounded_stream_chunks(chunk(), 5, usize::MAX, 220, false).unwrap();
        assert!(!truncated);
        assert!(subsequent.iter().all(|chunk| chunk.columns.is_empty()));
    }
}
