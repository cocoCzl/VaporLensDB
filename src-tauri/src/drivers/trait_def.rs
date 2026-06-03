use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::models::{
    error::AppError,
    metadata::{
        ColumnInfo, DatabaseInfo, DriverCapabilities, ForeignKeyInfo, IndexInfo, SchemaInfo,
        TableInfo,
    },
    query_result::{ExplainResult, QueryResult, QueryResultChunk, QueryStreamSummary},
};

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn driver_name(&self) -> &'static str;
    fn capabilities(&self) -> DriverCapabilities;
    async fn ping(&self) -> Result<(), AppError>;
    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError>;
    async fn execute_query_stream(
        &self,
        sql: &str,
        query_id: &str,
        chunk_size: usize,
        max_rows: Option<u64>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
    ) -> Result<QueryStreamSummary, AppError>;
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
    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError>;
    async fn cancel_query(&self, query_id: &str) -> Result<(), AppError>;
    async fn cancel_all_queries(&self) -> Result<(), AppError> {
        Ok(())
    }
}
