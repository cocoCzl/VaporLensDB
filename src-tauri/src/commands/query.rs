use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    models::connection::DriverType,
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
    pub max_rows: Option<u64>,
    pub console_id: Option<String>,
    pub tab_id: Option<String>,
    pub connection_name: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
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
    pub tab_id: Option<String>,
    pub connection_name: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSession {
    pub connection_generation: u64,
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

/// A SQL tab's identifier is a logical console identity. Disconnecting a Data
/// Source retires its runtime (including the runtime-owned console driver),
/// but must not make an already-open manual-transaction tab permanently
/// unusable after that Data Source reconnects. Recreate the runtime console on
/// demand, preserving the tab's own connection/database/schema context.
async fn ensure_console_session(
    state: &State<'_, AppState>,
    connection_id: Uuid,
    console_id: &str,
) -> Result<(), String> {
    if state
        .connection_manager
        .lock()
        .await
        .console_driver(connection_id, console_id)
        .is_ok()
    {
        return Ok(());
    }

    let config = state
        .config_store
        .get_connection(connection_id)
        .map_err(String::from)?
        .ok_or_else(|| "connection not found".to_string())?;
    let (password, ssh_tunnel) = state
        .config_store
        .decrypt_connection_credentials(&config)
        .map_err(String::from)?;
    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();
    let mut runtime_config = config;
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
        .install_console_session(connection_id, console_id.to_string(), active)
        .map_err(String::from)?;
    Ok(())
}

/// Apply the SQL tab's explicit execution context immediately before its
/// statement runs.  A toolbar selection is a property of the logical tab,
/// not merely metadata used for completion.  Native PostgreSQL/MySQL runtime
/// connections are shared in Auto mode, so the selected context must be sent
/// to the driver for every execution rather than inherited from the sidebar
/// or a prior tab's session state.
pub(crate) async fn apply_execution_context(
    driver: std::sync::Arc<dyn crate::drivers::trait_def::DatabaseDriver>,
    driver_type: DriverType,
    database: Option<&str>,
    schema: Option<&str>,
) -> Result<(), String> {
    let statement = execution_context_statement(driver_type, database, schema);

    if let Some(statement) = statement {
        driver
            .execute_query(&statement, None)
            .await
            .map_err(String::from)?;
    }
    Ok(())
}

fn execution_context_statement(
    driver_type: DriverType,
    database: Option<&str>,
    schema: Option<&str>,
) -> Option<String> {
    match driver_type {
        DriverType::Postgres => schema
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("SET search_path TO {}", quote_identifier(value)))
            .or_else(|| Some("SET search_path TO DEFAULT".to_string())),
        DriverType::Mysql => database
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("USE {}", quote_mysql_identifier(value))),
        _ => None,
    }
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('\"', "\"\""))
}

fn quote_mysql_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn execution_driver_type(
    state: &State<'_, AppState>,
    connection_id: Uuid,
) -> Result<DriverType, String> {
    state
        .config_store
        .get_connection(connection_id)
        .map_err(String::from)?
        .map(|config| config.driver_type)
        .ok_or_else(|| "connection not found".to_string())
}

#[tauri::command]
pub async fn execute_query(
    app: AppHandle,
    state: State<'_, AppState>,
    mut input: ExecuteQueryInput,
) -> Result<ExecuteQueryResponse, String> {
    let input_query_id = input
        .query_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    input.query_id = Some(input_query_id.clone());
    let driver_type = execution_driver_type(&state, input.connection_id)?;
    if let Some(console_id) = input.console_id.as_deref() {
        ensure_console_session(&state, input.connection_id, console_id).await?;
        let operation = state
            .connection_manager
            .lock()
            .await
            .begin_console_operation(input.connection_id, console_id, Some(&input_query_id))
            .map_err(String::from)?;
        let driver = operation.driver.clone();
        let phase = operation.phase;
        if phase == ConsoleTransactionPhase::Failed {
            return Err(String::from(crate::models::error::AppError::ConfigError(
                "transaction failed; rollback is required".to_string(),
            )));
        }
        apply_execution_context(
            driver.clone(),
            driver_type,
            input.database.as_deref(),
            input.schema.as_deref(),
        )
        .await?;
        if phase == ConsoleTransactionPhase::Idle {
            driver.begin_transaction().await.map_err(String::from)?;
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Active,
            );
        }
        let sql = input.sql.clone();
        let mut result = state
            .query_engine
            .execute_query(driver, &input.sql, input.query_id, input.max_rows)
            .await;
        if result.is_err() {
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Failed,
            );
        }
        if let Ok(response) = &mut result {
            response.connection_generation = Some(operation.generation);
        }
        clear_metadata_after_successful_ddl(&state, input.connection_id, &sql, &result).await;
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
            queued.wait().await.map_err(String::from)?
        }
    };
    apply_execution_context(
        operation.driver.clone(),
        driver_type,
        input.database.as_deref(),
        input.schema.as_deref(),
    )
    .await?;
    log_execute_context(
        input.tab_id.as_deref(),
        input.connection_id,
        input.connection_name.as_deref(),
        input.database.as_deref(),
        input.schema.as_deref(),
        operation.driver.driver_name(),
        operation.generation,
    );
    emit_query_queue_state(&app, &input.query_id, input.connection_id, "running");
    let sql = input.sql.clone();
    let generation = operation.generation;
    let mut execution = state
        .query_engine
        .execute_query(operation.driver, &input.sql, input.query_id, input.max_rows)
        .await;
    if execution
        .as_ref()
        .is_err_and(should_retire_stale_connection)
    {
        retire_stale_connection(
            &state,
            input.connection_id,
            generation,
            "query detected a closed runtime session",
        )
        .await;
    }
    if let Ok(response) = &mut execution {
        response.connection_generation = Some(generation);
    }
    clear_metadata_after_successful_ddl(&state, input.connection_id, &sql, &execution).await;
    execution.map_err(Into::into)
}

#[tauri::command]
pub async fn execute_query_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ExecuteQueryStreamInput,
) -> Result<ExecutionSession, String> {
    let driver_type = execution_driver_type(&state, input.connection_id)?;
    if let Some(console_id) = input.console_id.as_deref() {
        let input_query_id = input.query_id.clone();
        ensure_console_session(&state, input.connection_id, console_id).await?;
        let operation = state
            .connection_manager
            .lock()
            .await
            .begin_console_operation(input.connection_id, console_id, Some(&input_query_id))
            .map_err(String::from)?;
        let driver = operation.driver.clone();
        let phase = operation.phase;
        if phase == ConsoleTransactionPhase::Failed {
            return Err(String::from(crate::models::error::AppError::ConfigError(
                "transaction failed; rollback is required".to_string(),
            )));
        }
        apply_execution_context(
            driver.clone(),
            driver_type,
            input.database.as_deref(),
            input.schema.as_deref(),
        )
        .await?;
        if phase == ConsoleTransactionPhase::Idle {
            driver.begin_transaction().await.map_err(String::from)?;
            state.connection_manager.lock().await.set_console_phase(
                input.connection_id,
                console_id,
                ConsoleTransactionPhase::Active,
            );
        }
        let sql = input.sql.clone();
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
        clear_metadata_after_successful_ddl(&state, input.connection_id, &sql, &result).await;
        return result.map(|()| ExecutionSession {
            connection_generation: operation.generation,
        });
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
            queued.wait().await.map_err(String::from)?
        }
    };
    apply_execution_context(
        operation.driver.clone(),
        driver_type,
        input.database.as_deref(),
        input.schema.as_deref(),
    )
    .await?;
    log_execute_context(
        input.tab_id.as_deref(),
        input.connection_id,
        input.connection_name.as_deref(),
        input.database.as_deref(),
        input.schema.as_deref(),
        operation.driver.driver_name(),
        operation.generation,
    );
    emit_query_queue_state(
        &app,
        &Some(input.query_id.clone()),
        input.connection_id,
        "running",
    );
    let sql = input.sql.clone();
    let generation = operation.generation;
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
    if result
        .as_ref()
        .is_err_and(|error| should_retire_stale_connection_message(error))
    {
        retire_stale_connection(
            &state,
            input.connection_id,
            generation,
            "query stream detected a closed runtime session",
        )
        .await;
    }
    clear_metadata_after_successful_ddl(&state, input.connection_id, &sql, &result).await;
    result.map(|()| ExecutionSession {
        connection_generation: generation,
    })
}

async fn clear_metadata_after_successful_ddl<T, E>(
    state: &State<'_, AppState>,
    connection_id: Uuid,
    sql: &str,
    result: &Result<T, E>,
) {
    if result.is_ok() && contains_metadata_ddl(sql) {
        state.metadata_service.clear_connection(connection_id).await;
        state.metadata_index.clear_connection(connection_id).await;
    }
}

fn contains_metadata_ddl(sql: &str) -> bool {
    sql.split(';').any(|statement| {
        let keyword = statement
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_matches(|character: char| !character.is_ascii_alphabetic())
            .to_ascii_uppercase();
        matches!(
            keyword.as_str(),
            "ALTER" | "CREATE" | "DROP" | "RENAME" | "TRUNCATE"
        )
    })
}

fn log_execute_context(
    tab_id: Option<&str>,
    connection_id: Uuid,
    connection_name: Option<&str>,
    database: Option<&str>,
    schema: Option<&str>,
    driver: &str,
    generation: u64,
) {
    log::debug!(
        "Execute SQL: tab={} connectionId={} connectionName={} driver={} database={} schema={} poolGeneration={}",
        tab_id.unwrap_or("<none>"),
        connection_id,
        connection_name.unwrap_or("<unknown>"),
        driver,
        database.unwrap_or("<none>"),
        schema.unwrap_or("<none>"),
        generation,
    );
}

fn should_retire_stale_connection(error: &crate::models::error::AppError) -> bool {
    should_retire_stale_connection_message(&error.to_string())
}

fn should_retire_stale_connection_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "pool is closed",
        "pool has been closed",
        "pool 已被关闭",
        "connection is closed",
        "closed connection",
        "jdbc bridge sidecar is not running",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

async fn retire_stale_connection(
    state: &State<'_, AppState>,
    connection_id: Uuid,
    generation: u64,
    reason: &str,
) {
    log::debug!(
        "retiring stale execution session: connectionId={} reason={}",
        connection_id,
        reason
    );
    state
        .connection_manager
        .lock()
        .await
        .invalidate_connection_generation(connection_id, generation, reason);
}

#[cfg(test)]
mod tests {
    use super::{contains_metadata_ddl, should_retire_stale_connection_message};

    #[test]
    fn detects_closed_pool_errors_without_retiring_sql_errors() {
        assert!(should_retire_stale_connection_message(
            "Connection failed (jdbc): pool has been closed"
        ));
        assert!(should_retire_stale_connection_message("pool 已被关闭"));
        assert!(!should_retire_stale_connection_message(
            "ORA-00942: table or view does not exist"
        ));
    }

    #[test]
    fn identifies_metadata_changing_ddl_without_invalidating_for_dml_or_selects() {
        assert!(contains_metadata_ddl(
            "CREATE TABLE child_items (id INTEGER PRIMARY KEY);"
        ));
        assert!(contains_metadata_ddl(
            "ALTER TABLE child_items ADD COLUMN note TEXT;"
        ));
        assert!(contains_metadata_ddl("DROP VIEW child_item_view;"));
        assert!(!contains_metadata_ddl("SELECT * FROM child_items;"));
        assert!(!contains_metadata_ddl(
            "UPDATE child_items SET quantity = 11 WHERE id = 1;"
        ));
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Preserve the existing flat IPC arguments; context fields are optional.
pub async fn explain_query(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    query_id: Option<String>,
    console_id: Option<String>,
    database: Option<String>,
    schema: Option<String>,
) -> Result<ExplainResult, String> {
    let driver_type = execution_driver_type(&state, connection_id)?;
    let query_id = query_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    if let Some(console_id) = console_id {
        // EXPLAIN must see the existing console's temporary/uncommitted objects.
        // Do not silently recreate a lost transaction on a fresh connection.
        let operation = state
            .connection_manager
            .lock()
            .await
            .begin_console_operation(connection_id, &console_id, Some(&query_id))
            .map_err(String::from)?;
        if operation.phase == ConsoleTransactionPhase::Failed {
            return Err("transaction failed; rollback is required".into());
        }
        let result = async {
            apply_execution_context(
                operation.driver.clone(),
                driver_type,
                database.as_deref(),
                schema.as_deref(),
            )
            .await?;
            state
                .query_engine
                .explain_query(operation.driver.clone(), &sql)
                .await
                .map_err(String::from)
        }
        .await;
        if result.is_err() && operation.phase == ConsoleTransactionPhase::Active {
            state.connection_manager.lock().await.set_console_phase(
                connection_id,
                &console_id,
                ConsoleTransactionPhase::Failed,
            );
        }
        return result;
    }
    let start = {
        let mut manager = state.connection_manager.lock().await;
        manager
            .begin_query_operation(connection_id, &query_id)
            .map_err(String::from)?
    };
    let operation = match start {
        QueryOperationStart::Ready(operation) => operation,
        QueryOperationStart::Queued(queued) => {
            emit_query_queue_state(&app, &Some(query_id.clone()), connection_id, "queued");
            queued.wait().await.map_err(String::from)?
        }
    };
    emit_query_queue_state(&app, &Some(query_id), connection_id, "running");
    async {
        apply_execution_context(
            operation.driver.clone(),
            driver_type,
            database.as_deref(),
            schema.as_deref(),
        )
        .await?;
        state
            .query_engine
            .explain_query(operation.driver.clone(), &sql)
            .await
            .map_err(String::from)
    }
    .await
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
        manager
            .query_driver(connection_id, &query_id)
            .map_err(String::from)?
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
    let (password, ssh_tunnel) = state
        .config_store
        .decrypt_connection_credentials(&config)
        .map_err(String::from)?;
    let definition = config
        .driver_definition_id
        .as_deref()
        .map(|id| state.config_store.get_driver_definition(id))
        .transpose()
        .map_err(String::from)?
        .flatten();
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
    let operation = state
        .connection_manager
        .lock()
        .await
        .begin_console_operation(input.connection_id, &input.console_id, None)
        .map_err(String::from)?;
    operation
        .driver
        .commit_transaction()
        .await
        .map_err(String::from)?;
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
    let operation = state
        .connection_manager
        .lock()
        .await
        .begin_console_operation(input.connection_id, &input.console_id, None)
        .map_err(String::from)?;
    operation
        .driver
        .rollback_transaction()
        .await
        .map_err(String::from)?;
    let mut manager = state.connection_manager.lock().await;
    manager.set_console_phase(
        input.connection_id,
        &input.console_id,
        ConsoleTransactionPhase::Idle,
    );
    Ok(manager.console_transaction_state(input.connection_id, &input.console_id))
}

#[cfg(test)]
mod context_tests {
    use super::execution_context_statement;
    use crate::models::connection::DriverType;

    #[test]
    fn native_execution_context_uses_the_tab_not_the_prior_session_state() {
        assert_eq!(
            execution_context_statement(DriverType::Postgres, Some("ignored"), Some("qa_a")),
            Some("SET search_path TO \"qa_a\"".to_string())
        );
        assert_eq!(
            execution_context_statement(DriverType::Mysql, Some("vaporlensdb_qa_alt"), None),
            Some("USE `vaporlensdb_qa_alt`".to_string())
        );
        assert_eq!(
            execution_context_statement(DriverType::Postgres, None, None),
            Some("SET search_path TO DEFAULT".to_string())
        );
    }

    #[test]
    fn execution_context_quotes_identifiers() {
        assert_eq!(
            execution_context_statement(DriverType::Postgres, None, Some("qa\"name")),
            Some("SET search_path TO \"qa\"\"name\"".to_string())
        );
        assert_eq!(
            execution_context_statement(DriverType::Mysql, Some("qa`name"), None),
            Some("USE `qa``name`".to_string())
        );
    }
}
