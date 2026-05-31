use std::{
    path::{Path, PathBuf},
    time::Instant,
};

use async_trait::async_trait;
use tokio::{process::Command, sync::mpsc};

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        connection::ConnectionConfig,
        error::AppError,
        metadata::{
            ColumnInfo, DatabaseInfo, DriverCapabilities, ForeignKeyInfo, IndexInfo, SchemaInfo,
            TableInfo,
        },
        query_result::{
            ColumnMeta, ExplainFormat, ExplainResult, QueryResult, QueryResultChunk,
            QueryStreamSummary,
        },
    },
    services::external_driver::{resolve_jdbc_bridge_jar, validate_jdbc_prerequisites},
};

pub struct JdbcDriver {
    config: ConnectionConfig,
    password: String,
    bridge_jar: PathBuf,
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

impl JdbcDriver {
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Self, AppError> {
        validate_jdbc_prerequisites(config).await?;
        let bridge_jar = resolve_jdbc_bridge_jar()?;
        let driver = Self {
            config: config.clone(),
            password: password.unwrap_or("").to_string(),
            bridge_jar,
        };
        driver.ping().await?;
        Ok(driver)
    }

    async fn run_bridge(&self, command: &str, sql: Option<&str>) -> Result<String, AppError> {
        let driver_class = required(self.config.driver_class.as_deref(), "JDBC driver class")?;
        let connection_url = required(self.config.connection_url.as_deref(), "JDBC URL")?;
        let username = self.config.username.as_deref().unwrap_or("");
        let classpath = build_classpath(&self.bridge_jar, &self.config.driver_paths);

        let mut process = Command::new("java");
        process
            .arg("-cp")
            .arg(classpath)
            .arg("com.vaporlensdb.jdbcbridge.JdbcBridge")
            .arg(command)
            .arg(driver_class)
            .arg(connection_url)
            .arg(username)
            .arg(&self.password);

        if let Some(sql) = sql {
            process.arg(sql);
        }

        let output = process
            .output()
            .await
            .map_err(|error| AppError::ConnectionFailed {
                driver: self.driver_name().to_string(),
                message: format!("failed to run JDBC bridge: {error}"),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AppError::ConnectionFailed {
                driver: self.driver_name().to_string(),
                message: if stderr.is_empty() {
                    "JDBC bridge failed without stderr".to_string()
                } else {
                    stderr
                },
            });
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

#[async_trait]
impl DatabaseDriver for JdbcDriver {
    fn driver_name(&self) -> &'static str {
        "jdbc"
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            has_database: true,
            has_schema: true,
            supports_transactions: true,
            supports_explain: false,
            supports_cancel: false,
            supports_ddl: false,
            supports_streaming: false,
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
        let output =
            self.run_bridge("query", Some(sql))
                .await
                .map_err(|error| AppError::QueryFailed {
                    sql: sql.to_string(),
                    message: error.to_string(),
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
        let result = self.execute_query(sql, Some(query_id)).await?;
        let limit = max_rows.unwrap_or(result.rows.len() as u64) as usize;
        let truncated = result.rows.len() > limit;
        let rows = result.rows.into_iter().take(limit).collect::<Vec<_>>();
        let chunk_size = chunk_size.max(1);
        let mut row_offset = 0_u64;

        for chunk_rows in rows.chunks(chunk_size) {
            chunks
                .send(Ok(QueryResultChunk {
                    query_id: query_id.to_string(),
                    columns: result.columns.clone(),
                    rows: chunk_rows.to_vec(),
                    row_offset,
                }))
                .await
                .map_err(|_| AppError::ConfigError("query stream receiver dropped".to_string()))?;
            row_offset += chunk_rows.len() as u64;
        }

        Ok(QueryStreamSummary {
            query_id: query_id.to_string(),
            row_count: row_offset,
            affected_rows: result.affected_rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
            max_rows,
        })
    }

    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
        Err(unsupported("get_databases"))
    }

    async fn get_schemas(&self, _database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        Err(unsupported("get_schemas"))
    }

    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableInfo>, AppError> {
        Err(unsupported("get_tables"))
    }

    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        Err(unsupported("get_columns"))
    }

    async fn get_indexes(&self, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>, AppError> {
        Err(unsupported("get_indexes"))
    }

    async fn get_foreign_keys(
        &self,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        Err(unsupported("get_foreign_keys"))
    }

    async fn get_views(&self, _schema: &str) -> Result<Vec<TableInfo>, AppError> {
        Err(unsupported("get_views"))
    }

    async fn get_functions(&self, _schema: &str) -> Result<Vec<String>, AppError> {
        Err(unsupported("get_functions"))
    }

    async fn get_table_ddl(&self, _schema: &str, _table: &str) -> Result<String, AppError> {
        Err(unsupported("get_table_ddl"))
    }

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        Ok(ExplainResult {
            format: ExplainFormat::Json,
            plan: serde_json::to_value(self.execute_query(sql, None).await?)?,
            elapsed_ms: 0,
        })
    }

    async fn cancel_query(&self, _query_id: &str) -> Result<(), AppError> {
        Err(unsupported("cancel_query"))
    }
}

fn build_classpath(bridge_jar: &Path, driver_paths: &[String]) -> String {
    let separator = if cfg!(windows) { ";" } else { ":" };
    std::iter::once(bridge_jar.display().to_string())
        .chain(driver_paths.iter().cloned())
        .collect::<Vec<_>>()
        .join(separator)
}

fn required<'a>(value: Option<&'a str>, name: &str) -> Result<&'a str, AppError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::ConfigError(format!("{name} is required")))
}

fn unsupported(operation: &str) -> AppError {
    AppError::UnsupportedOperation {
        driver: "jdbc".to_string(),
        operation: operation.to_string(),
    }
}
