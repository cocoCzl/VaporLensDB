use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    sync::{mpsc, Mutex},
    time::{timeout, Duration},
};
use uuid::Uuid;

use crate::{
    drivers::trait_def::DatabaseDriver,
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
};

pub struct JdbcDriver {
    driver_type: DriverType,
    metadata_sql: Option<JdbcMetadataSql>,
    sidecar: Arc<JdbcBridgeSidecar>,
}

struct JdbcBridgeSidecar {
    process: Mutex<Option<Arc<JdbcBridgeProcess>>>,
    active_stream: Mutex<Option<ActiveJdbcStream>>,
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

        let mut child = Command::new("java")
            .arg("-cp")
            .arg(classpath)
            .arg("com.vaporlensdb.jdbcbridge.JdbcBridge")
            .arg("server")
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

        let sidecar = Self {
            process: Mutex::new(Some(Arc::new(JdbcBridgeProcess {
                child: Mutex::new(child),
                stdin: Mutex::new(stdin),
                stdout: Mutex::new(BufReader::new(stdout)),
                stderr: Mutex::new(BufReader::new(stderr)),
                next_request_id: AtomicU64::new(0),
            }))),
            active_stream: Mutex::new(None),
        };

        sidecar
            .request(JdbcBridgeCommand::Init {
                driver_class: driver_class.to_string(),
                connection_url: connection_url.to_string(),
                username: username.to_string(),
                password: password.to_string(),
            })
            .await?;
        Ok(sidecar)
    }

    async fn request(&self, command: JdbcBridgeCommand) -> Result<String, AppError> {
        let process = self.process().await?;
        let request_id = process.next_request_id.fetch_add(1, Ordering::Relaxed);
        let timeout_window = command.timeout();
        let request = command.encode(request_id);

        self.write_request(&process, &request, timeout_window, command.operation_name())
            .await?;

        let mut response = String::new();
        let mut stdout = process.stdout.lock().await;
        let bytes_read = timeout(timeout_window, stdout.read_line(&mut response))
            .await
            .map_err(|_| AppError::Timeout {
                operation: format!("jdbc {}", command.operation_name()),
                elapsed_ms: timeout_window.as_millis() as u64,
            })?
            .map_err(|error| {
                broken_sidecar(&format!("failed to read JDBC bridge response: {error}"))
            })?;

        if bytes_read == 0 {
            let error = process.take_exit_error().await;
            self.clear_process(&process).await;
            return Err(error);
        }

        parse_sidecar_response(&response, request_id)
    }

    async fn request_stream(
        &self,
        sql: &str,
        query_id: &str,
        chunk_size: usize,
        max_rows: Option<u64>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
    ) -> Result<JdbcStreamDoneOutput, AppError> {
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
            });
        }
        let result = self
            .request_stream_frames(&process, &request, request_id, query_id, chunks)
            .await;
        let mut active = self.active_stream.lock().await;
        if active
            .as_ref()
            .is_some_and(|stream| stream.request_id == request_id)
        {
            *active = None;
        }
        result
    }

    async fn request_stream_frames(
        &self,
        process: &JdbcBridgeProcess,
        request: &str,
        request_id: u64,
        query_id: &str,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
    ) -> Result<JdbcStreamDoneOutput, AppError> {
        self.write_request(
            process,
            request,
            Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
            "query stream",
        )
        .await?;
        let mut row_offset = 0_u64;
        let mut stdout = process.stdout.lock().await;
        loop {
            let mut response = String::new();
            if stdout.read_line(&mut response).await.map_err(|error| {
                broken_sidecar(&format!("failed to read JDBC stream response: {error}"))
            })? == 0
            {
                return Err(process.take_exit_error().await);
            }
            let (status, payload) = parse_sidecar_frame(&response, request_id)?;
            match status.as_str() {
                "CHUNK" => {
                    let output: JdbcStreamChunkOutput = serde_json::from_str(&payload)?;
                    let count = output.rows.len() as u64;
                    chunks
                        .send(Ok(QueryResultChunk {
                            query_id: query_id.to_string(),
                            columns: output.columns,
                            rows: output.rows,
                            row_offset,
                        }))
                        .await
                        .map_err(|_| {
                            AppError::ConfigError("query stream receiver dropped".to_string())
                        })?;
                    row_offset += count;
                }
                "OK" => return serde_json::from_str(&payload).map_err(AppError::from),
                "ERR" => return Err(broken_sidecar(&normalize_jdbc_error_message(&payload))),
                _ => return Err(broken_sidecar("malformed JDBC stream response status")),
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
        let process = self.process().await?;
        self.write_request(
            &process,
            &format!("CANCEL\t0\t{}\n", active.request_id),
            Duration::from_secs(2),
            "cancel query",
        )
        .await
    }

    async fn process(&self) -> Result<Arc<JdbcBridgeProcess>, AppError> {
        self.process
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| broken_sidecar("JDBC bridge sidecar is not running"))
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

    async fn write_request(
        &self,
        process: &JdbcBridgeProcess,
        request: &str,
        timeout_window: Duration,
        operation: &str,
    ) -> Result<(), AppError> {
        let mut stdin = process.stdin.lock().await;
        timeout(timeout_window, stdin.write_all(request.as_bytes()))
            .await
            .map_err(|_| AppError::Timeout {
                operation: format!("jdbc {operation}"),
                elapsed_ms: timeout_window.as_millis() as u64,
            })?
            .map_err(|error| {
                broken_sidecar(&format!("failed to write JDBC bridge request: {error}"))
            })?;
        timeout(timeout_window, stdin.flush())
            .await
            .map_err(|_| AppError::Timeout {
                operation: format!("jdbc {operation}"),
                elapsed_ms: timeout_window.as_millis() as u64,
            })?
            .map_err(|error| {
                broken_sidecar(&format!("failed to flush JDBC bridge request: {error}"))
            })
    }

    async fn shutdown(&self) -> Result<(), AppError> {
        let process = self.process.lock().await.take();
        let Some(process) = process else {
            return Ok(());
        };

        let request = "CLOSE\t0\t-\n".to_string();
        let _ = self
            .write_request(&process, &request, Duration::from_secs(2), "shutdown")
            .await;
        let _ = timeout(Duration::from_secs(2), process.child.lock().await.wait()).await;
        let _ = process.child.lock().await.start_kill();
        Ok(())
    }
}

impl Drop for JdbcBridgeSidecar {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.process.try_lock() {
            if let Some(process) = guard.as_mut() {
                if let Ok(mut child) = process.child.try_lock() {
                    let _ = child.start_kill();
                }
            }
        }
    }
}

impl JdbcBridgeProcess {
    async fn take_exit_error(&self) -> AppError {
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
                });
                format!(
                    "QUERY_STREAM\t{request_id}\t{}\n",
                    BASE64.encode(payload.to_string())
                )
            }
            Self::Metadata(payload) => {
                format!("METADATA\t{request_id}\t{}\n", BASE64.encode(payload))
            }
        }
    }

    fn operation_name(&self) -> &'static str {
        match self {
            Self::Init { .. } => "initialize",
            Self::Ping => "ping",
            Self::Query(_) => "query",
            Self::QueryStream { .. } => "query stream",
            Self::Metadata(_) => "metadata",
        }
    }

    fn timeout(&self) -> Duration {
        match self {
            Self::Init { .. } => Duration::from_secs(JDBC_CONNECT_TIMEOUT_SECS as u64),
            Self::Ping => Duration::from_secs(JDBC_CONNECT_TIMEOUT_SECS as u64),
            Self::Query(_) => Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
            Self::QueryStream { .. } => Duration::from_secs(JDBC_QUERY_TIMEOUT_SECS as u64),
            Self::Metadata(_) => Duration::from_secs(JDBC_METADATA_TIMEOUT_SECS as u64),
        }
    }
}

const JDBC_CONNECT_TIMEOUT_SECS: u32 = 15;
const JDBC_QUERY_TIMEOUT_SECS: u32 = 60;
const JDBC_METADATA_TIMEOUT_SECS: u32 = 30;

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
        let start = Instant::now();
        let done = self
            .sidecar
            .request_stream(sql, query_id, chunk_size.max(1), max_rows, chunks)
            .await?;

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

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        if self.driver_type != DriverType::Oracle {
            return Err(unsupported("explain_query"));
        }

        let request_id = Uuid::new_v4().simple().to_string();
        let statement_id = format!("VL{}", &request_id[..28]);
        let statement_sql = normalize_jdbc_sql(sql);
        let explain_sql =
            format!("EXPLAIN PLAN SET STATEMENT_ID = '{statement_id}' FOR {statement_sql}");
        self.execute_query(&explain_sql, None)
            .await
            .map_err(clarify_oracle_explain_error)?;

        let display_sql = format!(
            "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', '{statement_id}', 'TYPICAL'))"
        );
        let result = self
            .execute_query(&display_sql, None)
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

fn parse_sidecar_response(response: &str, expected_request_id: u64) -> Result<String, AppError> {
    let (status, decoded) = parse_sidecar_frame(response, expected_request_id)?;
    match status.as_str() {
        "OK" => Ok(decoded),
        "ERR" => Err(broken_sidecar(&normalize_jdbc_error_message(&decoded))),
        _ => Err(broken_sidecar(
            "malformed JDBC bridge response: invalid status",
        )),
    }
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
    if lower.contains("io error: connection failed") || lower.contains("connection refused") {
        return normalized;
    }
    if lower.contains("ora-01017")
        || lower.contains("access denied")
        || lower.contains("authentication failed")
        || lower.contains("invalid username/password")
    {
        return format!("authentication failed. {normalized}");
    }
    if lower.contains("no suitable driver") {
        return format!("JDBC driver class or JAR is not usable. {normalized}");
    }
    if lower.contains("classnotfoundexception")
        || lower.contains("class not found")
        || lower.contains("could not find or load main class")
    {
        return format!(
            "JDBC driver class or bridge class is missing from the classpath. {normalized}"
        );
    }
    if lower.contains("jdbc url")
        || lower.contains("invalid url")
        || lower.contains("malformed")
        || lower.contains("invalid connection string")
    {
        return format!("JDBC URL is invalid for this driver. {normalized}");
    }
    if lower.contains("unknown host")
        || lower.contains("ora-17820")
        || lower.contains("network adapter could not establish the connection")
        || lower.contains("the network adapter could not establish the connection")
    {
        return format!("database host is unreachable. {normalized}");
    }
    normalized
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
        parse_metadata_sql, parse_sidecar_response, JdbcBridgeCommand,
    };
    use crate::models::{
        error::AppError,
        metadata::DbObjectKind,
        query_result::{ColumnMeta, QueryResult},
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

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
