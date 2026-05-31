use serde::Deserialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    models::query_result::ExplainResult,
    services::query_engine::{ExecuteQueryResponse, StreamQueryRequest},
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryInput {
    pub connection_id: Uuid,
    pub sql: String,
    pub query_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryStreamInput {
    pub connection_id: Uuid,
    pub sql: String,
    pub query_id: String,
    pub chunk_size: Option<usize>,
    pub max_rows: Option<u64>,
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    input: ExecuteQueryInput,
) -> Result<ExecuteQueryResponse, String> {
    let driver = {
        let manager = state.connection_manager.lock().await;
        manager.driver(input.connection_id).map_err(String::from)?
    };

    state
        .query_engine
        .execute_query(driver, &input.sql, input.query_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn execute_query_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExecuteQueryStreamInput,
) -> Result<(), String> {
    let driver = {
        let manager = state.connection_manager.lock().await;
        manager.driver(input.connection_id).map_err(String::from)?
    };

    state
        .query_engine
        .execute_query_stream(
            app,
            driver,
            StreamQueryRequest {
                sql: input.sql,
                query_id: input.query_id,
                chunk_size: input.chunk_size,
                max_rows: input.max_rows,
            },
        )
        .await
}

#[tauri::command]
pub async fn explain_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<ExplainResult, String> {
    let driver = {
        let manager = state.connection_manager.lock().await;
        manager.driver(connection_id).map_err(String::from)?
    };

    state
        .query_engine
        .explain_query(driver, &sql)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    query_id: String,
) -> Result<(), String> {
    let driver = {
        let manager = state.connection_manager.lock().await;
        manager.driver(connection_id).map_err(String::from)?
    };

    state
        .query_engine
        .cancel_query(driver, &query_id)
        .await
        .map_err(Into::into)
}
