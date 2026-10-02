use async_trait::async_trait;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::models::{
    error::AppError,
    metadata::{
        ColumnInfo, DatabaseInfo, DbObjectInfo, DbObjectKind, DriverCapabilities, ForeignKeyInfo,
        IndexInfo, SchemaInfo, TableInfo,
    },
    query_result::{ExplainResult, QueryResult, QueryResultChunk, QueryStreamSummary},
};

/// Values supplied separately from SQL text for data-import operations.
/// CSV deliberately exposes only text and NULL; the destination column type
/// remains responsible for database-side conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DbParameter {
    Null,
    Text(String),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StreamTransactionMode {
    Auto,
    Manual,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum StreamStopReason {
    MaxRows = 1,
    ResultBytes,
    CellOrChunkLimit,
    ReceiverUnavailable,
}

#[derive(Clone)]
pub struct StreamControl {
    pub mode: StreamTransactionMode,
    reason: Arc<AtomicU8>,
    stopped: CancellationToken,
}

impl StreamControl {
    pub fn new(mode: StreamTransactionMode) -> Self {
        Self {
            mode,
            reason: Arc::new(AtomicU8::new(0)),
            stopped: CancellationToken::new(),
        }
    }

    pub fn stop(&self, reason: StreamStopReason) {
        if self
            .reason
            .compare_exchange(0, reason as u8, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.stopped.cancel();
        }
    }

    pub fn is_stopped(&self) -> bool {
        self.reason.load(Ordering::Acquire) != 0
    }

    pub fn stop_reason(&self) -> Option<StreamStopReason> {
        match self.reason.load(Ordering::Acquire) {
            1 => Some(StreamStopReason::MaxRows),
            2 => Some(StreamStopReason::ResultBytes),
            3 => Some(StreamStopReason::CellOrChunkLimit),
            4 => Some(StreamStopReason::ReceiverUnavailable),
            _ => None,
        }
    }

    pub fn can_abort_select(&self, sql: &str) -> bool {
        if self.mode != StreamTransactionMode::Auto {
            return false;
        }
        crate::utils::sql_parser::mask_sql(sql)
            .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
            .find(|word| !word.is_empty())
            .is_some_and(|word| word.eq_ignore_ascii_case("select"))
    }

    pub async fn stopped(&self) {
        self.stopped.cancelled().await;
    }
}

pub struct DriverStreamRequest<'request> {
    pub sql: &'request str,
    pub query_id: &'request str,
    pub chunk_size: usize,
    pub max_rows: Option<u64>,
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn driver_name(&self) -> &'static str;
    fn capabilities(&self) -> DriverCapabilities;
    fn supports_parameterized_import(&self) -> bool {
        false
    }
    /// Whether this driver can safely execute more than one query at a time
    /// using the same saved Data Source session.
    fn supports_concurrent_queries(&self) -> bool {
        false
    }
    async fn ping(&self) -> Result<(), AppError>;
    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError>;
    /// Execute a statement with values bound through the driver's native
    /// parameter API. Drivers without this capability must return an explicit
    /// unsupported-operation error rather than interpolating values.
    async fn execute_parameterized(
        &self,
        _sql: &str,
        _params: &[DbParameter],
        _query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        Err(AppError::UnsupportedOperation {
            driver: self.driver_name().to_string(),
            operation: "parameterized import".to_string(),
        })
    }
    async fn execute_query_stream(
        &self,
        sql: &str,
        query_id: &str,
        chunk_size: usize,
        max_rows: Option<u64>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
    ) -> Result<QueryStreamSummary, AppError>;
    async fn execute_query_stream_controlled(
        &self,
        request: DriverStreamRequest<'_>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
        _control: StreamControl,
    ) -> Result<QueryStreamSummary, AppError> {
        self.execute_query_stream(
            request.sql,
            request.query_id,
            request.chunk_size,
            request.max_rows,
            chunks,
        )
        .await
    }
    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError>;
    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError>;
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError>;
    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError>;
    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError>;
    async fn get_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError>;
    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError>;
    async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError>;
    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError>;
    async fn get_schema_objects(
        &self,
        _schema: &str,
        _kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        Err(AppError::UnsupportedOperation {
            driver: self.driver_name().to_string(),
            operation: "get_schema_objects".to_string(),
        })
    }
    async fn get_object_ddl(
        &self,
        schema: &str,
        name: &str,
        kind: DbObjectKind,
    ) -> Result<String, AppError> {
        if matches!(
            kind,
            DbObjectKind::Table | DbObjectKind::View | DbObjectKind::MaterializedView
        ) {
            self.get_table_ddl(schema, name).await
        } else {
            Err(AppError::UnsupportedOperation {
                driver: self.driver_name().to_string(),
                operation: "get_object_ddl".to_string(),
            })
        }
    }
    async fn explain_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<ExplainResult, AppError>;
    async fn cancel_query(&self, query_id: &str) -> Result<(), AppError>;
    /// Transaction control is intentionally expressed by the driver so a Console
    /// can keep one physical session without leaking SQL dialect details to UI.
    async fn begin_transaction(&self) -> Result<(), AppError> {
        self.execute_query("BEGIN", None).await.map(|_| ())
    }
    async fn commit_transaction(&self) -> Result<(), AppError> {
        self.execute_query("COMMIT", None).await.map(|_| ())
    }
    async fn rollback_transaction(&self) -> Result<(), AppError> {
        self.execute_query("ROLLBACK", None).await.map(|_| ())
    }
    async fn cancel_all_queries(&self) -> Result<(), AppError> {
        Ok(())
    }
}
