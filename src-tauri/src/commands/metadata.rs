use tauri::State;
use uuid::Uuid;

use crate::{
    models::metadata::{
        ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo,
    },
    AppState,
};

#[tauri::command]
pub async fn get_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<DatabaseInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_databases(connection_id, driver)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_schemas(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: Option<String>,
) -> Result<Vec<SchemaInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_schemas(connection_id, driver, database.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<TableInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_tables(connection_id, driver, &schema)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_columns(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_columns(connection_id, driver, &schema, &table)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_indexes(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_indexes(connection_id, driver, &schema, &table)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_foreign_keys(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_foreign_keys(connection_id, driver, &schema, &table)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_views(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<TableInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_views(connection_id, driver, &schema)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_functions(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<String>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_functions(connection_id, driver, &schema)
        .await
        .map_err(Into::into)
}

async fn active_driver(
    state: &State<'_, AppState>,
    connection_id: Uuid,
) -> Result<std::sync::Arc<dyn crate::drivers::trait_def::DatabaseDriver>, String> {
    let manager = state.connection_manager.lock().await;
    manager.driver(connection_id).map_err(String::from)
}
