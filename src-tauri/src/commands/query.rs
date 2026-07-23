use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    models::query_result::ExplainResult,
    services::{
        connection_manager::QueryOperationStart,
        query_engine::{ExecuteQueryResponse, StreamQueryRequest},
        sql_risk::{analyze_sql_risk as analyze_sql_risk_service, SqlRiskAnalysis},
    },
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
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExecuteQueryInput,
) -> Result<ExecuteQueryResponse, String> {
    let operation_start = {
        let mut manager = state.connection_manager.lock().await;
        manager
            .begin_query_operation(
                input.connection_id,
                input.query_id.as_deref().unwrap_or("anonymous-query"),
            )
            .map_err(String::from)?
    };
    let operation = match operation_start {
        QueryOperationStart::Ready(operation) => operation,
        QueryOperationStart::Queued(queued) => {
            emit_query_queue_state(&app, &input.query_id, input.connection_id, "queued");
            let operation = queued.wait().await.map_err(String::from)?;
            state
                .connection_manager
                .lock()
                .await
                .activate_queued_query(
                    input.connection_id,
                    input.query_id.as_deref().unwrap_or("anonymous-query"),
                )
                .map_err(String::from)?;
            operation
        }
    };
    emit_query_queue_state(&app, &input.query_id, input.connection_id, "running");
    let result = state
        .query_engine
        .execute_query(operation.driver, &input.sql, input.query_id)
        .await
        .map_err(Into::into);
    state
        .connection_manager
        .lock()
        .await
        .release_operation(input.connection_id);
    result
}

#[tauri::command]
pub async fn execute_query_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExecuteQueryStreamInput,
) -> Result<(), String> {
    let operation_start = {
        let mut manager = state.connection_manager.lock().await;
        manager
            .begin_query_operation(input.connection_id, &input.query_id)
            .map_err(String::from)?
    };
    let operation = match operation_start {
        QueryOperationStart::Ready(operation) => operation,
        QueryOperationStart::Queued(queued) => {
            emit_query_queue_state(
                &app,
                &Some(input.query_id.clone()),
                input.connection_id,
                "queued",
            );
            let operation = queued.wait().await.map_err(String::from)?;
            state
                .connection_manager
                .lock()
                .await
                .activate_queued_query(input.connection_id, &input.query_id)
                .map_err(String::from)?;
            operation
        }
    };
    emit_query_queue_state(
        &app,
        &Some(input.query_id.clone()),
        input.connection_id,
        "running",
    );
    let result = state
        .query_engine
        .execute_query_stream(
            app,
            operation.driver,
            StreamQueryRequest {
                sql: input.sql,
                query_id: input.query_id,
                chunk_size: input.chunk_size,
                max_rows: input.max_rows,
            },
        )
        .await;
    state
        .connection_manager
        .lock()
        .await
        .release_operation(input.connection_id);
    result
}

#[tauri::command]
pub async fn explain_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<ExplainResult, String> {
    let driver = {
        let mut manager = state.connection_manager.lock().await;
        manager
            .acquire_driver(connection_id)
            .map_err(String::from)?
    };
    let result = state
        .query_engine
        .explain_query(driver, &sql)
        .await
        .map_err(Into::into);
    state
        .connection_manager
        .lock()
        .await
        .release_operation(connection_id);
    result
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    query_id: String,
) -> Result<(), String> {
    if state
        .connection_manager
        .lock()
        .await
        .cancel_queued_query(connection_id, &query_id)
    {
        return Ok(());
    }
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

fn emit_query_queue_state(
    app: &AppHandle,
    query_id: &Option<String>,
    connection_id: Uuid,
    status: &str,
) {
    let Some(query_id) = query_id else { return };
    let _ = app.emit(
        "query_queue_state",
        serde_json::json!({
            "queryId": query_id,
            "connectionId": connection_id,
            "status": status,
        }),
    );
}

#[tauri::command]
pub fn analyze_sql_risk(sql: String) -> SqlRiskAnalysis {
    analyze_sql_risk_service(&sql)
}
