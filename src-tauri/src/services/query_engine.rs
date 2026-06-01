use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        error::AppError,
        query_result::{ExplainResult, QueryResult, QueryStreamDone, QueryStreamError},
    },
    utils::sql_parser::split_sql_statements,
};

const QUERY_RESULT_CHUNK_EVENT: &str = "query_result_chunk";
const QUERY_RESULT_DONE_EVENT: &str = "query_result_done";
const QUERY_RESULT_ERROR_EVENT: &str = "query_result_error";
const DEFAULT_STREAM_CHUNK_SIZE: usize = 1_000;
const DEFAULT_INTERACTIVE_MAX_ROWS: u64 = 50_000;

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
        if statements.is_empty() {
            return Ok(ExecuteQueryResponse {
                query_id,
                results: Vec::new(),
            });
        }

        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut result = driver
                .execute_query(&statement, query_id.as_deref())
                .await?;
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
        let (chunk_tx, mut chunk_rx) = mpsc::channel(8);
        let query_id = request.query_id.clone();
        let emit_app = app.clone();
        let emit_query_id = query_id.clone();

        let emit_task = tokio::spawn(async move {
            while let Some(chunk) = chunk_rx.recv().await {
                match chunk {
                    Ok(chunk) => {
                        if emit_app.emit(QUERY_RESULT_CHUNK_EVENT, chunk).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = emit_app.emit(
                            QUERY_RESULT_ERROR_EVENT,
                            stream_error_payload(&emit_query_id, error),
                        );
                        break;
                    }
                }
            }
        });

        match driver
            .execute_query_stream(
                &request.sql,
                &query_id,
                request.chunk_size.unwrap_or(DEFAULT_STREAM_CHUNK_SIZE),
                Some(request.max_rows.unwrap_or(DEFAULT_INTERACTIVE_MAX_ROWS)),
                chunk_tx,
            )
            .await
        {
            Ok(summary) => {
                let _ = emit_task.await;
                app.emit(
                    QUERY_RESULT_DONE_EVENT,
                    QueryStreamDone {
                        query_id: summary.query_id,
                        row_count: summary.row_count,
                        affected_rows: summary.affected_rows,
                        elapsed_ms: summary.elapsed_ms,
                        truncated: summary.truncated,
                        max_rows: summary.max_rows,
                    },
                )
                .map_err(|error| error.to_string())
            }
            Err(error) => {
                let _ = emit_task.await;
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

fn stream_error_payload(query_id: &str, error: AppError) -> QueryStreamError {
    QueryStreamError {
        query_id: query_id.to_string(),
        code: error.code().to_string(),
        message: error.to_string(),
        detail: error.detail(),
    }
}
