use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    models::query_result::ExplainResult,
    services::{
        connection_manager::{
            ConsoleTransactionPhase, ConsoleTransactionState, QueryOperationStart,
        },
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
    pub console_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryStreamInput {
    pub connection_id: Uuid,
    pub sql: String,
    pub query_id: String,
    pub chunk_size: Option<usize>,
    pub max_rows: Option<u64>,
    pub console_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTransactionInput {
    pub connection_id: Uuid,
    pub console_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConsoleTransactionModeInput {
    pub connection_id: Uuid,
    pub console_id: String,
    pub mode: String,
}

#[tauri::command]
pub async fn execute_query(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExecuteQueryInput,
) -> Result<ExecuteQueryResponse, String> {
    if let Some(console_id) = input.console_id.as_deref() {
        let (driver, phase) = {
            let manager = state.connection_manager.lock().await;
            let status = manager.console_transaction_state(input.connection_id, console_id);
            (
                manager
                    .console_driver(input.connection_id, console_id)
                    .map_err(String::from)?,
                status.phase,
            )
        };
        if phase == ConsoleTransactionPhase::Failed {
            return Err(String::from(crate::models::error::AppError::ConfigError(
                "transaction failed; rollback is required".to_string(),
            )));
        }
        if phase == ConsoleTransactionPhase::Idle {
            driver.begin_transaction().await.map_err(String::from)?;
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Active,
            );
        }
        let result = state
            .query_engine
            .execute_query(driver, &input.sql, input.query_id)
            .await;
        if result.is_err() {
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Failed,
            );
        }
        return result.map_err(Into::into);
    }
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
    if let Some(console_id) = input.console_id.as_deref() {
        let (driver, phase) = {
            let manager = state.connection_manager.lock().await;
            let status = manager.console_transaction_state(input.connection_id, console_id);
            (
                manager
                    .console_driver(input.connection_id, console_id)
                    .map_err(String::from)?,
                status.phase,
            )
        };
        if phase == ConsoleTransactionPhase::Failed {
            return Err(String::from(crate::models::error::AppError::ConfigError(
                "transaction failed; rollback is required".to_string(),
            )));
        }
        if phase == ConsoleTransactionPhase::Idle {
            driver.begin_transaction().await.map_err(String::from)?;
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Active,
            );
        }
        let result = state
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
            .await;
        if result.is_err() {
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Failed,
            );
        }
        return result;
    }
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

#[tauri::command]
pub async fn console_transaction_state(
    state: State<'_, AppState>,
    input: ConsoleTransactionInput,
) -> Result<ConsoleTransactionState, String> {
    Ok(state
        .connection_manager
        .lock()
        .await
        .console_transaction_state(input.connection_id, &input.console_id))
}

#[tauri::command]
pub async fn set_console_transaction_mode(
    state: State<'_, AppState>,
    input: SetConsoleTransactionModeInput,
) -> Result<ConsoleTransactionState, String> {
    if input.mode == "auto" {
        let mut manager = state.connection_manager.lock().await;
        manager
            .remove_console_session(input.connection_id, &input.console_id)
            .map_err(String::from)?;
        return Ok(manager.console_transaction_state(input.connection_id, &input.console_id));
    }
    if input.mode != "manual" {
        return Err("unsupported transaction mode".to_string());
    }
    if state
        .connection_manager
        .lock()
        .await
        .console_transaction_state(input.connection_id, &input.console_id)
        .mode
        == "manual"
    {
        return Ok(state
            .connection_manager
            .lock()
            .await
            .console_transaction_state(input.connection_id, &input.console_id));
    }
    let config = state
        .config_store
        .get_connection(input.connection_id)
        .map_err(String::from)?
        .ok_or_else(|| "connection not found".to_string())?;
    let password = state
        .config_store
        .decrypt_password(&config)
        .map_err(String::from)?;
    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();
    let ssh_tunnel = state
        .config_store
        .decrypt_ssh_tunnel(&config)
        .map_err(String::from)?;
    let mut runtime_config = config.clone();
    runtime_config.ssh_tunnel = ssh_tunnel;
    let active = crate::services::connection_manager::create_active_connection(
        &runtime_config,
        password.as_deref(),
        definition.as_ref(),
    )
    .await
    .map_err(String::from)?;
    state
        .connection_manager
        .lock()
        .await
        .install_console_session(input.connection_id, input.console_id, active)
        .map_err(String::from)
}

#[tauri::command]
pub async fn commit_console_transaction(
    state: State<'_, AppState>,
    input: ConsoleTransactionInput,
) -> Result<ConsoleTransactionState, String> {
    let driver = state
        .connection_manager
        .lock()
        .await
        .console_driver(input.connection_id, &input.console_id)
        .map_err(String::from)?;
    driver.commit_transaction().await.map_err(String::from)?;
    let mut manager = state.connection_manager.lock().await;
    manager.set_console_phase(
        input.connection_id,
        &input.console_id,
        ConsoleTransactionPhase::Idle,
    );
    Ok(manager.console_transaction_state(input.connection_id, &input.console_id))
}

#[tauri::command]
pub async fn rollback_console_transaction(
    state: State<'_, AppState>,
    input: ConsoleTransactionInput,
) -> Result<ConsoleTransactionState, String> {
    let driver = state
        .connection_manager
        .lock()
        .await
        .console_driver(input.connection_id, &input.console_id)
        .map_err(String::from)?;
    driver.rollback_transaction().await.map_err(String::from)?;
    let mut manager = state.connection_manager.lock().await;
    manager.set_console_phase(
        input.connection_id,
        &input.console_id,
        ConsoleTransactionPhase::Idle,
    );
    Ok(manager.console_transaction_state(input.connection_id, &input.console_id))
}
