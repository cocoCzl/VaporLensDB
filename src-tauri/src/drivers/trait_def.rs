use async_trait::async_trait;
use crate::models::{error::AppError, query_result::QueryResult};

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    async fn ping(&self) -> Result<(), AppError>;
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>;
    async fn get_databases(&self) -> Result<Vec<String>, AppError>;
    async fn get_schemas(&self, database: &str) -> Result<Vec<String>, AppError>;
    async fn get_tables(&self, schema: &str) -> Result<Vec<String>, AppError>;
    async fn get_columns(&self, schema: &str, table: &str) -> Result<QueryResult, AppError>;
    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError>;
    async fn cancel_query(&self, query_id: &str) -> Result<(), AppError>;
}