use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    models::metadata::{
        ColumnInfo, DatabaseInfo, DbObjectInfo, DbObjectKind, ForeignKeyInfo, IndexInfo,
        SchemaInfo, TableInfo,
    },
    services::metadata_index::{MetadataIndexProgress, MetadataSearchResult},
    AppState,
};

const TASK_UPDATED_EVENT: &str = "task_updated";

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

#[tauri::command]
pub async fn get_table_ddl(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    table: String,
) -> Result<String, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_table_ddl(connection_id, driver, &schema, &table)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_schema_objects(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    kind: DbObjectKind,
) -> Result<Vec<DbObjectInfo>, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_schema_objects(connection_id, driver, &schema, kind)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_object_ddl(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    name: String,
    kind: DbObjectKind,
) -> Result<String, String> {
    let driver = active_driver(&state, connection_id).await?;
    state
        .metadata_service
        .get_object_ddl(connection_id, driver, &schema, &name, kind)
        .await
        .map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMetadataIndexInput {
    pub connection_id: Uuid,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMetadataIndexInput {
    pub query: String,
    pub connection_id: Option<Uuid>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearMetadataIndexInput {
    pub connection_id: Option<Uuid>,
}

#[tauri::command]
pub async fn start_metadata_index_task(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartMetadataIndexInput,
) -> Result<crate::services::task_manager::TaskInfo, String> {
    let connection = state
        .config_store
        .get_connection(input.connection_id)
        .map_err(String::from)?
        .ok_or_else(|| format!("connection not found: {}", input.connection_id))?;
    let driver = active_driver(&state, input.connection_id).await?;
    let task = state
        .task_manager
        .create_task(
            "metadata-index",
            &format!("Index metadata: {}", connection.name),
            None,
        )
        .await;
    let handle = state
        .task_manager
        .handle(task.id)
        .await
        .map_err(String::from)?;
    let manager = state.task_manager.clone();
    let app_for_task = app.clone();
    let index = state.metadata_index.clone();
    let force = input.force.unwrap_or(false);

    tokio::spawn(async move {
        if let Ok(task) = manager
            .start_task(handle.id, "Starting metadata index")
            .await
        {
            emit_task_update(&app_for_task, &task);
        }

        let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<MetadataIndexProgress>();
        let progress_manager = manager.clone();
        let progress_app = app_for_task.clone();
        let progress_task_id = handle.id;
        let progress_task = tokio::spawn(async move {
            while let Some(progress) = progress_rx.recv().await {
                if let Ok(task) = progress_manager
                    .update_progress(progress_task_id, progress.current, "Indexing metadata")
                    .await
                {
                    emit_task_update(&progress_app, &task);
                }
            }
        });

        let result = index
            .index_connection(&connection, driver, force, |progress| {
                let _ = progress_tx.send(progress);
                !handle.is_cancel_requested()
            })
            .await;
        drop(progress_tx);
        let _ = progress_task.await;

        let final_task = if handle.is_cancel_requested() {
            manager
                .finish_cancelled(handle.id, "Metadata indexing cancelled")
                .await
        } else {
            match result {
                Ok(summary) => {
                    manager
                        .finish_success(
                            handle.id,
                            format!("Indexed {} metadata objects", summary.entry_count),
                        )
                        .await
                }
                Err(error) => manager.finish_failed(handle.id, error.to_string()).await,
            }
        };

        if let Ok(task) = final_task {
            emit_task_update(&app_for_task, &task);
        }
    });

    emit_task_update(&app, &task);
    Ok(task)
}

#[tauri::command]
pub async fn search_metadata_index(
    state: State<'_, AppState>,
    input: SearchMetadataIndexInput,
) -> Result<Vec<MetadataSearchResult>, String> {
    Ok(state
        .metadata_index
        .search(
            &input.query,
            input.connection_id,
            input.limit.unwrap_or(40).min(200),
        )
        .await)
}

#[tauri::command]
pub async fn clear_metadata_index(
    state: State<'_, AppState>,
    input: Option<ClearMetadataIndexInput>,
) -> Result<(), String> {
    if let Some(connection_id) = input.and_then(|input| input.connection_id) {
        state.metadata_index.clear_connection(connection_id).await;
    } else {
        state.metadata_index.clear_all().await;
    }
    Ok(())
}

fn emit_task_update(app: &AppHandle, task: &crate::services::task_manager::TaskInfo) {
    let _ = app.emit(TASK_UPDATED_EVENT, task);
}

async fn active_driver(
    state: &State<'_, AppState>,
    connection_id: Uuid,
) -> Result<std::sync::Arc<dyn crate::drivers::trait_def::DatabaseDriver>, String> {
    let manager = state.connection_manager.lock().await;
    manager.driver(connection_id).map_err(String::from)
}
