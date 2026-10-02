use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    sync::{mpsc, Mutex},
    time::{timeout, Duration},
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    drivers::trait_def::{
        DatabaseDriver, DriverStreamRequest, StreamControl, StreamStopReason, StreamTransactionMode,
    },
    models::{
        connection::{ConnectionConfig, DriverType},
        driver_catalog::DriverDefinition,
        error::AppError,
        metadata::{
            ColumnInfo, DatabaseInfo, DbObjectInfo, DbObjectKind, DriverCapabilities,
            ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo, TableType,
        },
        query_result::{
            ColumnMeta, ExplainFormat, ExplainResult, QueryResult, QueryResultChunk,
            QueryStreamSummary,
        },
    },
    services::external_driver::{resolve_jdbc_bridge_jar, validate_jdbc_prerequisites},
    utils::{
        error_redaction::sanitize_diagnostic_error,
        query_budget::{
            row_json_bytes, MAX_INTERACTIVE_CELL_BYTES, MAX_INTERACTIVE_SOURCE_CHUNK_BYTES,
        },
    },
};

pub struct JdbcDriver {
    driver_type: DriverType,
    metadata_sql: Option<JdbcMetadataSql>,
    sidecar: Arc<JdbcBridgeSidecar>,
}

struct JdbcBridgeSidecar {
    start_spec: JdbcBridgeStartSpec,
    closed: AtomicBool,
    session_lost: AtomicBool,
    process: Mutex<Option<Arc<JdbcBridgeProcess>>>,
    active_stream: Mutex<Option<ActiveJdbcStream>>,
    // The bridge has one stdout protocol stream. A query stream emits several
    // frames, so metadata and completion requests must wait until it finishes
    // rather than reading one another's responses.
    request_lock: Mutex<()>,
}

struct JdbcBridgeStartSpec {
    program: String,
    arguments: Vec<String>,
    init_request: Zeroizing<String>,
}

enum JdbcRequestFailure {
    Poisoned(AppError),
    Completed(AppError),
}

struct JdbcBridgeProcess {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    stdout: Mutex<BufReader<ChildStdout>>,
    stderr: Mutex<BufReader<ChildStderr>>,
    next_request_id: AtomicU64,
}

#[derive(Clone)]
struct ActiveJdbcStream {
    query_id: String,
    request_id: u64,
    process: Arc<JdbcBridgeProcess>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcQueryOutput {
    columns: Vec<ColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
    row_count: u64,
    affected_rows: u64,
    elapsed_ms: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcStreamDoneOutput {
    row_count: u64,
    affected_rows: u64,
    elapsed_ms: u64,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    max_rows: Option<u64>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcStreamChunkOutput {
    columns: Vec<ColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcMetadataSql {
    databases: Option<String>,
    schemas: Option<String>,
    tables: Option<String>,
    views: Option<String>,
    columns: Option<String>,
    indexes: Option<String>,
    foreign_keys: Option<String>,
    functions: Option<String>,
    schema_objects: Option<String>,
    table_ddl: Option<String>,
    object_ddl: Option<String>,
}

impl JdbcDriver {
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<&str>,
        definition: Option<&DriverDefinition>,
    ) -> Result<Self, AppError> {
        let config = effective_jdbc_config(config, definition);
        validate_jdbc_prerequisites(&config).await?;
        let bridge_jar = resolve_jdbc_bridge_jar()?;
        let metadata_sql = definition
            .and_then(|definition| definition.metadata_dialect_sql.as_deref())
            .map(parse_metadata_sql)
            .transpose()?;
        let sidecar =
            JdbcBridgeSidecar::spawn(&config, password.unwrap_or(""), &bridge_jar).await?;
        let driver = Self {
            driver_type: config.driver_type,
            metadata_sql,
            sidecar: Arc::new(sidecar),
        };
        driver.ping().await?;
        Ok(driver)
    }

    async fn run_bridge(&self, command: &str, sql: Option<&str>) -> Result<String, AppError> {
        let runtime_command = match command {
            "ping" => JdbcBridgeCommand::Ping,
            "query" => JdbcBridgeCommand::Query(sql.unwrap_or_default().to_string()),
            "metadata" => JdbcBridgeCommand::Metadata(sql.unwrap_or_default().to_string()),
            other => {
                return Err(AppError::UnsupportedOperation {
                    driver: self.driver_name().to_string(),
                    operation: format!("jdbc bridge command {other}"),
                });
            }
        };

        self.sidecar
            .request(runtime_command)
            .await
            .map_err(|error| classify_jdbc_error(command, sql, error))
    }

    async fn metadata_query(
        &self,
        operation: &str,
        selector: impl FnOnce(&JdbcMetadataSql) -> Option<&str>,
        params: &[(&str, &str)],
    ) -> Result<QueryResult, AppError> {
        let dialect = self
            .metadata_sql
            .as_ref()
            .ok_or_else(|| unsupported(operation))?;
        let template = selector(dialect).ok_or_else(|| unsupported(operation))?;
        let sql = apply_metadata_template(template, params);
        self.execute_query(&sql, None)
            .await
            .map_err(|error| clarify_metadata_error(operation, error))
    }

    async fn metadata_bridge_query(
        &self,
        operation: &str,
        schema: Option<&str>,
        table: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let bridge_operation = match operation {
            "get_databases" => "databases",
            "get_schemas" => "schemas",
            "get_tables" => "tables",
            "get_views" => "views",
            "get_columns" => "columns",
            "get_indexes" => "indexes",
            "get_foreign_keys" => "foreignKeys",
            other => other,
        };
        let payload = format!(
            "{}\t{}\t{}",
            bridge_operation,
            schema.unwrap_or_default(),
            table.unwrap_or_default()
        );
        let output = self
            .run_bridge("metadata", Some(&payload))
            .await
            .map_err(|error| clarify_metadata_error(operation, error))?;
        let output: JdbcQueryOutput = serde_json::from_str(&output)?;
        validate_jdbc_query_output(&output)?;
        Ok(QueryResult {
            columns: output.columns,
            rows: output.rows,
            row_count: output.row_count,
            elapsed_ms: output.elapsed_ms,
            affected_rows: output.affected_rows,
            query_id: None,
            truncated: false,
            max_rows: None,
        })
    }

    async fn metadata_result(
        &self,
        operation: &str,
        selector: impl FnOnce(&JdbcMetadataSql) -> Option<&str>,
        params: &[(&str, &str)],
        bridge_schema: Option<&str>,
        bridge_table: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        if self.metadata_sql.is_some() {
            self.metadata_query(operation, selector, params).await
        } else {
            self.metadata_bridge_query(operation, bridge_schema, bridge_table)
                .await
        }
    }

    async fn get_table_like_metadata(
        &self,
        operation: &str,
        schema: &str,
        selector: impl FnOnce(&JdbcMetadataSql) -> Option<&str>,
        fallback_type: TableType,
    ) -> Result<Vec<TableInfo>, AppError> {
        let result = self
            .metadata_result(
                operation,
                selector,
                &[("schema", schema)],
                Some(schema),
                None,
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(TableInfo {
                    schema: row_string(&result, row, &["schema", "schema_name"])
                        .or_else(|| Some(schema.to_string())),
                    name: row_string(&result, row, &["name", "table", "table_name"])?,
                    table_type: row_string(&result, row, &["table_type", "type"])
                        .map(|value| table_type_from_value(&value))
                        .unwrap_or_else(|| fallback_type.clone()),
                    row_count: row_u64(&result, row, &["row_count", "rows"]),
                })
            })
            .collect())
    }
}

impl JdbcBridgeSidecar {
    async fn spawn(
        config: &ConnectionConfig,
        password: &str,
        bridge_jar: &Path,
    ) -> Result<Self, AppError> {
        let driver_class = required(config.driver_class.as_deref(), "JDBC driver class")?;
        let connection_url = required(config.connection_url.as_deref(), "JDBC URL")?;
        let username = config.username.as_deref().unwrap_or("");
        let classpath = build_classpath(bridge_jar, &config.driver_paths);

        let configured_heap = std::env::var("VAPORLENSDB_JDBC_MAX_HEAP_MB").ok();
        let max_heap_mb = parse_jdbc_max_heap_mb(configured_heap.as_deref());
        let mut init = JdbcBridgeCommand::Init {
            driver_class: driver_class.to_string(),
            connection_url: connection_url.to_string(),
            username: username.to_string(),
            password: password.to_string(),
        };
        let init_request = Zeroizing::new(init.encode(0));
        if let JdbcBridgeCommand::Init {
            connection_url,
            username,
            password,
            ..
        } = &mut init
        {
            connection_url.zeroize();
            username.zeroize();
            password.zeroize();
        }
        let sidecar = Self {
            start_spec: JdbcBridgeStartSpec {
                program: "java".into(),
                arguments: vec![
                    "-Xms16m".into(),
                    format!("-Xmx{max_heap_mb}m"),
                    "-XX:+UseSerialGC".into(),
                    "-cp".into(),
                    classpath,
                    "com.vaporlensdb.jdbcbridge.JdbcBridge".into(),
                    "server".into(),
                ],
                init_request,
            },
            closed: AtomicBool::new(false),
            session_lost: AtomicBool::new(false),
            process: Mutex::new(None),
            active_stream: Mutex::new(None),
            request_lock: Mutex::new(()),
        };
        sidecar.process().await?;
        Ok(sidecar)
    }

    async fn spawn_process(&self) -> Result<Arc<JdbcBridgeProcess>, AppError> {
        let mut child = Command::new(&self.start_spec.program)
            .args(&self.start_spec.arguments)
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|error| AppError::ConnectionFailed {
                driver: "jdbc".to_string(),
                message: format!("failed to start JDBC bridge sidecar: {error}"),
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::ConnectionFailed {
                driver: "jdbc".to_string(),
                message: "JDBC bridge sidecar stdin unavailable".to_string(),
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::ConnectionFailed {
                driver: "jdbc".to_string(),
                message: "JDBC bridge sidecar stdout unavailable".to_string(),
            })?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::ConnectionFailed {
                driver: "jdbc".to_string(),
                message: "JDBC bridge sidecar stderr unavailable".to_string(),
            })?;

        Ok(Arc::new(JdbcBridgeProcess {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            stdout: Mutex::new(BufReader::new(stdout)),
            stderr: Mutex::new(BufReader::new(stderr)),
            next_request_id: AtomicU64::new(1),
        }))
    }

    async fn request(&self, command: JdbcBridgeCommand) -> Result<String, AppError> {
        let timeout_window = command.timeout();
        self.request_with_timeout(command, timeout_window).await
    }

    async fn request_with_timeout(
        &self,
        command: JdbcBridgeCommand,
        timeout_window: Duration,
    ) -> Result<String, AppError> {
        let _request_guard = self.request_lock.lock().await;
        if self.session_lost.load(Ordering::Acquire)
            && matches!(command, JdbcBridgeCommand::Transaction("COMMIT"))
        {
            return Err(broken_sidecar(
                "JDBC session was lost; rollback is required before further transaction work",
            ));
        }
        let process = self.process().await?;
        if self.session_lost.load(Ordering::Acquire)
            && matches!(command, JdbcBridgeCommand::Transaction("ROLLBACK"))
        {
            self.session_lost.store(false, Ordering::Release);
            return Ok("{\"ok\":true}".into());
        }
        let request_id = process.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request = Zeroizing::new(command.encode(request_id));

        let result = self
            .request_on_process(
                &process,
                &request,
                request_id,
                timeout_window,
                command.operation_name(),
            )
            .await;
        let result = self.finish_request(&process, result).await;
        if result.is_ok()
            && matches!(
                command,
                JdbcBridgeCommand::Transaction("BEGIN" | "ROLLBACK")
            )
        {
            self.session_lost.store(false, Ordering::Release);
        }
        result
    }

    async fn finish_request<T>(
        &self,
        process: &Arc<JdbcBridgeProcess>,
        result: Result<T, JdbcRequestFailure>,
    ) -> Result<T, AppError> {
        match result {
            Ok(response) => Ok(response),
            Err(JdbcRequestFailure::Completed(error)) => Err(error),
            Err(JdbcRequestFailure::Poisoned(error)) => {
                self.abort_process(process).await;
                Err(error)
            }
        }
    }

    async fn request_on_process(
        &self,
        process: &Arc<JdbcBridgeProcess>,
        request: &str,
        request_id: u64,
        timeout_window: Duration,
        operation: &str,
    ) -> Result<String, JdbcRequestFailure> {
        self.write_request(process, request, timeout_window, operation)
            .await
            .map_err(JdbcRequestFailure::Poisoned)?;

        let mut response = String::new();
        let mut stdout = process.stdout.lock().await;
        let bytes_read = timeout(timeout_window, stdout.read_line(&mut response))
            .await
            .map_err(|_| {
                JdbcRequestFailure::Poisoned(AppError::Timeout {
                    operation: format!("jdbc {operation}"),
                    elapsed_ms: timeout_window.as_millis() as u64,
                })
            })?
            .map_err(|error| {
                JdbcRequestFailure::Poisoned(broken_sidecar(&format!(
                    "failed to read JDBC bridge response: {error}"
                )))
            })?;
        drop(stdout);

        if bytes_read == 0 {
            return Err(JdbcRequestFailure::Poisoned(
                process.take_exit_error().await,
            ));
        }

        let (status, payload) =
            parse_sidecar_frame(&response, request_id).map_err(JdbcRequestFailure::Poisoned)?;
        match status.as_str() {
            "OK" => Ok(payload),
            "ERR" => Err(JdbcRequestFailure::Completed(broken_sidecar(
                &normalize_jdbc_error_message(&payload),
            ))),
            "LIMIT" => Err(JdbcRequestFailure::Completed(
                AppError::ResultLimitExceeded(
                    "JDBC result exceeded the interactive byte limit".into(),
                ),
            )),
            _ => Err(JdbcRequestFailure::Poisoned(broken_sidecar(
                "malformed JDBC bridge response: invalid status",
            ))),
        }
    }

    #[cfg(test)]
    async fn request_stream_with_timeout(
        &self,
        sql: &str,
        query_id: &str,
        chunk_size: usize,
        max_rows: Option<u64>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
        timeout_window: Duration,
    ) -> Result<JdbcStreamDoneOutput, AppError> {
        self.request_stream_controlled(
            DriverStreamRequest {
                sql,
                query_id,
                chunk_size,
                max_rows,
            },
            chunks,
            timeout_window,
            StreamControl::new(StreamTransactionMode::Manual),
        )
        .await
    }

    async fn request_stream_controlled(
        &self,
        request: DriverStreamRequest<'_>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
        timeout_window: Duration,
        control: StreamControl,
    ) -> Result<JdbcStreamDoneOutput, AppError> {
        let DriverStreamRequest {
            sql,
            query_id,
            chunk_size,
            max_rows,
        } = request;
        let _request_guard = self.request_lock.lock().await;
        let process = self.process().await?;
        let request_id = process.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request = JdbcBridgeCommand::QueryStream {
            sql: sql.to_string(),
            chunk_size,
            max_rows,
        }
        .encode(request_id);
        {
            let mut active = self.active_stream.lock().await;
            *active = Some(ActiveJdbcStream {
                query_id: query_id.to_string(),
                request_id,
                process: process.clone(),
            });
        }
        let frames = self.request_stream_frames(
            &process,
            &request,
            request_id,
            query_id,
            chunks,
            timeout_window,
            &control,
        );
        let result = if control.can_abort_select(sql) {
            tokio::select! {
                biased;
                () = control.stopped() => None,
                result = frames => Some(result),
            }
        } else {
            Some(frames.await)
        };
        let result = match result {
            Some(result) => self.finish_request(&process, result).await,
            None => {
                self.abort_process(&process).await;
                Ok(JdbcStreamDoneOutput {
                    row_count: 0,
                    affected_rows: 0,
                    elapsed_ms: 0,
                    truncated: true,
                    max_rows,
                })
            }
        };
        let mut active = self.active_stream.lock().await;
        if active
            .as_ref()
            .is_some_and(|stream| stream.request_id == request_id)
        {
            *active = None;
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn request_stream_frames(
        &self,
        process: &Arc<JdbcBridgeProcess>,
        request: &str,
        request_id: u64,
        query_id: &str,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
        timeout_window: Duration,
        control: &StreamControl,
    ) -> Result<JdbcStreamDoneOutput, JdbcRequestFailure> {
        self.write_request(process, request, timeout_window, "query stream")
            .await
            .map_err(JdbcRequestFailure::Poisoned)?;
        let mut row_offset = 0_u64;
        let mut processing_error = None;
        let mut stdout = process.stdout.lock().await;
        loop {
            let mut response = String::new();
            let bytes_read = match timeout(timeout_window, stdout.read_line(&mut response)).await {
                Ok(result) => result.map_err(|error| {
                    JdbcRequestFailure::Poisoned(broken_sidecar(&format!(
                        "failed to read JDBC stream response: {error}"
                    )))
                })?,
                Err(_) => {
                    // A JDBC stream that stops producing protocol frames cannot
                    // recover safely: its worker may still own the shared
                    // stdout stream. Dispose of the sidecar so the next query
                    // starts with a clean process instead of leaving the UI in
                    // an indefinite "receiving results" state.
                    drop(stdout);
                    return Err(JdbcRequestFailure::Poisoned(AppError::Timeout {
                        operation: "jdbc query stream".to_string(),
                        elapsed_ms: timeout_window.as_millis() as u64,
                    }));
                }
            };
            if bytes_read == 0 {
                return Err(JdbcRequestFailure::Poisoned(
                    process.take_exit_error().await,
                ));
            }
            let (status, payload) =
                parse_sidecar_frame(&response, request_id).map_err(JdbcRequestFailure::Poisoned)?;
            match status.as_str() {
                "CHUNK" => {
                    if processing_error.is_some() || control.is_stopped() {
                        continue;
                    }
                    let output: JdbcStreamChunkOutput =
                        serde_json::from_str(&payload).map_err(|_| {
                            JdbcRequestFailure::Poisoned(broken_sidecar(
                                "malformed JDBC stream chunk payload",
                            ))
                        })?;
                    if let Err(error) = validate_jdbc_stream_chunk(&output.rows) {
                        control.stop(StreamStopReason::CellOrChunkLimit);
                        let _ = chunks.send(Err(error)).await;
                        processing_error = Some(AppError::ResultLimitExceeded(
                            "JDBC result exceeded the interactive cell or chunk limit".into(),
                        ));
                        tokio::task::yield_now().await;
                        continue;
                    }
                    let count = output.rows.len() as u64;
                    if chunks
                        .send(Ok(QueryResultChunk {
                            query_id: query_id.to_string(),
                            columns: output.columns,
                            rows: output.rows,
                            row_offset,
                        }))
                        .await
                        .is_err()
                    {
                        control.stop(StreamStopReason::ReceiverUnavailable);
                        processing_error = Some(AppError::ResultProcessingError(
                            "query stream receiver dropped".into(),
                        ));
                        continue;
                    }
                    row_offset += count;
                }
                "OK" => {
                    return match processing_error {
                        Some(error) => Err(JdbcRequestFailure::Completed(error)),
                        None => serde_json::from_str(&payload).map_err(|_| {
                            JdbcRequestFailure::Poisoned(broken_sidecar(
                                "malformed JDBC stream completion payload",
                            ))
                        }),
                    }
                }
                "LIMIT" => {
                    return Err(JdbcRequestFailure::Completed(
                        AppError::ResultLimitExceeded(
                            "JDBC result exceeded the interactive byte limit".into(),
                        ),
                    ))
                }
                "ERR" => {
                    return Err(JdbcRequestFailure::Completed(broken_sidecar(
                        &normalize_jdbc_error_message(&payload),
                    )))
                }
                _ => {
                    return Err(JdbcRequestFailure::Poisoned(broken_sidecar(
                        "malformed JDBC stream response status",
                    )))
                }
            }
        }
    }

    async fn cancel_stream(&self, query_id: &str) -> Result<(), AppError> {
        let active = self.active_stream.lock().await.clone();
        let Some(active) = active.filter(|stream| stream.query_id == query_id) else {
            return Err(AppError::NotFound {
                resource: "active JDBC query".to_string(),
                id: query_id.to_string(),
            });
        };
        let process = active.process;
        self.write_request(
            &process,
            &format!("CANCEL\t0\t{}\n", active.request_id),
            Duration::from_secs(2),
            "cancel query",
        )
        .await
    }

    async fn process(&self) -> Result<Arc<JdbcBridgeProcess>, AppError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(broken_sidecar("JDBC bridge sidecar has been shut down"));
        }
        let mut current = self.process.lock().await;
        if let Some(process) = current.as_ref() {
            return Ok(process.clone());
        }
        let process = self.spawn_process().await?;
        let initialized = self
            .request_on_process(
                &process,
                &self.start_spec.init_request,
                0,
                Duration::from_secs(JDBC_CONNECT_TIMEOUT_SECS as u64),
                "initialize",
            )
            .await;
        if let Err(JdbcRequestFailure::Poisoned(error) | JdbcRequestFailure::Completed(error)) =
            initialized
        {
            process.kill_and_reap().await;
            return Err(error);
        }
        *current = Some(process.clone());
        Ok(process)
    }

    async fn clear_process(&self, process: &Arc<JdbcBridgeProcess>) {
        let mut current = self.process.lock().await;
        if current
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, process))
        {
            *current = None;
        }
    }

    async fn abort_process(&self, process: &Arc<JdbcBridgeProcess>) {
        self.clear_process(process).await;
        self.session_lost.store(true, Ordering::Release);
        let mut active = self.active_stream.lock().await;
        if active
            .as_ref()
            .is_some_and(|stream| Arc::ptr_eq(&stream.process, process))
        {
            *active = None;
        }
        drop(active);
        process.kill_and_reap().await;
    }

    async fn write_request(
        &self,
        process: &JdbcBridgeProcess,
        request: &str,
        timeout_window: Duration,
        operation: &str,
    ) -> Result<(), AppError> {
        let mut stdin = process.stdin.lock().await;
        write_protocol_request(&mut *stdin, request, timeout_window, operation).await
    }

    async fn shutdown(&self) -> Result<(), AppError> {
        let _request_guard = self.request_lock.lock().await;
        self.closed.store(true, Ordering::Release);
        *self.active_stream.lock().await = None;
        let process = self.process.lock().await.take();
        let Some(process) = process else {
            return Ok(());
        };

        let request = "CLOSE\t0\t-\n".to_string();
        let _ = self
            .write_request(&process, &request, Duration::from_secs(2), "shutdown")
            .await;
        let _ = timeout(Duration::from_secs(2), process.child.lock().await.wait()).await;
        process.kill_and_reap().await;
        Ok(())
    }
}

async fn write_protocol_request(
    writer: &mut (impl AsyncWrite + Unpin),
    request: &str,
    timeout_window: Duration,
    operation: &str,
) -> Result<(), AppError> {
    timeout(timeout_window, writer.write_all(request.as_bytes()))
        .await
        .map_err(|_| AppError::Timeout {
            operation: format!("jdbc {operation}"),
            elapsed_ms: timeout_window.as_millis() as u64,
        })?
        .map_err(|error| {
            broken_sidecar(&format!("failed to write JDBC bridge request: {error}"))
        })?;
    timeout(timeout_window, writer.flush())
        .await
        .map_err(|_| AppError::Timeout {
            operation: format!("jdbc {operation}"),
            elapsed_ms: timeout_window.as_millis() as u64,
        })?
        .map_err(|error| broken_sidecar(&format!("failed to flush JDBC bridge request: {error}")))
}

impl Drop for JdbcBridgeSidecar {
    fn drop(&mut self) {
        if let Some(process) = self.process.get_mut().take() {
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    process.kill_and_reap().await;
                });
            } else if let Ok(mut child) = process.child.try_lock() {
                let _ = child.start_kill();
            }
        }
    }
}

impl JdbcBridgeProcess {
    async fn kill_and_reap(&self) {
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    async fn take_exit_error(&self) -> AppError {
        self.kill_and_reap().await;
        let status = self.child.lock().await.wait().await.ok();
        let mut stderr = String::new();
        let _ = self.stderr.lock().await.read_to_string(&mut stderr).await;
        let stderr = stderr.trim();
        let message = if stderr.is_empty() {
            match status {
                Some(status) => {
                    format!("JDBC bridge sidecar exited unexpectedly with status {status}")
                }
                None => "JDBC bridge sidecar exited unexpectedly".to_string(),
            }
        } else {
            stderr.to_string()
        };
        broken_sidecar(&message)
    }
}

enum JdbcBridgeCommand {
    Init {
        driver_class: String,
        connection_url: String,
        username: String,
        password: String,
    },
    Ping,
    Query(String),
    QueryStream {
        sql: String,
        chunk_size: usize,
        max_rows: Option<u64>,
    },
    Metadata(String),
    Transaction(&'static str),
}

impl JdbcBridgeCommand {
    fn encode(&self, request_id: u64) -> String {
        match self {
            Self::Init {
                driver_class,
                connection_url,
                username,
                password,
            } => format!(
                "INIT\t{request_id}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                BASE64.encode(driver_class),
                BASE64.encode(connection_url),
                BASE64.encode(username),
                BASE64.encode(password),
                JDBC_CONNECT_TIMEOUT_SECS,
                JDBC_QUERY_TIMEOUT_SECS,
            ),
            Self::Ping => format!("PING\t{request_id}\t-\n"),
            Self::Query(sql) => format!("QUERY\t{request_id}\t{}\n", BASE64.encode(sql)),
            Self::QueryStream {
                sql,
                chunk_size,
                max_rows,
            } => {
                let payload = serde_json::json!({
                    "sql": BASE64.encode(sql),
                    "chunkSize": chunk_size,
                    "maxRows": max_rows,
                    "maxCellBytes": MAX_INTERACTIVE_CELL_BYTES,
                    "maxChunkBytes": MAX_INTERACTIVE_SOURCE_CHUNK_BYTES,
                    "maxResultBytes": MAX_JDBC_RESULT_BYTES,
                });
                format!(
                    "QUERY_STREAM\t{request_id}\t{}\n",
                    BASE64.encode(payload.to_string())
                )
            }
            Self::Metadata(payload) => {
                format!("METADATA\t{request_id}\t{}\n", BASE64.encode(payload))
            }
            Self::Transaction(action) => format!("TRANSACTION\t{request_id}\t{action}\n"),
        }
    }

    fn operation_name(&self) -> &'static str {
        match self {
            Self::Init { .. } => "initialize",
            Self::Ping => "ping",
            Self::Query(_) => "query",
            Self::QueryStream { .. } => "query stream",
            Self::Metadata(_) => "metadata",
            Self::Transaction(_) => "transaction",
        }
    }

    fn timeout(&self) -> Duration {
        match self {
            Self::Init { .. } => Duration::from_secs(JDBC_CONNECT_TIMEOUT_SECS as u64),
            Self::Ping => Duration::from_secs(JDBC_CONNECT_TIMEOUT_SECS as u64),
            Self::Query(_) => Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
            Self::QueryStream { .. } => Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
            Self::Metadata(_) => Duration::from_secs(JDBC_METADATA_TIMEOUT_SECS as u64),
            Self::Transaction(_) => Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
        }
    }
}

const JDBC_CONNECT_TIMEOUT_SECS: u32 = 15;
const JDBC_QUERY_TIMEOUT_SECS: u32 = 60;
const JDBC_METADATA_TIMEOUT_SECS: u32 = 30;
const MAX_JDBC_RESULT_BYTES: usize = 64 * 1024 * 1024;

#[async_trait]
impl DatabaseDriver for JdbcDriver {
    fn driver_name(&self) -> &'static str {
        "jdbc"
    }

    fn capabilities(&self) -> DriverCapabilities {
        let supports_ddl = self
            .metadata_sql
            .as_ref()
            .map(|sql| sql.table_ddl.is_some() || sql.object_ddl.is_some())
            .unwrap_or(false);
        DriverCapabilities {
            has_database: true,
            has_schema: true,
            supports_transactions: true,
            supports_explain: self.driver_type == DriverType::Oracle,
            supports_cancel: true,
            supports_ddl,
            supports_streaming: true,
        }
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.run_bridge("ping", None).await.map(|_| ())
    }

    async fn begin_transaction(&self) -> Result<(), AppError> {
        self.sidecar
            .request(JdbcBridgeCommand::Transaction("BEGIN"))
            .await
            .map(|_| ())
    }

    async fn commit_transaction(&self) -> Result<(), AppError> {
        self.sidecar
            .request(JdbcBridgeCommand::Transaction("COMMIT"))
            .await
            .map(|_| ())
    }

    async fn rollback_transaction(&self) -> Result<(), AppError> {
        self.sidecar
            .request(JdbcBridgeCommand::Transaction("ROLLBACK"))
            .await
            .map(|_| ())
    }

    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let sql = normalize_jdbc_sql(sql);
        let output = self
            .run_bridge("query", Some(&sql))
            .await
            .map_err(|error| {
                if matches!(error, AppError::QueryFailed { .. }) {
                    error
                } else {
                    AppError::QueryFailed {
                        sql: sql.clone(),
                        message: error.to_string(),
                    }
                }
            })?;
        let output: JdbcQueryOutput = serde_json::from_str(&output)?;
        validate_jdbc_query_output(&output)?;
        Ok(QueryResult {
            columns: output.columns,
            rows: output.rows,
            row_count: output.row_count,
            elapsed_ms: output.elapsed_ms,
            affected_rows: output.affected_rows,
            query_id: query_id.map(str::to_string),
            truncated: false,
            max_rows: None,
        })
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
            sql,
            query_id,
            chunk_size,
            max_rows,
        } = request;
        let start = Instant::now();
        // JDBC statements do not accept the editor's optional trailing
        // delimiter. Keep streamed execution consistent with execute_query.
        let sql = normalize_jdbc_sql(sql);
        let done = self
            .sidecar
            .request_stream_controlled(
                DriverStreamRequest {
                    sql: &sql,
                    query_id,
                    chunk_size: chunk_size.max(1),
                    max_rows,
                },
                chunks,
                Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
                control,
            )
            .await
            .map_err(|error| classify_jdbc_error("query", Some(&sql), error))?;

        Ok(QueryStreamSummary {
            query_id: query_id.to_string(),
            row_count: done.row_count,
            affected_rows: done.affected_rows,
            elapsed_ms: done.elapsed_ms.max(start.elapsed().as_millis() as u64),
            truncated: done.truncated,
            max_rows: done.max_rows.or(max_rows),
        })
    }

    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
        let result = self
            .metadata_result("databases", |sql| sql.databases.as_deref(), &[], None, None)
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| row_string(&result, row, &["name", "database", "database_name"]))
            .map(|name| DatabaseInfo { name })
            .collect())
    }

    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        let result = self
            .metadata_result(
                "schemas",
                |sql| sql.schemas.as_deref(),
                &[("database", database.unwrap_or(""))],
                None,
                None,
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(SchemaInfo {
                    name: row_string(&result, row, &["name", "schema", "schema_name"])?,
                    database: row_string(&result, row, &["database", "database_name"]),
                })
            })
            .collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        self.get_table_like_metadata(
            "get_tables",
            schema,
            |sql| sql.tables.as_deref(),
            TableType::Table,
        )
        .await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        let result = self
            .metadata_result(
                "columns",
                |sql| sql.columns.as_deref(),
                &[("schema", schema), ("table", table)],
                Some(schema),
                Some(table),
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| map_column_row(&result, row, schema, table, index))
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
        let result = self
            .metadata_result(
                "indexes",
                |sql| sql.indexes.as_deref(),
                &[("schema", schema), ("table", table)],
                Some(schema),
                Some(table),
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| map_index_row(&result, row, schema, table))
            .collect())
    }

    async fn get_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let result = self
            .metadata_result(
                "foreignKeys",
                |sql| sql.foreign_keys.as_deref(),
                &[("schema", schema), ("table", table)],
                Some(schema),
                Some(table),
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(ForeignKeyInfo {
                    schema: row_string(&result, row, &["schema", "schema_name"])
                        .or_else(|| Some(schema.to_string())),
                    table: row_string(&result, row, &["table", "table_name"])
                        .unwrap_or_else(|| table.to_string()),
                    name: row_string(&result, row, &["name", "foreign_key", "fk_name"])?,
                    columns: row_string(&result, row, &["columns", "column_names"])
                        .map(split_csv)
                        .unwrap_or_default(),
                    referenced_schema: row_string(
                        &result,
                        row,
                        &["referenced_schema", "ref_schema"],
                    ),
                    referenced_table: row_string(&result, row, &["referenced_table", "ref_table"])?,
                    referenced_columns: row_string(
                        &result,
                        row,
                        &["referenced_columns", "ref_columns"],
                    )
                    .map(split_csv)
                    .unwrap_or_default(),
                })
            })
            .collect())
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        self.get_table_like_metadata(
            "get_views",
            schema,
            |sql| sql.views.as_deref(),
            TableType::View,
        )
        .await
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let result = self
            .metadata_query(
                "get_functions",
                |sql| sql.functions.as_deref(),
                &[("schema", schema)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| row_string(&result, row, &["name", "function", "function_name"]))
            .collect())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let result = self
            .metadata_query(
                "get_table_ddl",
                |sql| sql.table_ddl.as_deref(),
                &[("schema", schema), ("table", table)],
            )
            .await?;
        result
            .rows
            .first()
            .and_then(|row| row_string(&result, row, &["ddl", "definition"]))
            .ok_or_else(|| AppError::QueryFailed {
                sql: "metadata table DDL".to_string(),
                message: "metadata SQL did not return a ddl column".to_string(),
            })
    }

    async fn get_schema_objects(
        &self,
        schema: &str,
        kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        let kind_value = db_object_kind_value(&kind);
        let result = self
            .metadata_query(
                "get_schema_objects",
                |sql| sql.schema_objects.as_deref(),
                &[("schema", schema), ("kind", kind_value)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                let row_kind = row_string(&result, row, &["kind", "object_kind"])
                    .as_deref()
                    .map(db_object_kind_from_value)
                    .unwrap_or_else(|| kind.clone());
                map_schema_object_row(&result, row, schema, row_kind)
            })
            .collect())
    }

    async fn get_object_ddl(
        &self,
        schema: &str,
        name: &str,
        kind: DbObjectKind,
    ) -> Result<String, AppError> {
        let result = self
            .metadata_query(
                "get_object_ddl",
                |sql| sql.object_ddl.as_deref(),
                &[
                    ("schema", schema),
                    ("name", name),
                    ("kind", db_object_kind_value(&kind)),
                ],
            )
            .await?;
        result
            .rows
            .first()
            .and_then(|row| row_string(&result, row, &["ddl", "definition", "source"]))
            .ok_or_else(|| AppError::QueryFailed {
                sql: "metadata object DDL".to_string(),
                message: "metadata SQL did not return a ddl column".to_string(),
            })
    }

    async fn explain_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<ExplainResult, AppError> {
        if self.driver_type != DriverType::Oracle {
            return Err(unsupported("explain_query"));
        }

        let request_id = Uuid::new_v4().simple().to_string();
        let statement_id = format!("VL{}", &request_id[..28]);
        let statement_sql = normalize_jdbc_sql(sql);
        let explain_sql =
            format!("EXPLAIN PLAN SET STATEMENT_ID = '{statement_id}' FOR {statement_sql}");
        self.execute_query(&explain_sql, query_id)
            .await
            .map_err(clarify_oracle_explain_error)?;

        let display_sql = format!(
            "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', '{statement_id}', 'TYPICAL'))"
        );
        let result = self
            .execute_query(&display_sql, query_id)
            .await
            .map_err(clarify_oracle_explain_error)?;

        let cleanup_sql = format!("DELETE FROM PLAN_TABLE WHERE STATEMENT_ID = '{statement_id}'");
        let _ = self.execute_query(&cleanup_sql, None).await;

        Ok(ExplainResult {
            format: ExplainFormat::Table,
            plan: serde_json::Value::Null,
            elapsed_ms: result.elapsed_ms,
            result: Some(result),
        })
    }

    async fn cancel_query(&self, query_id: &str) -> Result<(), AppError> {
        self.sidecar.cancel_stream(query_id).await
    }

    async fn cancel_all_queries(&self) -> Result<(), AppError> {
        self.sidecar.shutdown().await
    }
}

fn build_classpath(bridge_jar: &Path, driver_paths: &[String]) -> String {
    let separator = if cfg!(windows) { ";" } else { ":" };
    std::iter::once(bridge_jar.display().to_string())
        .chain(driver_paths.iter().cloned())
        .collect::<Vec<_>>()
        .join(separator)
}

fn effective_jdbc_config(
    config: &ConnectionConfig,
    definition: Option<&DriverDefinition>,
) -> ConnectionConfig {
    let mut config = config.clone();
    if config
        .driver_class
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        config.driver_class =
            definition.and_then(|definition| definition.jdbc_driver_class.clone());
    }
    if config.driver_paths.is_empty() {
        if let Some(definition) = definition {
            config.driver_paths = definition.driver_artifacts.clone();
        }
    }
    config
}

fn parse_metadata_sql(value: &str) -> Result<JdbcMetadataSql, AppError> {
    serde_json::from_str(value).map_err(|error| {
        AppError::ConfigError(format!(
            "metadata dialect SQL must be a JSON object with keys like schemas/tables/columns: {error}"
        ))
    })
}

fn apply_metadata_template(template: &str, params: &[(&str, &str)]) -> String {
    params
        .iter()
        .fold(template.to_string(), |sql, (name, value)| {
            sql.replace(&format!("{{{name}}}"), &escape_sql_literal(value))
        })
}

fn escape_sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn row_string(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<String> {
    let index = column_index(result, names)?;
    match row.get(index)? {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Null => None,
        value => Some(value.to_string()),
    }
}

fn row_bool(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<bool> {
    let value = row.get(column_index(result, names)?)?;
    match value {
        serde_json::Value::Bool(value) => Some(*value),
        serde_json::Value::Number(value) => Some(value.as_i64().unwrap_or(0) != 0),
        serde_json::Value::String(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            if matches!(normalized.as_str(), "1" | "true" | "yes" | "y") {
                Some(true)
            } else if matches!(normalized.as_str(), "0" | "false" | "no" | "n") {
                Some(false)
            } else {
                None
            }
        }
        serde_json::Value::Null => None,
        _ => None,
    }
}

fn row_i32(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<i32> {
    row_i64(result, row, names).map(|value| value as i32)
}

fn row_i64(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<i64> {
    let value = row.get(column_index(result, names)?)?;
    match value {
        serde_json::Value::Number(value) => value.as_i64(),
        serde_json::Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn row_u64(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<u64> {
    row_i64(result, row, names).and_then(|value| value.try_into().ok())
}

fn column_index(result: &QueryResult, names: &[&str]) -> Option<usize> {
    result.columns.iter().position(|column| {
        names
            .iter()
            .any(|name| column.name.eq_ignore_ascii_case(name))
    })
}

fn split_csv(value: String) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn map_column_row(
    result: &QueryResult,
    row: &[serde_json::Value],
    schema: &str,
    table: &str,
    index: usize,
) -> Option<ColumnInfo> {
    Some(ColumnInfo {
        schema: row_string(result, row, &["schema", "schema_name"])
            .or_else(|| Some(schema.to_string())),
        table: row_string(result, row, &["table", "table_name"])
            .unwrap_or_else(|| table.to_string()),
        name: row_string(result, row, &["name", "column", "column_name"])?,
        ordinal_position: row_i32(result, row, &["ordinal_position", "position"])
            .unwrap_or((index + 1) as i32),
        data_type: row_string(result, row, &["data_type", "type", "type_name"])
            .unwrap_or_else(|| "unknown".to_string()),
        nullable: row_bool(result, row, &["nullable", "is_nullable"]).unwrap_or(true),
        default_value: row_string(result, row, &["default_value", "column_default"]),
        character_maximum_length: row_i64(result, row, &["character_maximum_length", "max_length"]),
        numeric_precision: row_i32(result, row, &["numeric_precision", "precision"]),
        numeric_scale: row_i32(result, row, &["numeric_scale", "scale"]),
        is_primary_key: row_bool(result, row, &["is_primary_key", "primary_key"]).unwrap_or(false),
        is_identity: false,
        is_generated: row_bool(result, row, &["is_generated", "is_generated_column"])
            .unwrap_or(false),
        is_auto_increment: row_bool(result, row, &["is_auto_increment", "is_autoincrement"])
            .unwrap_or(false),
    })
}

fn map_index_row(
    result: &QueryResult,
    row: &[serde_json::Value],
    schema: &str,
    table: &str,
) -> Option<IndexInfo> {
    Some(IndexInfo {
        schema: row_string(result, row, &["schema", "schema_name"])
            .or_else(|| Some(schema.to_string())),
        table: row_string(result, row, &["table", "table_name"])
            .unwrap_or_else(|| table.to_string()),
        name: row_string(result, row, &["name", "index", "index_name"])?,
        columns: row_string(result, row, &["columns", "column_names"])
            .map(split_csv)
            .unwrap_or_default(),
        unique: row_bool(result, row, &["unique", "is_unique"]).unwrap_or(false),
        definition: row_string(result, row, &["definition", "index_definition"]),
    })
}

fn map_schema_object_row(
    result: &QueryResult,
    row: &[serde_json::Value],
    schema: &str,
    kind: DbObjectKind,
) -> Option<DbObjectInfo> {
    Some(DbObjectInfo {
        schema: row_string(result, row, &["schema", "schema_name", "owner"])
            .or_else(|| Some(schema.to_string())),
        name: row_string(result, row, &["name", "object_name"])?,
        kind,
        object_type: row_string(result, row, &["object_type", "type"]),
        status: row_string(result, row, &["status"]),
    })
}

fn table_type_from_value(value: &str) -> TableType {
    match value.trim().to_ascii_lowercase().as_str() {
        "table" | "base table" => TableType::Table,
        "view" => TableType::View,
        "materialized view" | "materialized_view" => TableType::MaterializedView,
        "system table" | "system_table" => TableType::SystemTable,
        value => TableType::Other(value.to_string()),
    }
}

fn db_object_kind_value(kind: &DbObjectKind) -> &'static str {
    match kind {
        DbObjectKind::Table => "table",
        DbObjectKind::View => "view",
        DbObjectKind::MaterializedView => "materializedView",
        DbObjectKind::Index => "index",
        DbObjectKind::Procedure => "procedure",
        DbObjectKind::Function => "function",
        DbObjectKind::Package => "package",
        DbObjectKind::Sequence => "sequence",
        DbObjectKind::Trigger => "trigger",
        DbObjectKind::Synonym => "synonym",
        DbObjectKind::Event => "event",
    }
}

fn db_object_kind_from_value(value: &str) -> DbObjectKind {
    match value.trim().to_ascii_lowercase().as_str() {
        "table" => DbObjectKind::Table,
        "view" => DbObjectKind::View,
        "materializedview" | "materialized_view" | "materialized view" => {
            DbObjectKind::MaterializedView
        }
        "index" => DbObjectKind::Index,
        "procedure" => DbObjectKind::Procedure,
        "function" => DbObjectKind::Function,
        "package" => DbObjectKind::Package,
        "sequence" => DbObjectKind::Sequence,
        "trigger" => DbObjectKind::Trigger,
        "synonym" => DbObjectKind::Synonym,
        "event" => DbObjectKind::Event,
        _ => DbObjectKind::Table,
    }
}

fn clarify_metadata_error(operation: &str, error: AppError) -> AppError {
    match error {
        AppError::QueryFailed { sql, message } => {
            let lower = message.to_ascii_lowercase();
            let hint = if lower.contains("ora-01031") || lower.contains("insufficient privileges") {
                Some("insufficient privileges for Oracle metadata; grant access to the object or DBMS_METADATA")
            } else if lower.contains("ora-00942") {
                Some("Oracle metadata object is not visible to the current user")
            } else {
                None
            };
            let message = match hint {
                Some(hint) => format!("{operation}: {hint}. {message}"),
                None => format!("{operation}: {message}"),
            };
            AppError::QueryFailed { sql, message }
        }
        error => error,
    }
}

fn clarify_oracle_explain_error(error: AppError) -> AppError {
    match error {
        AppError::QueryFailed { sql, message } => {
            let lower = message.to_ascii_lowercase();
            let hint = if lower.contains("ora-01031") || lower.contains("insufficient privileges") {
                "Oracle execution plans require permission to write PLAN_TABLE and execute DBMS_XPLAN.DISPLAY"
            } else if lower.contains("ora-00942") {
                "Oracle execution plans require an accessible PLAN_TABLE and DBMS_XPLAN.DISPLAY"
            } else {
                "Oracle execution plan failed"
            };
            AppError::QueryFailed {
                sql,
                message: format!("{hint}. {message}"),
            }
        }
        error => error,
    }
}

fn classify_jdbc_error(command: &str, sql: Option<&str>, error: AppError) -> AppError {
    match error {
        AppError::Timeout { .. } => error,
        AppError::ResultLimitExceeded(_)
        | AppError::ResultProcessingError(_)
        | AppError::SerializationError(_) => error,
        AppError::ConnectionFailed { driver, message } if command == "query" => {
            AppError::QueryFailed {
                sql: sql.unwrap_or("<unknown>").to_string(),
                message: format!("{driver}: {}", normalize_jdbc_error_message(&message)),
            }
        }
        AppError::ConnectionFailed { driver, message } => AppError::ConnectionFailed {
            driver,
            message: normalize_jdbc_error_message(&message),
        },
        AppError::QueryFailed { sql, message } => AppError::QueryFailed {
            sql,
            message: normalize_jdbc_error_message(&message),
        },
        AppError::IoError(message) => {
            if command == "query" {
                AppError::QueryFailed {
                    sql: sql.unwrap_or("<unknown>").to_string(),
                    message: normalize_jdbc_error_message(&message),
                }
            } else {
                AppError::ConnectionFailed {
                    driver: "jdbc".to_string(),
                    message: normalize_jdbc_error_message(&message),
                }
            }
        }
        other => {
            if command == "query" {
                AppError::QueryFailed {
                    sql: sql.unwrap_or("<unknown>").to_string(),
                    message: normalize_jdbc_error_message(&other.to_string()),
                }
            } else {
                AppError::ConnectionFailed {
                    driver: "jdbc".to_string(),
                    message: normalize_jdbc_error_message(&other.to_string()),
                }
            }
        }
    }
}

#[cfg(test)]
fn parse_sidecar_response(response: &str, expected_request_id: u64) -> Result<String, AppError> {
    let (status, decoded) = parse_sidecar_frame(response, expected_request_id)?;
    match status.as_str() {
        "OK" => Ok(decoded),
        "ERR" => Err(broken_sidecar(&normalize_jdbc_error_message(&decoded))),
        "LIMIT" => Err(AppError::ResultLimitExceeded(
            "JDBC result exceeded the interactive byte limit".into(),
        )),
        _ => Err(broken_sidecar(
            "malformed JDBC bridge response: invalid status",
        )),
    }
}

fn validate_jdbc_stream_chunk(rows: &[Vec<serde_json::Value>]) -> Result<(), AppError> {
    let mut chunk_bytes = 0_usize;
    for row in rows {
        chunk_bytes = chunk_bytes.saturating_add(row_json_bytes(row)?);
        if chunk_bytes > MAX_INTERACTIVE_SOURCE_CHUNK_BYTES {
            return Err(AppError::ResultLimitExceeded(
                "JDBC bridge stream chunk exceeded the interactive byte limit".into(),
            ));
        }
    }
    Ok(())
}

fn validate_jdbc_query_output(output: &JdbcQueryOutput) -> Result<(), AppError> {
    validate_jdbc_query_output_with_limit(output, MAX_JDBC_RESULT_BYTES)
}

fn validate_jdbc_query_output_with_limit(
    output: &JdbcQueryOutput,
    max_result_bytes: usize,
) -> Result<(), AppError> {
    let mut result_bytes = 0_usize;
    for row in &output.rows {
        let row_bytes = row_json_bytes(row)?;
        let framed_bytes = row_bytes.saturating_add(usize::from(result_bytes > 0));
        if framed_bytes > max_result_bytes.saturating_sub(result_bytes) {
            return Err(AppError::ResultLimitExceeded(
                "JDBC bridge query result exceeded the interactive byte limit".into(),
            ));
        }
        result_bytes = result_bytes.saturating_add(framed_bytes);
    }
    Ok(())
}

fn parse_sidecar_frame(
    response: &str,
    expected_request_id: u64,
) -> Result<(String, String), AppError> {
    let trimmed = response.trim_end();
    let mut parts = trimmed.splitn(3, '\t');
    let status = parts
        .next()
        .ok_or_else(|| broken_sidecar("malformed JDBC bridge response: missing status"))?;
    let request_id = parts
        .next()
        .ok_or_else(|| broken_sidecar("malformed JDBC bridge response: missing request id"))?;
    let payload = parts
        .next()
        .ok_or_else(|| broken_sidecar("malformed JDBC bridge response: missing payload"))?;
    let request_id = request_id
        .parse::<u64>()
        .map_err(|_| broken_sidecar("malformed JDBC bridge response: invalid request id"))?;

    if request_id != expected_request_id {
        return Err(broken_sidecar("JDBC bridge response id mismatch"));
    }

    let decoded = BASE64
        .decode(payload)
        .map_err(|_| broken_sidecar("malformed JDBC bridge response payload"))?;
    let decoded = String::from_utf8(decoded)
        .map_err(|_| broken_sidecar("JDBC bridge response payload was not valid UTF-8"))?;

    Ok((status.to_string(), decoded))
}

fn normalize_jdbc_error_message(message: &str) -> String {
    let normalized = compact_jdbc_error_message(message);
    let lower = normalized.to_ascii_lowercase();
    let classified =
        if lower.contains("io error: connection failed") || lower.contains("connection refused") {
            normalized
        } else if lower.contains("ora-01017")
            || lower.contains("access denied")
            || lower.contains("authentication failed")
            || lower.contains("invalid username/password")
        {
            format!("authentication failed. {normalized}")
        } else if lower.contains("no suitable driver") {
            format!("JDBC driver class or JAR is not usable. {normalized}")
        } else if lower.contains("classnotfoundexception")
            || lower.contains("class not found")
            || lower.contains("could not find or load main class")
        {
            format!("JDBC driver class or bridge class is missing from the classpath. {normalized}")
        } else if lower.contains("jdbc url")
            || lower.contains("invalid url")
            || lower.contains("malformed")
            || lower.contains("invalid connection string")
        {
            format!("JDBC URL is invalid for this driver. {normalized}")
        } else if lower.contains("unknown host")
            || lower.contains("ora-17820")
            || lower.contains("network adapter could not establish the connection")
            || lower.contains("the network adapter could not establish the connection")
        {
            format!("database host is unreachable. {normalized}")
        } else {
            normalized
        };
    sanitize_diagnostic_error(&classified, None)
}

fn compact_jdbc_error_message(message: &str) -> String {
    let mut lines = Vec::new();
    for line in message
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let lower = line.to_ascii_lowercase();
        if line.starts_with("at ")
            || line.starts_with("... ")
            || line.starts_with("Caused by: oracle.net.ns.NetException")
            || line.starts_with("Caused by: java.io.IOException")
            || lower.starts_with("信息:")
            || lower.starts_with("info:")
        {
            continue;
        }

        let line = line.strip_prefix("Caused by: ").unwrap_or(line);
        if !lines.iter().any(|existing| existing == line) {
            lines.push(line.to_string());
        }

        if lines.len() >= 4 {
            break;
        }
    }

    if lines.is_empty() {
        message.trim().to_string()
    } else {
        lines.join(": ")
    }
}

fn broken_sidecar(message: &str) -> AppError {
    AppError::ConnectionFailed {
        driver: "jdbc".to_string(),
        message: message.to_string(),
    }
}

fn required<'a>(value: Option<&'a str>, name: &str) -> Result<&'a str, AppError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::ConfigError(format!("{name} is required")))
}

fn parse_jdbc_max_heap_mb(value: Option<&str>) -> u16 {
    value
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(256)
        .clamp(64, 1024)
}

fn normalize_jdbc_sql(sql: &str) -> String {
    sql.trim().trim_end_matches(';').trim_end().to_string()
}

fn unsupported(operation: &str) -> AppError {
    AppError::UnsupportedOperation {
        driver: "jdbc".to_string(),
        operation: operation.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clarify_metadata_error, clarify_oracle_explain_error, classify_jdbc_error,
        db_object_kind_from_value, db_object_kind_value, map_column_row, map_index_row,
        map_schema_object_row, normalize_jdbc_error_message, normalize_jdbc_sql,
        parse_jdbc_max_heap_mb, parse_metadata_sql, parse_sidecar_response,
        validate_jdbc_query_output_with_limit, validate_jdbc_stream_chunk, JdbcBridgeCommand,
        JdbcQueryOutput,
    };
    use super::{JdbcBridgeSidecar, JdbcBridgeStartSpec};
    use crate::models::{
        error::AppError,
        metadata::DbObjectKind,
        query_result::{ColumnMeta, QueryResult},
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tokio::{sync::Mutex, time::Duration};
    use zeroize::Zeroizing;

    async fn fake_sidecar(mode: &str) -> JdbcBridgeSidecar {
        static FIXTURE: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
        let executable = FIXTURE.get_or_init(|| {
            let root = std::env::temp_dir()
                .join(format!("vaporlens-jdbc-fixture-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let executable = root.join(format!("jdbc-sidecar{}", std::env::consts::EXE_SUFFIX));
            let compiled = std::process::Command::new("rustc")
                .arg(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("tests/fixtures/jdbc_sidecar.rs"),
                )
                .arg("-o")
                .arg(&executable)
                .status()
                .unwrap();
            assert!(compiled.success());
            executable
        });
        let sidecar = JdbcBridgeSidecar {
            start_spec: JdbcBridgeStartSpec {
                program: executable.to_string_lossy().into_owned(),
                arguments: vec![mode.into()],
                init_request: Zeroizing::new("INIT\t0\tfixture\n".into()),
            },
            closed: AtomicBool::new(false),
            session_lost: AtomicBool::new(false),
            process: Mutex::new(None),
            active_stream: Mutex::new(None),
            request_lock: Mutex::new(()),
        };
        sidecar.process().await.unwrap();
        sidecar
    }

    #[tokio::test]
    async fn ordinary_timeout_retires_the_process_before_the_next_request() {
        let sidecar = fake_sidecar("late").await;
        let process = sidecar.process().await.unwrap();
        let error = sidecar
            .request_with_timeout(JdbcBridgeCommand::Ping, Duration::from_millis(30))
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Timeout { .. }));
        assert!(sidecar.process.lock().await.is_none());
        assert!(process.child.lock().await.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn a_lost_session_requires_rollback_before_commit_even_after_restart() {
        let mut sidecar = fake_sidecar("late").await;
        sidecar
            .request_with_timeout(JdbcBridgeCommand::Ping, Duration::from_millis(30))
            .await
            .unwrap_err();
        let error = sidecar
            .request(JdbcBridgeCommand::Transaction("COMMIT"))
            .await
            .unwrap_err();
        assert!(error.affects_transaction());
        assert!(sidecar.process.lock().await.is_none());
        sidecar.start_spec.arguments = vec!["normal".into()];
        sidecar.request(JdbcBridgeCommand::Ping).await.unwrap();
        assert!(sidecar
            .request(JdbcBridgeCommand::Transaction("COMMIT"))
            .await
            .is_err());
        sidecar
            .request(JdbcBridgeCommand::Transaction("ROLLBACK"))
            .await
            .unwrap();
        sidecar
            .request(JdbcBridgeCommand::Transaction("BEGIN"))
            .await
            .unwrap();
        sidecar
            .request(JdbcBridgeCommand::Transaction("COMMIT"))
            .await
            .unwrap();
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn normal_requests_use_matching_ids_and_shutdown_reaps_the_child() {
        let sidecar = fake_sidecar("normal").await;
        let process = sidecar.process().await.unwrap();
        for request_id in [1, 2] {
            let response = sidecar.request(JdbcBridgeCommand::Ping).await.unwrap();
            let value: serde_json::Value = serde_json::from_str(&response).unwrap();
            assert_eq!(value["requestId"], request_id);
        }
        sidecar.shutdown().await.unwrap();
        assert!(process.child.lock().await.try_wait().unwrap().is_some());
        assert!(sidecar.process.lock().await.is_none());
        assert!(sidecar.request(JdbcBridgeCommand::Ping).await.is_err());
    }

    #[tokio::test]
    async fn a_late_old_response_cannot_contaminate_a_fresh_process() {
        let mut sidecar = fake_sidecar("late").await;
        let old = sidecar.process().await.unwrap();
        assert!(sidecar
            .request_with_timeout(JdbcBridgeCommand::Ping, Duration::from_millis(30))
            .await
            .is_err());
        sidecar.start_spec.arguments = vec!["normal".into()];
        let response = sidecar.request(JdbcBridgeCommand::Ping).await.unwrap();
        let current = sidecar.process().await.unwrap();
        assert!(!Arc::ptr_eq(&old, &current));
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["requestId"], 1);
        assert_eq!(value["pid"], current.child.lock().await.id().unwrap());
        assert!(old.child.lock().await.try_wait().unwrap().is_some());
        assert!(sidecar
            .request(JdbcBridgeCommand::Transaction("COMMIT"))
            .await
            .is_err());
        sidecar
            .request(JdbcBridgeCommand::Transaction("ROLLBACK"))
            .await
            .unwrap();
        assert!(!sidecar
            .session_lost
            .load(std::sync::atomic::Ordering::Acquire));
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn corrupted_protocol_is_retired_and_the_next_request_can_restart() {
        for mode in ["mismatch", "malformed", "eof"] {
            let mut sidecar = fake_sidecar(mode).await;
            let process = sidecar.process().await.unwrap();
            assert!(sidecar.request(JdbcBridgeCommand::Ping).await.is_err());
            assert!(sidecar.process.lock().await.is_none());
            assert!(process.child.lock().await.try_wait().unwrap().is_some());
            sidecar.start_spec.arguments = vec!["normal".into()];
            assert!(sidecar.request(JdbcBridgeCommand::Ping).await.is_ok());
            sidecar.shutdown().await.unwrap();
        }
    }

    #[tokio::test]
    async fn write_timeout_also_retires_and_reaps_the_process() {
        let sidecar = fake_sidecar("write-stall").await;
        let process = sidecar.process().await.unwrap();
        let error = sidecar
            .request_with_timeout(
                JdbcBridgeCommand::Query("x".repeat(8 * 1024 * 1024)),
                Duration::from_millis(30),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Timeout { .. }));
        assert!(sidecar.process.lock().await.is_none());
        assert!(process.child.lock().await.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn stream_timeout_retires_the_process_and_clears_active_protocol_state() {
        let sidecar = fake_sidecar("stream-stall").await;
        let process = sidecar.process().await.unwrap();
        let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
        let error = sidecar
            .request_stream_with_timeout(
                "SELECT 1",
                "stream",
                1,
                Some(10),
                sender,
                Duration::from_millis(30),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Timeout { .. }));
        assert!(receiver.recv().await.unwrap().is_ok());
        assert!(sidecar.process.lock().await.is_none());
        assert!(sidecar.active_stream.lock().await.is_none());
        assert!(process.child.lock().await.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn result_limits_drain_to_the_terminal_frame_without_retiring_a_healthy_session() {
        let sidecar = fake_sidecar("stream-limit").await;
        let process = sidecar.process().await.unwrap();
        let (sender, _receiver) = tokio::sync::mpsc::channel(8);
        let error = sidecar
            .request_stream_with_timeout(
                "SELECT value",
                "limited",
                1,
                Some(10),
                sender,
                Duration::from_secs(2),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code(), "RESULT_LIMIT_EXCEEDED");
        assert!(!error.affects_transaction());
        assert!(Arc::ptr_eq(&process, &sidecar.process().await.unwrap()));
        assert!(sidecar.request(JdbcBridgeCommand::Ping).await.is_ok());
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn auto_consumer_stop_retires_and_reaps_sidecar_then_restarts_at_a_fresh_boundary() {
        use crate::drivers::trait_def::{
            DriverStreamRequest, StreamControl, StreamStopReason, StreamTransactionMode,
        };
        let mut sidecar = fake_sidecar("stream-stall").await;
        let old = sidecar.process().await.unwrap();
        let control = StreamControl::new(StreamTransactionMode::Auto);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let producer = sidecar.request_stream_controlled(
            DriverStreamRequest {
                sql: "SELECT 1",
                query_id: "auto-stop",
                chunk_size: 1,
                max_rows: Some(10),
            },
            sender,
            Duration::from_secs(2),
            control.clone(),
        );
        let consumer = async {
            assert_eq!(receiver.recv().await.unwrap().unwrap().rows.len(), 1);
            control.stop(StreamStopReason::ResultBytes);
            while receiver.recv().await.is_some() {}
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(producer, consumer)
        })
        .await
        .expect("stop must release I/O locks before aborting the process");
        assert!(result.unwrap().truncated);
        assert!(old.child.lock().await.try_wait().unwrap().is_some());
        assert!(sidecar.process.lock().await.is_none());
        assert!(sidecar.active_stream.lock().await.is_none());
        sidecar.start_spec.arguments = vec!["normal".into()];
        let response: serde_json::Value =
            serde_json::from_str(&sidecar.request(JdbcBridgeCommand::Ping).await.unwrap()).unwrap();
        let fresh = sidecar.process().await.unwrap();
        assert!(!Arc::ptr_eq(&old, &fresh));
        assert_eq!(response["requestId"], 1);
        assert_eq!(response["pid"], fresh.child.lock().await.id().unwrap());
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn manual_consumer_stop_drains_the_complete_frame_boundary_without_losing_session() {
        use crate::drivers::trait_def::{
            DriverStreamRequest, StreamControl, StreamStopReason, StreamTransactionMode,
        };
        let sidecar = fake_sidecar("stream-many").await;
        let old = sidecar.process().await.unwrap();
        let control = StreamControl::new(StreamTransactionMode::Manual);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let producer = sidecar.request_stream_controlled(
            DriverStreamRequest {
                sql: "SELECT 1",
                query_id: "manual-stop",
                chunk_size: 1,
                max_rows: Some(200),
            },
            sender,
            Duration::from_secs(2),
            control.clone(),
        );
        let consumer = async {
            receiver.recv().await.unwrap().unwrap();
            control.stop(StreamStopReason::ResultBytes);
            while receiver.recv().await.is_some() {}
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(producer, consumer)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap().row_count, 100);
        assert!(Arc::ptr_eq(&old, &sidecar.process().await.unwrap()));
        assert!(!sidecar
            .session_lost
            .load(std::sync::atomic::Ordering::Acquire));
        let response: serde_json::Value = serde_json::from_str(
            &sidecar
                .request(JdbcBridgeCommand::Transaction("COMMIT"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(response["requestId"], 2);
        assert!(Arc::ptr_eq(&old, &sidecar.process().await.unwrap()));
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn auto_write_result_limit_does_not_interrupt_or_retire_an_in_flight_write() {
        use crate::drivers::trait_def::{
            DriverStreamRequest, StreamControl, StreamStopReason, StreamTransactionMode,
        };
        let sidecar = fake_sidecar("stream-many").await;
        let old = sidecar.process().await.unwrap();
        let control = StreamControl::new(StreamTransactionMode::Auto);
        control.stop(StreamStopReason::ResultBytes);
        let (sender, _receiver) = tokio::sync::mpsc::channel(1);
        let done = sidecar
            .request_stream_controlled(
                DriverStreamRequest {
                    sql: "INSERT INTO items VALUES(1) RETURNING id",
                    query_id: "write-limit",
                    chunk_size: 1,
                    max_rows: Some(200),
                },
                sender,
                Duration::from_secs(2),
                control,
            )
            .await
            .unwrap();
        assert_eq!(done.row_count, 100);
        assert!(Arc::ptr_eq(&old, &sidecar.process().await.unwrap()));
        let response: serde_json::Value =
            serde_json::from_str(&sidecar.request(JdbcBridgeCommand::Ping).await.unwrap()).unwrap();
        assert_eq!(response["requestId"], 2);
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn bridge_limit_codes_do_not_echo_payloads_or_become_database_errors() {
        let sidecar = fake_sidecar("limit").await;
        let error = sidecar
            .request(JdbcBridgeCommand::Query("SELECT fixture".into()))
            .await
            .unwrap_err();
        let classified = classify_jdbc_error("query", Some("SELECT fixture"), error);
        assert_eq!(classified.code(), "RESULT_LIMIT_EXCEEDED");
        assert!(!classified.affects_transaction());
        assert!(!classified.to_string().contains("dummy SQL"));
        sidecar.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn a_flush_timeout_uses_the_same_poison_retirement_path() {
        struct StalledFlush;
        impl tokio::io::AsyncWrite for StalledFlush {
            fn poll_write(
                self: std::pin::Pin<&mut Self>,
                _context: &mut std::task::Context<'_>,
                bytes: &[u8],
            ) -> std::task::Poll<std::io::Result<usize>> {
                std::task::Poll::Ready(Ok(bytes.len()))
            }
            fn poll_flush(
                self: std::pin::Pin<&mut Self>,
                _context: &mut std::task::Context<'_>,
            ) -> std::task::Poll<std::io::Result<()>> {
                std::task::Poll::Pending
            }
            fn poll_shutdown(
                self: std::pin::Pin<&mut Self>,
                _context: &mut std::task::Context<'_>,
            ) -> std::task::Poll<std::io::Result<()>> {
                std::task::Poll::Ready(Ok(()))
            }
        }
        let sidecar = fake_sidecar("normal").await;
        let process = sidecar.process().await.unwrap();
        let error = super::write_protocol_request(
            &mut StalledFlush,
            "PING\t1\t-\n",
            Duration::from_millis(30),
            "ping",
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AppError::Timeout { .. }));
        assert!(sidecar
            .finish_request::<()>(&process, Err(super::JdbcRequestFailure::Poisoned(error)))
            .await
            .is_err());
        assert!(sidecar.process.lock().await.is_none());
        assert!(process.child.lock().await.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn dropping_a_sidecar_reaps_its_child() {
        let sidecar = fake_sidecar("normal").await;
        let process = sidecar.process().await.unwrap();
        drop(sidecar);
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if process.child.lock().await.try_wait().unwrap().is_some() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn restart_credentials_remain_runtime_only_and_are_not_echoed_in_errors() {
        let mut sidecar = fake_sidecar("late").await;
        sidecar.start_spec.init_request = Zeroizing::new(
            JdbcBridgeCommand::Init {
                driver_class: "fixture.Driver".into(),
                connection_url: "jdbc:fixture://host/db".into(),
                username: "fixture-user".into(),
                password: "runtimeDummyPassword".into(),
            }
            .encode(0),
        );
        let error = sidecar
            .request_with_timeout(JdbcBridgeCommand::Ping, Duration::from_millis(30))
            .await
            .unwrap_err();
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(!serialized.contains("runtimeDummyPassword"));
        assert!(!serialized.contains("fixture-user"));
        sidecar.start_spec.arguments = vec!["normal".into()];
        assert!(sidecar.request(JdbcBridgeCommand::Ping).await.is_ok());
        sidecar.shutdown().await.unwrap();
    }

    #[test]
    fn removes_trailing_statement_semicolon_for_jdbc() {
        assert_eq!(
            normalize_jdbc_sql("SELECT 1 FROM dual;"),
            "SELECT 1 FROM dual"
        );
        assert_eq!(
            normalize_jdbc_sql("SELECT 1 FROM dual;\n"),
            "SELECT 1 FROM dual"
        );
    }

    #[test]
    fn keeps_inner_semicolon_text() {
        assert_eq!(
            normalize_jdbc_sql("SELECT ';' AS value FROM dual;"),
            "SELECT ';' AS value FROM dual"
        );
    }

    #[test]
    fn bounds_jdbc_heap_configuration() {
        assert_eq!(parse_jdbc_max_heap_mb(None), 256);
        assert_eq!(parse_jdbc_max_heap_mb(Some("invalid")), 256);
        assert_eq!(parse_jdbc_max_heap_mb(Some("32")), 64);
        assert_eq!(parse_jdbc_max_heap_mb(Some("512")), 512);
        assert_eq!(parse_jdbc_max_heap_mb(Some("2048")), 1024);
    }

    #[test]
    fn parses_extended_metadata_sql_templates() {
        let dialect = parse_metadata_sql(
            r#"{
                "databases": "SELECT name FROM dual",
                "schemaObjects": "SELECT object_name AS name FROM all_objects",
                "objectDdl": "SELECT ddl FROM dual"
            }"#,
        )
        .expect("parse metadata SQL");

        assert!(dialect.databases.is_some());
        assert!(dialect.schema_objects.is_some());
        assert!(dialect.object_ddl.is_some());
    }

    #[test]
    fn maps_oracle_object_kind_values() {
        assert_eq!(
            db_object_kind_from_value("MATERIALIZED VIEW"),
            DbObjectKind::MaterializedView
        );
        assert_eq!(db_object_kind_value(&DbObjectKind::Package), "package");
        assert_eq!(db_object_kind_value(&DbObjectKind::Synonym), "synonym");
    }

    #[test]
    fn maps_oracle_metadata_rows_with_non_reserved_aliases() {
        let columns = query_result(
            &[
                "schema_name",
                "table_name",
                "name",
                "ordinal_position",
                "data_type",
                "nullable",
                "default_value",
                "character_maximum_length",
                "numeric_precision",
                "numeric_scale",
                "is_primary_key",
            ],
            vec![vec![
                serde_json::json!("APP"),
                serde_json::json!("CUSTOMERS"),
                serde_json::json!("ID"),
                serde_json::json!(1),
                serde_json::json!("NUMBER"),
                serde_json::json!(0),
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::json!(19),
                serde_json::json!(0),
                serde_json::json!(1),
            ]],
        );
        let column = map_column_row(&columns, &columns.rows[0], "fallback", "fallback", 0)
            .expect("column row");
        assert_eq!(column.schema.as_deref(), Some("APP"));
        assert_eq!(column.table, "CUSTOMERS");
        assert_eq!(column.name, "ID");
        assert_eq!(column.ordinal_position, 1);
        assert_eq!(column.data_type, "NUMBER");
        assert!(!column.nullable);
        assert_eq!(column.numeric_precision, Some(19));
        assert!(column.is_primary_key);

        let indexes = query_result(
            &[
                "schema_name",
                "table_name",
                "name",
                "column_names",
                "is_unique",
                "definition",
            ],
            vec![vec![
                serde_json::json!("APP"),
                serde_json::json!("CUSTOMERS"),
                serde_json::json!("CUSTOMERS_PK"),
                serde_json::json!("ID, ACCOUNT_ID"),
                serde_json::json!(1),
                serde_json::json!("NORMAL"),
            ]],
        );
        let index =
            map_index_row(&indexes, &indexes.rows[0], "fallback", "fallback").expect("index row");
        assert_eq!(index.schema.as_deref(), Some("APP"));
        assert_eq!(index.table, "CUSTOMERS");
        assert_eq!(index.name, "CUSTOMERS_PK");
        assert_eq!(index.columns, vec!["ID", "ACCOUNT_ID"]);
        assert!(index.unique);
        assert_eq!(index.definition.as_deref(), Some("NORMAL"));

        let objects = query_result(
            &["schema_name", "name", "kind", "object_type", "status"],
            vec![vec![
                serde_json::json!("APP"),
                serde_json::json!("PKG_BILLING"),
                serde_json::json!("package"),
                serde_json::json!("PACKAGE"),
                serde_json::json!("VALID"),
            ]],
        );
        let object = map_schema_object_row(
            &objects,
            &objects.rows[0],
            "fallback",
            DbObjectKind::Package,
        )
        .expect("schema object row");
        assert_eq!(object.schema.as_deref(), Some("APP"));
        assert_eq!(object.name, "PKG_BILLING");
        assert_eq!(object.kind, DbObjectKind::Package);
        assert_eq!(object.object_type.as_deref(), Some("PACKAGE"));
        assert_eq!(object.status.as_deref(), Some("VALID"));
    }

    #[test]
    fn maps_jdbc_generated_and_auto_increment_flags_without_default_text_parsing() {
        let columns = query_result(
            &[
                "schema_name",
                "table_name",
                "name",
                "ordinal_position",
                "data_type",
                "nullable",
                "default_value",
                "is_primary_key",
                "is_generated",
                "is_auto_increment",
            ],
            vec![vec![
                serde_json::json!("public"),
                serde_json::json!("items"),
                serde_json::json!("id"),
                serde_json::json!(1),
                serde_json::json!("INTEGER"),
                serde_json::json!(0),
                serde_json::json!("generated by trigger"),
                serde_json::json!(1),
                serde_json::json!(0),
                serde_json::json!(1),
            ]],
        );

        let column = map_column_row(&columns, &columns.rows[0], "fallback", "fallback", 0)
            .expect("column row");
        assert!(!column.is_identity);
        assert!(!column.is_generated);
        assert!(column.is_auto_increment);
    }

    #[test]
    fn clarifies_oracle_metadata_permission_errors() {
        let error = clarify_metadata_error(
            "get_object_ddl",
            AppError::QueryFailed {
                sql: "SELECT DBMS_METADATA.GET_DDL(...) FROM dual".to_string(),
                message: "ORA-01031: insufficient privileges".to_string(),
            },
        );

        let AppError::QueryFailed { message, .. } = error else {
            panic!("expected query failed");
        };
        assert!(message.contains("get_object_ddl"));
        assert!(message.contains("insufficient privileges for Oracle metadata"));
        assert!(message.contains("DBMS_METADATA"));
    }

    #[test]
    fn clarifies_oracle_explain_permission_errors() {
        let error = clarify_oracle_explain_error(AppError::QueryFailed {
            sql: "EXPLAIN PLAN FOR SELECT 1 FROM dual".to_string(),
            message: "ORA-01031: insufficient privileges".to_string(),
        });

        let AppError::QueryFailed { message, .. } = error else {
            panic!("expected query failed");
        };
        assert!(message.contains("PLAN_TABLE"));
        assert!(message.contains("DBMS_XPLAN.DISPLAY"));
    }

    #[test]
    fn reports_jdbc_query_result_errors_as_query_failures() {
        let error = classify_jdbc_error(
            "query",
            Some("SELECT blob_value FROM demo"),
            AppError::ConnectionFailed {
                driver: "jdbc".to_string(),
                message: "getString/getNString not implemented for BLOB".to_string(),
            },
        );

        let AppError::QueryFailed { sql, message } = error else {
            panic!("expected query failed");
        };
        assert_eq!(sql, "SELECT blob_value FROM demo");
        assert!(message.contains("BLOB"));
    }

    #[test]
    fn parses_sidecar_ok_response() {
        let response = format!("OK\t7\t{}\n", BASE64.encode("{\"ok\":true}"));
        let payload = parse_sidecar_response(&response, 7).expect("parse sidecar response");

        assert_eq!(payload, "{\"ok\":true}");
    }

    #[test]
    fn initializes_the_bridge_over_stdin() {
        let request = JdbcBridgeCommand::Init {
            driver_class: "oracle.jdbc.OracleDriver".to_string(),
            connection_url: "jdbc:oracle:thin:@//db.example:1521/ORCL".to_string(),
            username: "scott".to_string(),
            password: "tiger".to_string(),
        }
        .encode(0);

        let fields: Vec<_> = request.trim_end().split('\t').collect();
        assert_eq!(fields[0], "INIT");
        assert_eq!(fields[1], "0");
        assert_eq!(
            BASE64.decode(fields[2]).unwrap(),
            b"oracle.jdbc.OracleDriver"
        );
        assert_eq!(
            BASE64.decode(fields[3]).unwrap(),
            b"jdbc:oracle:thin:@//db.example:1521/ORCL"
        );
        assert_eq!(BASE64.decode(fields[4]).unwrap(), b"scott");
        assert_eq!(BASE64.decode(fields[5]).unwrap(), b"tiger");
    }

    #[test]
    fn stream_request_carries_shared_byte_budgets() {
        let request = JdbcBridgeCommand::QueryStream {
            sql: "SELECT value FROM sample".to_string(),
            chunk_size: 2_000,
            max_rows: Some(50_000),
        }
        .encode(9);
        let fields: Vec<_> = request.trim_end().split('\t').collect();
        let payload = BASE64.decode(fields[2]).unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(payload["maxCellBytes"], 1024 * 1024);
        assert_eq!(payload["maxChunkBytes"], 4 * 1024 * 1024);
        assert_eq!(payload["maxResultBytes"], 64 * 1024 * 1024);
    }

    #[test]
    fn rejects_jdbc_chunks_that_bypass_bridge_budgets() {
        let oversized_cell = vec![vec![serde_json::json!("x".repeat(1024 * 1024))]];
        assert!(validate_jdbc_stream_chunk(&oversized_cell).is_err());

        let cell = "x".repeat(1024 * 1024 - 2);
        let oversized_chunk = vec![
            vec![serde_json::json!(&cell)],
            vec![serde_json::json!(&cell)],
            vec![serde_json::json!(&cell)],
            vec![serde_json::json!(&cell)],
        ];
        assert!(validate_jdbc_stream_chunk(&oversized_chunk).is_err());
    }

    #[test]
    fn rejects_non_streaming_jdbc_results_that_bypass_bridge_budgets() {
        let output = JdbcQueryOutput {
            columns: Vec::new(),
            rows: vec![
                vec![serde_json::json!("123")],
                vec![serde_json::json!("456")],
            ],
            row_count: 2,
            affected_rows: 0,
            elapsed_ms: 0,
        };
        assert!(validate_jdbc_query_output_with_limit(&output, 17).is_ok());
        assert!(validate_jdbc_query_output_with_limit(&output, 16).is_err());
    }

    #[test]
    fn normalizes_jdbc_auth_error_message() {
        let message =
            normalize_jdbc_error_message("ORA-01017: invalid username/password; logon denied");
        assert!(message.contains("authentication failed"));
        assert!(message.contains("ORA-01017"));
    }

    #[test]
    fn normalizes_jdbc_runtime_configuration_errors() {
        let missing_class =
            normalize_jdbc_error_message("java.lang.ClassNotFoundException: org.example.Driver");
        assert!(missing_class.contains("missing from the classpath"));

        let invalid_url = normalize_jdbc_error_message("Invalid URL format");
        assert!(invalid_url.contains("JDBC URL is invalid"));

        let no_driver = normalize_jdbc_error_message("No suitable driver found for jdbc:unknown:x");
        assert!(no_driver.contains("JDBC driver class or JAR is not usable"));
    }

    #[test]
    fn redacts_jdbc_bridge_exception_credentials_without_losing_context() {
        let message = normalize_jdbc_error_message(
            "java.sql.SQLException: connection failed jdbc:mysql://test-user:super-secret-test-value@example.invalid/db?password=super-secret-test-value; SQLState 08001",
        );

        assert!(!message.contains("super-secret-test-value"));
        assert!(message.contains("java.sql.SQLException"));
        assert!(message.contains("example.invalid"));
        assert!(message.contains("SQLState 08001"));
    }

    #[test]
    fn compacts_jdbc_stack_trace_errors() {
        let message = normalize_jdbc_error_message(
            r#"
            java.sql.SQLRecoverableException: ORA-17820: 网络适配器无法建立连接
                at oracle.jdbc.driver.T4CConnection.logon(T4CConnection.java:879)
            Caused by: oracle.net.ns.NetException: ORA-17820: 网络适配器无法建立连接
                at oracle.net.nt.ConnStrategy.execute(ConnStrategy.java:739)
            Caused by: java.net.SocketException: Operation not permitted
                at java.base/sun.nio.ch.Net.connect0(Native Method)
            "#,
        );

        assert!(message.contains("database host is unreachable"));
        assert!(message.contains("ORA-17820"));
        assert!(message.contains("Operation not permitted"));
        assert!(!message.contains("T4CConnection.java"));
        assert!(!message.contains("ConnStrategy.java"));
    }

    fn query_result(names: &[&str], rows: Vec<Vec<serde_json::Value>>) -> QueryResult {
        QueryResult {
            columns: names
                .iter()
                .map(|name| ColumnMeta {
                    name: (*name).to_string(),
                    data_type: "VARCHAR2".to_string(),
                    nullable: true,
                })
                .collect(),
            row_count: rows.len() as u64,
            rows,
            elapsed_ms: 0,
            affected_rows: 0,
            query_id: None,
            truncated: false,
            max_rows: None,
        }
    }
}
