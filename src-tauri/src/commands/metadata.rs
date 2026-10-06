use serde::Deserialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

use crate::{
    models::error::AppError,
    models::metadata::{
        ColumnInfo, DatabaseInfo, DbObjectInfo, DbObjectKind, ForeignKeyInfo, IndexInfo,
        SchemaInfo, TableInfo,
    },
    services::{
        connection_manager::{ConnectionManager, QueryOperation, QueryOperationStart},
        metadata_index::{MetadataIndexProgress, MetadataIndexSummary, MetadataSearchResult},
        task_manager::{TaskHandle, TaskInfo, TaskManager},
    },
    AppState,
};

const TASK_UPDATED_EVENT: &str = "task_updated";

#[tauri::command]
pub async fn get_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<DatabaseInfo>, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_databases(connection_id, operation.driver.clone())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_schemas(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: Option<String>,
) -> Result<Vec<SchemaInfo>, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_schemas(connection_id, operation.driver.clone(), database.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<TableInfo>, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_tables(connection_id, operation.driver.clone(), &schema)
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
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_columns(connection_id, operation.driver.clone(), &schema, &table)
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
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_indexes(connection_id, operation.driver.clone(), &schema, &table)
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
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_foreign_keys(connection_id, operation.driver.clone(), &schema, &table)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_views(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<TableInfo>, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_views(connection_id, operation.driver.clone(), &schema)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_functions(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<String>, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_functions(connection_id, operation.driver.clone(), &schema)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_table_ddl(
    state: State<'_, AppState>,
    connection_id: Uuid,
    schema: String,
    table: String,
    force: Option<bool>,
) -> Result<String, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_table_ddl(
            connection_id,
            operation.driver.clone(),
            &schema,
            &table,
            force.unwrap_or(false),
        )
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
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_schema_objects(connection_id, operation.driver.clone(), &schema, kind)
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
    force: Option<bool>,
) -> Result<String, String> {
    let operation = metadata_operation(&state.connection_manager, connection_id).await?;
    state
        .metadata_service
        .get_object_ddl(
            connection_id,
            operation.driver.clone(),
            &schema,
            &name,
            kind,
            force.unwrap_or(false),
        )
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
    let operation = begin_metadata_operation(&state.connection_manager, input.connection_id)
        .await
        .map_err(String::from)?;
    let task = state
        .task_manager
        .create_task(
            "metadata-index",
            &format!("Index metadata: {}", connection.name),
            None,
        )
        .await;
    let task = state
        .task_manager
        .update_metadata_progress(task.id, MetadataIndexProgress::starting(&connection.name))
        .await
        .map_err(String::from)?;
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

        // A single latest-value slot bounds memory even when thousands of
        // objects finish between samples. No per-object IPC or task log entries.
        let (progress_tx, progress_rx) = watch::channel(None);
        let progress_manager = manager.clone();
        let progress_app = app_for_task.clone();
        let progress_task_id = handle.id;
        let progress_task = tokio::spawn(async move {
            forward_metadata_progress(progress_rx, &progress_manager, progress_task_id, |task| {
                emit_task_update(&progress_app, task);
            })
            .await;
        });

        let result = async {
            // Waiting is cancellable without interrupting the operation currently
            // using this connection. Keep the lease through the entire index walk.
            let operation = wait_metadata_index_operation(operation, &handle).await?;
            index
                .index_connection(&connection, operation.driver.clone(), force, |progress| {
                    progress_tx.send_if_modified(|latest| {
                        if latest.as_ref() == Some(progress) {
                            return false;
                        }
                        *latest = Some(progress.clone());
                        true
                    });
                    !handle.is_cancel_requested()
                })
                .await
        }
        .await;
        drop(progress_tx);
        let _ = progress_task.await;

        let final_task = finish_metadata_index_task(&manager, &handle, result).await;

        if let Ok(task) = final_task {
            emit_task_update(&app_for_task, &task);
        }
    });

    emit_task_update(&app, &task);
    Ok(task)
}

async fn forward_metadata_progress(
    mut receiver: watch::Receiver<Option<MetadataIndexProgress>>,
    manager: &TaskManager,
    task_id: Uuid,
    mut emit: impl FnMut(&TaskInfo),
) {
    let mut interval = tokio::time::interval(Duration::from_millis(200));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_progress = None;
    loop {
        // Closure flushes the final snapshot before the terminal event without
        // a tail delay. A close racing a tick is handled on the next iteration.
        let closed = tokio::select! {
            _ = progress_tx_closed(&mut receiver) => true,
            _ = interval.tick() => false,
        };
        if let Some(progress) = take_metadata_progress(&mut receiver, &mut last_progress) {
            if let Ok(task) = manager.update_metadata_progress(task_id, progress).await {
                emit(&task);
            }
        }
        if closed {
            break;
        }
    }
}

async fn progress_tx_closed(receiver: &mut watch::Receiver<Option<MetadataIndexProgress>>) {
    while receiver.changed().await.is_ok() {}
}

fn take_metadata_progress(
    receiver: &mut watch::Receiver<Option<MetadataIndexProgress>>,
    last: &mut Option<MetadataIndexProgress>,
) -> Option<MetadataIndexProgress> {
    let latest = receiver.borrow_and_update();
    if *latest == *last {
        return None;
    }
    *last = latest.clone();
    latest.clone()
}

pub(crate) async fn finish_metadata_index_task(
    manager: &TaskManager,
    handle: &TaskHandle,
    result: Result<MetadataIndexSummary, AppError>,
) -> Result<TaskInfo, AppError> {
    match result {
        Ok(summary) => {
            manager
                .set_metadata_capacity_reached(handle.id, summary.capacity_reached)
                .await?;
            let suffix = if summary.capacity_reached {
                "; index capacity reached"
            } else {
                ""
            };
            manager
                .finish_success(
                    handle.id,
                    format!("Indexed {} metadata objects{}", summary.entry_count, suffix),
                )
                .await
        }
        Err(_) if handle.is_cancel_requested() => {
            manager
                .finish_cancelled(handle.id, "Metadata indexing cancelled")
                .await
        }
        Err(error) => manager.finish_failed(handle.id, error.to_string()).await,
    }
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

async fn begin_metadata_operation(
    connections: &Mutex<ConnectionManager>,
    connection_id: Uuid,
) -> Result<QueryOperationStart, AppError> {
    connections.lock().await.begin_query_operation(
        connection_id,
        &format!("metadata-operation-{}", Uuid::new_v4()),
    )
}

async fn metadata_operation(
    connections: &Mutex<ConnectionManager>,
    connection_id: Uuid,
) -> Result<QueryOperation, String> {
    // Release the manager lock before waiting for the serial permit or database.
    begin_metadata_operation(connections, connection_id)
        .await
        .map_err(String::from)?
        .wait()
        .await
        .map_err(Into::into)
}

async fn wait_metadata_index_operation(
    operation: QueryOperationStart,
    handle: &TaskHandle,
) -> Result<QueryOperation, AppError> {
    tokio::select! {
        biased;
        _ = handle.cancelled() => Err(AppError::ConfigError("metadata indexing cancelled".into())),
        result = operation.wait() => result,
    }
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn progress_worker_flushes_a_burst_once_and_cached_path_emits_nothing() {
        let manager = TaskManager::new();
        for objects in [0, 1000] {
            let task = manager.create_task("metadata-index", "fixture", None).await;
            let (tx, rx) = watch::channel(None);
            for ordinal in 1..=objects {
                let mut progress = MetadataIndexProgress::starting("fixture");
                progress.stage = crate::services::metadata_index::MetadataIndexStage::TableColumns;
                progress.object_current = Some(ordinal);
                progress.object_total = Some(objects);
                tx.send_replace(Some(progress));
            }
            drop(tx);
            let mut events = Vec::new();
            forward_metadata_progress(rx, &manager, task.id, |task| events.push(task.clone()))
                .await;
            assert_eq!(events.len(), usize::from(objects > 0));
            if objects > 0 {
                assert_eq!(
                    events[0].progress.metadata.as_ref().unwrap().object_current,
                    Some(1000)
                );
                assert_eq!(
                    events[0].logs.len(),
                    1,
                    "object updates must not accumulate logs"
                );
            }
        }
    }

    #[test]
    fn progress_sampling_coalesces_one_thousand_objects_without_a_queue() {
        use super::{take_metadata_progress, MetadataIndexProgress};
        use crate::services::metadata_index::MetadataIndexStage;
        let (tx, mut rx) = tokio::sync::watch::channel(None);
        let mut last = None;
        let mut events = Vec::new();
        let mut progress = MetadataIndexProgress::starting("fixture");
        progress.stage = MetadataIndexStage::TableColumns;
        progress.total = Some(1);
        progress.schema_name = Some("public".into());
        progress.object_total = Some(1000);
        // Deterministic frames, not a wall-clock speed requirement. The same
        // sampler is used by the 200ms production timer.
        for ordinal in 1..=1000 {
            progress.object_current = Some(ordinal);
            progress.object_name = Some(format!("table_{ordinal}"));
            tx.send_replace(Some(progress.clone()));
            if ordinal == 1 || ordinal % 200 == 0 {
                events.push(take_metadata_progress(&mut rx, &mut last).unwrap());
                assert!(take_metadata_progress(&mut rx, &mut last).is_none());
            }
        }
        assert_eq!(events.len(), 6);
        assert_eq!(events.last().unwrap().object_current, Some(1000));
        progress.stage = MetadataIndexStage::Finalizing;
        progress.object_current = None;
        progress.object_total = None;
        progress.object_name = None;
        tx.send_replace(Some(progress));
        drop(tx);
        events.push(take_metadata_progress(&mut rx, &mut last).unwrap());
        assert_eq!(events.len(), 7);
        assert!(rx.has_changed().is_err());
        assert!(take_metadata_progress(&mut rx, &mut last).is_none());
    }

    #[tokio::test]
    async fn metadata_progress_preserves_cancelling_and_terminal_outcomes() {
        use super::{finish_metadata_index_task, MetadataIndexProgress, MetadataIndexSummary};
        use crate::services::{
            metadata_index::MetadataIndexStage,
            task_manager::{TaskManager, TaskStatus},
        };
        let manager = TaskManager::new();
        for status in [
            TaskStatus::Succeeded,
            TaskStatus::Cancelled,
            TaskStatus::Failed,
        ] {
            let task = manager.create_task("metadata-index", "fixture", None).await;
            let handle = manager.handle(task.id).await.unwrap();
            manager.start_task(task.id, "starting").await.unwrap();
            let mut progress = MetadataIndexProgress::starting("fixture");
            progress.stage = MetadataIndexStage::TableColumns;
            if status == TaskStatus::Cancelled {
                assert_eq!(
                    manager.request_cancel(task.id).await.unwrap().status,
                    TaskStatus::Cancelling
                );
                assert_eq!(
                    manager
                        .update_metadata_progress(task.id, progress.clone())
                        .await
                        .unwrap()
                        .status,
                    TaskStatus::Cancelling
                );
            }
            manager
                .update_metadata_progress(task.id, progress.clone())
                .await
                .unwrap();
            let result = if status == TaskStatus::Succeeded {
                Ok(MetadataIndexSummary {
                    connection_id: uuid::Uuid::new_v4(),
                    entry_count: 50_000,
                    capacity_reached: true,
                })
            } else {
                Err(crate::models::error::AppError::ConfigError(
                    "fixture stopped".into(),
                ))
            };
            let terminal = finish_metadata_index_task(&manager, &handle, result)
                .await
                .unwrap();
            assert_eq!(terminal.status, status);
            assert!(terminal.finished_at.is_some());
            assert_eq!(
                terminal.progress.metadata_capacity_reached,
                if status == TaskStatus::Succeeded {
                    Some(true)
                } else {
                    None
                }
            );
            progress.stage = MetadataIndexStage::Finalizing;
            let late = manager
                .update_metadata_progress(task.id, progress)
                .await
                .unwrap();
            assert_eq!(late.status, status);
            assert_eq!(
                late.progress.metadata.unwrap().stage,
                MetadataIndexStage::TableColumns
            );
        }
    }

    use super::*;
    use crate::{
        models::connection::ConnectionConfig,
        services::{
            connection_manager::create_active_connection, metadata_index::MetadataIndexService,
            metadata_service::MetadataService, task_manager::TaskManager,
        },
    };
    use std::{sync::Arc, time::Duration};

    async fn connection() -> (Arc<Mutex<ConnectionManager>>, ConnectionConfig) {
        let config: ConnectionConfig = serde_json::from_value(serde_json::json!({
            "id": Uuid::new_v4(), "name": "metadata lease test", "driverType": "sqlite",
            "connectionUrl": ":memory:", "driverPaths": [],
            "createdAt": "2026-09-22T00:00:00Z", "updatedAt": "2026-09-22T00:00:00Z"
        }))
        .unwrap();
        let mut manager = ConnectionManager::new();
        manager.begin_connect(config.id).unwrap();
        manager
            .finish_connect(
                config.id,
                create_active_connection(&config, None, None).await,
            )
            .unwrap();
        (Arc::new(Mutex::new(manager)), config)
    }

    async fn task() -> (TaskManager, TaskHandle) {
        let manager = TaskManager::new();
        let info = manager.create_task("metadata-index", "test", None).await;
        let handle = manager.handle(info.id).await.unwrap();
        (manager, handle)
    }

    #[tokio::test]
    async fn committed_index_stays_succeeded_when_cancel_arrives_after_service_return() {
        use crate::services::task_manager::TaskStatus;
        let (connections, config) = connection().await;
        let operation = metadata_operation(&connections, config.id).await.unwrap();
        let index = MetadataIndexService::new();
        let (manager, handle) = task().await;
        let result = index
            .index_connection(&config, operation.driver.clone(), true, |_| {
                !handle.is_cancel_requested()
            })
            .await;
        assert!(result.is_ok());
        manager.request_cancel(handle.id).await.unwrap();
        let terminal = finish_metadata_index_task(&manager, &handle, result)
            .await
            .unwrap();
        assert_eq!(terminal.status, TaskStatus::Succeeded);
        assert!(!index
            .search(&config.name, Some(config.id), 20)
            .await
            .is_empty());
    }

    #[tokio::test]
    async fn cancelled_service_and_invalidated_service_have_distinct_task_statuses() {
        use crate::services::task_manager::TaskStatus;
        let (connections, config) = connection().await;
        let operation = metadata_operation(&connections, config.id).await.unwrap();
        let index = MetadataIndexService::new();
        let (manager, handle) = task().await;
        manager.request_cancel(handle.id).await.unwrap();
        let result = index
            .index_connection(&config, operation.driver.clone(), true, |_| {
                !handle.is_cancel_requested()
            })
            .await;
        assert!(result.is_err());
        let terminal = finish_metadata_index_task(&manager, &handle, result)
            .await
            .unwrap();
        assert_eq!(terminal.status, TaskStatus::Cancelled);
        assert!(index
            .search(&config.name, Some(config.id), 20)
            .await
            .is_empty());
        let (manager, handle) = task().await;
        let terminal = finish_metadata_index_task(
            &manager,
            &handle,
            Err(AppError::ConfigError(
                "metadata index invalidated; retry the index".into(),
            )),
        )
        .await
        .unwrap();
        assert_eq!(terminal.status, TaskStatus::Failed);
    }

    #[tokio::test]
    async fn metadata_queue_releases_manager_lock_and_protects_connection() {
        let (connections, config) = connection().await;
        let running = metadata_operation(&connections, config.id).await.unwrap();
        let mut waiting = Box::pin(metadata_operation(&connections, config.id));
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut waiting)
                .await
                .is_err()
        );
        // The waiting future remains alive, but must not own the manager lock.
        assert!(connections
            .try_lock()
            .unwrap()
            .disconnect(config.id)
            .is_err());
        drop(running);
        let operation = tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .unwrap()
            .unwrap();
        let metadata = MetadataService::new();
        assert!(!metadata
            .get_schemas(config.id, operation.driver.clone(), None)
            .await
            .unwrap()
            .is_empty());
        assert!(connections.lock().await.disconnect(config.id).is_err());
        drop(operation);
        connections.lock().await.disconnect(config.id).unwrap();
    }

    #[tokio::test]
    async fn queued_index_cancel_does_not_cancel_the_active_query() {
        let (connections, config) = connection().await;
        let running = metadata_operation(&connections, config.id).await.unwrap();
        let queued = begin_metadata_operation(&connections, config.id)
            .await
            .unwrap();
        assert!(matches!(&queued, QueryOperationStart::Queued(_)));
        let (manager, handle) = task().await;
        let (result, ()) = tokio::join!(wait_metadata_index_operation(queued, &handle), async {
            manager.request_cancel(handle.id).await.unwrap();
        });
        assert!(result.is_err());
        assert!(connections.lock().await.disconnect(config.id).is_err());
        assert!(running
            .driver
            .execute_query("SELECT 42", None)
            .await
            .is_ok());
        drop(running);
        connections.lock().await.disconnect(config.id).unwrap();
    }

    #[tokio::test]
    async fn index_start_rejects_pre_cancelled_and_retired_operations() {
        let (connections, config) = connection().await;
        let operation = begin_metadata_operation(&connections, config.id)
            .await
            .unwrap();
        let (manager, handle) = task().await;
        manager.request_cancel(handle.id).await.unwrap();
        assert!(wait_metadata_index_operation(operation, &handle)
            .await
            .is_err());
        connections.lock().await.disconnect(config.id).unwrap();

        for queued in [false, true] {
            let (connections, config) = connection().await;
            let running = if queued {
                Some(metadata_operation(&connections, config.id).await.unwrap())
            } else {
                None
            };
            let operation = begin_metadata_operation(&connections, config.id)
                .await
                .unwrap();
            connections
                .lock()
                .await
                .invalidate_connection(config.id, "retired");
            let (_, handle) = task().await;
            assert!(tokio::time::timeout(
                Duration::from_secs(1),
                wait_metadata_index_operation(operation, &handle)
            )
            .await
            .unwrap()
            .is_err());
            drop(running);
        }
    }

    #[tokio::test]
    async fn dropped_metadata_waiter_releases_its_registration() {
        let (connections, config) = connection().await;
        let running = metadata_operation(&connections, config.id).await.unwrap();
        let mut waiting = Box::pin(metadata_operation(&connections, config.id));
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut waiting)
                .await
                .is_err()
        );
        drop(waiting);
        drop(running);
        connections.lock().await.disconnect(config.id).unwrap();
    }

    #[tokio::test]
    async fn metadata_error_releases_lease() {
        let (connections, config) = connection().await;
        let result: Result<String, String> = async {
            let operation = metadata_operation(&connections, config.id).await?;
            MetadataService::new()
                .get_table_ddl(
                    config.id,
                    operation.driver.clone(),
                    "main",
                    "missing",
                    false,
                )
                .await
                .map_err(Into::into)
        }
        .await;
        assert!(result.is_err());
        connections.lock().await.disconnect(config.id).unwrap();
    }

    #[tokio::test]
    async fn sqlite_index_holds_lease_through_progress_and_releases_after_return() {
        let (connections, config) = connection().await;
        let operation = begin_metadata_operation(&connections, config.id)
            .await
            .unwrap();
        let (_, handle) = task().await;
        let index = MetadataIndexService::new();
        let mut progress_count = 0;
        let summary = async {
            let operation = wait_metadata_index_operation(operation, &handle)
                .await
                .unwrap();
            operation
                .driver
                .execute_query("CREATE TABLE lease_items (id INTEGER PRIMARY KEY)", None)
                .await
                .unwrap();
            index
                .index_connection(&config, operation.driver.clone(), true, |_| {
                    progress_count += 1;
                    assert!(connections
                        .try_lock()
                        .unwrap()
                        .disconnect(config.id)
                        .is_err());
                    true
                })
                .await
                .unwrap()
        }
        .await;
        assert!(progress_count > 1);
        assert!(summary.entry_count > 1);
        assert!(!index
            .search("lease_items", Some(config.id), 20)
            .await
            .is_empty());
        connections.lock().await.disconnect(config.id).unwrap();
    }
}
