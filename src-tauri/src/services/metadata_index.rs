use std::{collections::HashMap, sync::Arc};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        connection::ConnectionConfig,
        error::AppError,
        metadata::{ColumnInfo, DatabaseInfo, SchemaInfo, TableInfo, TableType},
    },
};

/// Object search remains useful on very large installations without retaining
/// every column name in the renderer process.
const MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION: usize = 50_000;
const MAX_METADATA_INDEX_ENTRIES_TOTAL: usize = 150_000;

#[derive(Clone, Default)]
pub struct MetadataIndexService {
    state: Arc<RwLock<MetadataIndexState>>,
}

#[derive(Default)]
struct MetadataIndexState {
    entries: HashMap<Uuid, Vec<MetadataIndexEntry>>,
    generations: HashMap<Uuid, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetadataIndexKind {
    Connection,
    Database,
    Schema,
    Table,
    View,
    Function,
    Column,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataIndexEntry {
    pub connection_id: Uuid,
    pub connection_name: String,
    pub kind: MetadataIndexKind,
    pub name: String,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSearchResult {
    pub entry: MetadataIndexEntry,
    pub score: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataIndexSummary {
    pub connection_id: Uuid,
    pub entry_count: usize,
    #[serde(default)]
    pub capacity_reached: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetadataIndexStage {
    Starting,
    Databases,
    Schemas,
    Tables,
    TableColumns,
    Views,
    ViewColumns,
    Functions,
    Finalizing,
}

/// Schema counts are not an estimate of overall work. Object counts describe
/// the current table/view within its already fetched list, not completed work.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataIndexProgress {
    pub current: u64,
    pub total: Option<u64>,
    pub stage: MetadataIndexStage,
    pub connection_name: String,
    pub schema_name: Option<String>,
    pub object_name: Option<String>,
    pub object_current: Option<u64>,
    pub object_total: Option<u64>,
}

impl MetadataIndexProgress {
    pub fn starting(connection_name: &str) -> Self {
        Self {
            current: 0,
            total: None,
            stage: MetadataIndexStage::Starting,
            connection_name: connection_name.to_string(),
            schema_name: None,
            object_name: None,
            object_current: None,
            object_total: None,
        }
    }

    fn stage(&mut self, stage: MetadataIndexStage) {
        self.stage = stage;
        self.object_name = None;
        self.object_current = None;
        self.object_total = None;
    }
}

impl MetadataIndexService {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn index_connection<F>(
        &self,
        connection: &ConnectionConfig,
        driver: Arc<dyn DatabaseDriver>,
        force: bool,
        on_progress: F,
    ) -> Result<MetadataIndexSummary, AppError>
    where
        F: FnMut(&MetadataIndexProgress) -> bool + Send,
    {
        self.index_connection_with_capacity(
            connection,
            driver,
            force,
            MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION,
            on_progress,
        )
        .await
    }

    #[cfg(test)]
    async fn index_connection_with_limit<F>(
        &self,
        connection: &ConnectionConfig,
        driver: Arc<dyn DatabaseDriver>,
        force: bool,
        capacity: usize,
        on_progress: F,
    ) -> Result<MetadataIndexSummary, AppError>
    where
        F: FnMut(&MetadataIndexProgress) -> bool + Send,
    {
        self.index_connection_with_capacity(connection, driver, force, capacity, on_progress)
            .await
    }

    async fn index_connection_with_capacity<F>(
        &self,
        connection: &ConnectionConfig,
        driver: Arc<dyn DatabaseDriver>,
        force: bool,
        capacity: usize,
        mut on_progress: F,
    ) -> Result<MetadataIndexSummary, AppError>
    where
        F: FnMut(&MetadataIndexProgress) -> bool + Send,
    {
        let capacity = capacity.max(1);
        let generation = {
            let mut state = self.state.write().await;
            if !force {
                if let Some(existing) = state.entries.get(&connection.id) {
                    return Ok(MetadataIndexSummary {
                        connection_id: connection.id,
                        entry_count: existing.len(),
                        capacity_reached: existing.len() >= capacity,
                    });
                }
            }
            let generation = state.generations.entry(connection.id).or_default();
            *generation = generation.wrapping_add(1);
            *generation
        };

        let mut entries = vec![connection_entry(connection)];
        let mut progress = MetadataIndexProgress::starting(&connection.name);
        progress.stage(MetadataIndexStage::Databases);
        check_cancel(&mut on_progress, &progress)?;

        let mut capacity_reached = false;
        if has_capacity(&entries, capacity) {
            let databases =
                checked_metadata(driver.get_databases(), &mut on_progress, &progress).await?;
            for database in &databases {
                push_index_entry(&mut entries, database_entry(connection, database), capacity);
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
            }
        } else {
            capacity_reached = true;
        }

        progress.stage(MetadataIndexStage::Schemas);
        let schemas = if has_capacity(&entries, capacity) {
            checked_metadata(
                driver.get_schemas(connection.database.as_deref()),
                &mut on_progress,
                &progress,
            )
            .await?
        } else {
            Vec::new()
        };
        let schema_total = schemas.len() as u64;
        progress.total = Some(schema_total);
        check_cancel(&mut on_progress, &progress)?;

        let mut current = 0_u64;
        for schema in &schemas {
            progress.schema_name = Some(schema.name.clone());
            progress.stage(MetadataIndexStage::Tables);
            check_cancel(&mut on_progress, &progress)?;
            if !has_capacity(&entries, capacity) {
                capacity_reached = true;
                break;
            }
            push_index_entry(&mut entries, schema_entry(connection, schema), capacity);
            if !has_capacity(&entries, capacity) {
                capacity_reached = true;
                break;
            }

            let tables =
                checked_metadata(driver.get_tables(&schema.name), &mut on_progress, &progress)
                    .await?;

            for (ordinal, table) in tables.iter().enumerate() {
                progress.stage = MetadataIndexStage::TableColumns;
                progress.object_name = Some(table.name.clone());
                progress.object_current = Some(ordinal as u64 + 1);
                progress.object_total = Some(tables.len() as u64);
                check_cancel(&mut on_progress, &progress)?;
                push_index_entry(
                    &mut entries,
                    table_entry(connection, schema, table),
                    capacity,
                );
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
                let columns = checked_metadata(
                    driver.get_columns(&schema.name, &table.name),
                    &mut on_progress,
                    &progress,
                )
                .await?;
                append_columns(connection, schema, table, &mut entries, columns, capacity);
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
            }
            if capacity_reached {
                break;
            }

            progress.stage(MetadataIndexStage::Views);
            let views =
                checked_metadata(driver.get_views(&schema.name), &mut on_progress, &progress)
                    .await?;
            for (ordinal, view) in views.iter().enumerate() {
                progress.stage = MetadataIndexStage::ViewColumns;
                progress.object_name = Some(view.name.clone());
                progress.object_current = Some(ordinal as u64 + 1);
                progress.object_total = Some(views.len() as u64);
                check_cancel(&mut on_progress, &progress)?;
                push_index_entry(&mut entries, view_entry(connection, schema, view), capacity);
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
                let columns = checked_metadata(
                    driver.get_columns(&schema.name, &view.name),
                    &mut on_progress,
                    &progress,
                )
                .await?;
                append_columns(connection, schema, view, &mut entries, columns, capacity);
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
            }
            if capacity_reached {
                break;
            }

            progress.stage(MetadataIndexStage::Functions);
            let functions = checked_metadata(
                driver.get_functions(&schema.name),
                &mut on_progress,
                &progress,
            )
            .await?;
            for function in functions {
                push_index_entry(
                    &mut entries,
                    function_entry(connection, schema, &function),
                    capacity,
                );
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
            }

            current += 1;
            progress.current = current;
            progress.schema_name = None;
            check_cancel(&mut on_progress, &progress)?;

            // Keep the task responsive between schemas for cancellation checks in callers.
            if current < schema_total {
                tokio::task::yield_now().await;
            }
        }

        progress.stage(MetadataIndexStage::Finalizing);
        progress.schema_name = None;
        // Presentation only; the existing cancellation guard still runs under
        // the commit lock below.
        check_cancel(&mut on_progress, &progress)?;
        let entry_count = entries.len();
        let mut indexed = self.state.write().await;
        check_cancel(&mut on_progress, &progress)?;
        if indexed.generations.get(&connection.id).copied() != Some(generation) {
            return Err(AppError::ConfigError(
                "metadata index invalidated; retry the index".to_string(),
            ));
        }
        while indexed
            .entries
            .iter()
            .filter(|(id, _)| **id != connection.id)
            .map(|(_, values)| values.len())
            .sum::<usize>()
            + entries.len()
            > MAX_METADATA_INDEX_ENTRIES_TOTAL
        {
            let Some(evicted) = indexed
                .entries
                .keys()
                .copied()
                .find(|id| *id != connection.id)
            else {
                break;
            };
            indexed.entries.remove(&evicted);
        }
        indexed.entries.insert(connection.id, entries);
        Ok(MetadataIndexSummary {
            connection_id: connection.id,
            entry_count,
            capacity_reached,
        })
    }

    pub async fn search(
        &self,
        query: &str,
        connection_id: Option<Uuid>,
        limit: usize,
    ) -> Vec<MetadataSearchResult> {
        let normalized = query.trim().to_lowercase();
        if normalized.is_empty() {
            return Vec::new();
        }

        let state = self.state.read().await;
        let candidates = state
            .entries
            .iter()
            .filter(|(id, _)| connection_id.is_none_or(|target| target == **id))
            .flat_map(|(_, entries)| entries.iter());
        let mut results = Vec::with_capacity(limit);
        for entry in candidates {
            let Some(score) = score_entry(entry, &normalized) else {
                continue;
            };
            let result = MetadataSearchResult {
                entry: entry.clone(),
                score,
            };
            if results.len() < limit {
                results.push(result);
                continue;
            }
            let Some((worst_index, worst)) = results
                .iter()
                .enumerate()
                .min_by(|(_, left), (_, right)| compare_search_results(left, right))
            else {
                continue;
            };
            if compare_search_results(&result, worst).is_gt() {
                results[worst_index] = result;
            }
        }

        results.sort_by(|left, right| compare_search_results(right, left));
        results
    }

    pub async fn clear_connection(&self, connection_id: Uuid) {
        let mut state = self.state.write().await;
        state.entries.remove(&connection_id);
        let generation = state.generations.entry(connection_id).or_default();
        *generation = generation.wrapping_add(1);
    }

    pub async fn clear_all(&self) {
        let mut state = self.state.write().await;
        state.entries.clear();
        for generation in state.generations.values_mut() {
            *generation = generation.wrapping_add(1);
        }
    }

    #[cfg(test)]
    async fn replace_connection_entries(
        &self,
        connection_id: Uuid,
        entries: Vec<MetadataIndexEntry>,
    ) {
        let mut state = self.state.write().await;
        state.entries.insert(connection_id, entries);
    }

    #[cfg(test)]
    async fn reserve_generation_for_test(&self, connection_id: Uuid) -> u64 {
        let mut state = self.state.write().await;
        let generation = state.generations.entry(connection_id).or_default();
        *generation = generation.wrapping_add(1);
        *generation
    }

    #[cfg(test)]
    async fn generation_is_current_for_test(&self, connection_id: Uuid, generation: u64) -> bool {
        self.state
            .read()
            .await
            .generations
            .get(&connection_id)
            .copied()
            == Some(generation)
    }
}

fn compare_search_results(
    left: &MetadataSearchResult,
    right: &MetadataSearchResult,
) -> std::cmp::Ordering {
    left.score
        .cmp(&right.score)
        .then_with(|| right.entry.path.cmp(&left.entry.path))
}

fn supported_metadata<T>(result: Result<Vec<T>, AppError>) -> Result<Vec<T>, AppError> {
    match result {
        Ok(values) => Ok(values),
        Err(AppError::UnsupportedOperation { .. }) => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn check_cancel(
    on_progress: &mut impl FnMut(&MetadataIndexProgress) -> bool,
    progress: &MetadataIndexProgress,
) -> Result<(), AppError> {
    if on_progress(progress) {
        Ok(())
    } else {
        Err(AppError::ConfigError("metadata indexing cancelled".into()))
    }
}

async fn checked_metadata<T>(
    call: impl std::future::Future<Output = Result<Vec<T>, AppError>>,
    on_progress: &mut (impl FnMut(&MetadataIndexProgress) -> bool + Send),
    progress: &MetadataIndexProgress,
) -> Result<Vec<T>, AppError> {
    check_cancel(on_progress, progress)?;
    let result = call.await;
    check_cancel(on_progress, progress)?;
    supported_metadata(result)
}

fn append_columns(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    table: &TableInfo,
    entries: &mut Vec<MetadataIndexEntry>,
    columns: Vec<ColumnInfo>,
    capacity: usize,
) {
    for column in columns {
        push_index_entry(
            entries,
            column_entry(connection, schema, table, &column),
            capacity,
        );
        if !has_capacity(entries, capacity) {
            break;
        }
    }
}

fn has_capacity(entries: &[MetadataIndexEntry], capacity: usize) -> bool {
    entries.len() < capacity
}

fn push_index_entry(
    entries: &mut Vec<MetadataIndexEntry>,
    entry: MetadataIndexEntry,
    capacity: usize,
) {
    if entries.len() < capacity {
        entries.push(entry);
    }
}

fn connection_entry(connection: &ConnectionConfig) -> MetadataIndexEntry {
    MetadataIndexEntry {
        connection_id: connection.id,
        connection_name: connection.name.clone(),
        kind: MetadataIndexKind::Connection,
        name: connection.name.clone(),
        database: connection.database.clone(),
        schema: None,
        table: None,
        path: vec![connection.name.clone()],
    }
}

fn database_entry(connection: &ConnectionConfig, database: &DatabaseInfo) -> MetadataIndexEntry {
    MetadataIndexEntry {
        connection_id: connection.id,
        connection_name: connection.name.clone(),
        kind: MetadataIndexKind::Database,
        name: database.name.clone(),
        database: Some(database.name.clone()),
        schema: None,
        table: None,
        path: vec![connection.name.clone(), database.name.clone()],
    }
}

fn schema_entry(connection: &ConnectionConfig, schema: &SchemaInfo) -> MetadataIndexEntry {
    MetadataIndexEntry {
        connection_id: connection.id,
        connection_name: connection.name.clone(),
        kind: MetadataIndexKind::Schema,
        name: schema.name.clone(),
        database: schema
            .database
            .clone()
            .or_else(|| connection.database.clone()),
        schema: Some(schema.name.clone()),
        table: None,
        path: vec![connection.name.clone(), schema.name.clone()],
    }
}

fn table_entry(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    table: &TableInfo,
) -> MetadataIndexEntry {
    object_entry(connection, schema, table, table_kind(&table.table_type))
}

fn view_entry(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    view: &TableInfo,
) -> MetadataIndexEntry {
    object_entry(connection, schema, view, MetadataIndexKind::View)
}

fn object_entry(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    table: &TableInfo,
    kind: MetadataIndexKind,
) -> MetadataIndexEntry {
    MetadataIndexEntry {
        connection_id: connection.id,
        connection_name: connection.name.clone(),
        kind,
        name: table.name.clone(),
        database: schema
            .database
            .clone()
            .or_else(|| connection.database.clone()),
        schema: Some(schema.name.clone()),
        table: Some(table.name.clone()),
        path: vec![
            connection.name.clone(),
            schema.name.clone(),
            table.name.clone(),
        ],
    }
}

fn function_entry(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    function: &str,
) -> MetadataIndexEntry {
    MetadataIndexEntry {
        connection_id: connection.id,
        connection_name: connection.name.clone(),
        kind: MetadataIndexKind::Function,
        name: function.to_string(),
        database: schema
            .database
            .clone()
            .or_else(|| connection.database.clone()),
        schema: Some(schema.name.clone()),
        table: None,
        path: vec![
            connection.name.clone(),
            schema.name.clone(),
            function.to_string(),
        ],
    }
}

fn column_entry(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    table: &TableInfo,
    column: &ColumnInfo,
) -> MetadataIndexEntry {
    MetadataIndexEntry {
        connection_id: connection.id,
        connection_name: connection.name.clone(),
        kind: MetadataIndexKind::Column,
        name: column.name.clone(),
        database: schema
            .database
            .clone()
            .or_else(|| connection.database.clone()),
        schema: Some(schema.name.clone()),
        table: Some(table.name.clone()),
        path: vec![
            connection.name.clone(),
            schema.name.clone(),
            table.name.clone(),
            column.name.clone(),
        ],
    }
}

fn table_kind(table_type: &TableType) -> MetadataIndexKind {
    match table_type {
        TableType::View | TableType::MaterializedView => MetadataIndexKind::View,
        _ => MetadataIndexKind::Table,
    }
}

fn score_entry(entry: &MetadataIndexEntry, query: &str) -> Option<u16> {
    let name = entry.name.to_lowercase();
    let path = entry.path.join(".").to_lowercase();
    if name == query {
        Some(100)
    } else if name.starts_with(query) {
        Some(80)
    } else if name.contains(query) {
        Some(60)
    } else if path.contains(query) {
        Some(40)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        drivers::trait_def::DatabaseDriver,
        models::{
            connection::ConnectionConfig,
            error::AppError,
            metadata::{
                ColumnInfo, DatabaseInfo, DriverCapabilities, ForeignKeyInfo, IndexInfo,
                SchemaInfo, TableInfo, TableType,
            },
            query_result::{ExplainResult, QueryResult, QueryResultChunk, QueryStreamSummary},
        },
    };
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};
    use uuid::Uuid;

    use super::{MetadataIndexEntry, MetadataIndexKind, MetadataIndexService};

    struct IndexDriver {
        fail_at: Option<&'static str>,
        error: fn() -> AppError,
        empty: bool,
        calls: Option<Arc<Mutex<Vec<String>>>>,
        catalog: Option<Arc<Catalog>>,
    }

    #[derive(Default)]
    struct Catalog {
        tables: usize,
        columns: usize,
        views: bool,
        cancel: Option<(crate::services::task_manager::TaskManager, Uuid)>,
        pause: Option<(
            &'static str,
            Arc<tokio::sync::Notify>,
            Arc<tokio::sync::Notify>,
        )>,
    }

    impl Catalog {
        async fn boundary(&self, stage: &str) {
            if let Some((at, started, resume)) = &self.pause {
                if *at == stage {
                    started.notify_one();
                    resume.notified().await;
                }
            }
        }
        fn objects(&self, views: bool) -> Vec<TableInfo> {
            (0..if self.views == views { self.tables } else { 0 })
                .map(|ordinal| TableInfo {
                    name: format!("object_{ordinal}"),
                    schema: Some("public".into()),
                    table_type: if views {
                        TableType::View
                    } else {
                        TableType::Table
                    },
                    row_count: None,
                })
                .collect()
        }
    }

    #[tokio::test]
    async fn single_schema_progress_fixture() {
        let service = MetadataIndexService::new();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let driver = catalog_driver(
            Catalog {
                tables: 1000,
                columns: 1,
                ..Catalog::default()
            },
            &calls,
        );
        let mut during_columns = Vec::new();
        service
            .index_connection(&config(), driver, true, |progress| {
                if calls
                    .lock()
                    .unwrap()
                    .last()
                    .is_some_and(|call| call == "columns")
                {
                    during_columns.push((progress.current, progress.total));
                }
                true
            })
            .await
            .unwrap();
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .filter(|call| call.as_str() == "columns")
                .count(),
            1000
        );
        assert!(during_columns.len() >= 1000);
        assert!(during_columns
            .iter()
            .all(|position| *position == (0, Some(1))));
    }

    #[tokio::test]
    async fn object_progress_is_monotonic_and_stages_describe_known_work() {
        use super::MetadataIndexStage::*;
        for views in [false, true] {
            let service = MetadataIndexService::new();
            let calls = Arc::new(Mutex::new(Vec::new()));
            let mut updates = Vec::new();
            let config = config();
            let driver = catalog_driver(
                Catalog {
                    tables: 1000,
                    columns: 1,
                    views,
                    ..Catalog::default()
                },
                &calls,
            );
            service
                .index_connection(&config, driver.clone(), true, |progress| {
                    if updates.last() != Some(progress) {
                        updates.push(progress.clone());
                    }
                    true
                })
                .await
                .unwrap();
            let mut stages: Vec<_> = updates.iter().map(|p| p.stage).collect();
            stages.dedup();
            assert_eq!(
                stages,
                if views {
                    vec![
                        Databases,
                        Schemas,
                        Tables,
                        Views,
                        ViewColumns,
                        Functions,
                        Finalizing,
                    ]
                } else {
                    vec![
                        Databases,
                        Schemas,
                        Tables,
                        TableColumns,
                        Views,
                        Functions,
                        Finalizing,
                    ]
                }
            );
            let objects: Vec<_> = updates
                .iter()
                .filter(|p| p.stage == if views { ViewColumns } else { TableColumns })
                .collect();
            assert_eq!(objects.len(), 1000);
            for (ordinal, progress) in objects.iter().enumerate() {
                assert_eq!(progress.object_current, Some(ordinal as u64 + 1));
                assert_eq!(progress.object_total, Some(1000));
                assert_eq!(progress.schema_name.as_deref(), Some("public"));
                assert_eq!(progress.object_name, Some(format!("object_{ordinal}")));
                assert_eq!((progress.current, progress.total), (0, Some(1)));
            }
            assert!(updates.iter().all(|p| p.object_total != Some(0)));
            let finalizing = updates.last().unwrap();
            assert_eq!(finalizing.stage, Finalizing);
            assert_eq!(finalizing.current, 1);
            assert!(finalizing.object_name.is_none());
            let calls_before = calls.lock().unwrap().len();
            let mut cached_updates = 0;
            service
                .index_connection(&config, driver, false, |_| {
                    cached_updates += 1;
                    true
                })
                .await
                .unwrap();
            assert_eq!(cached_updates, 0);
            assert_eq!(calls.lock().unwrap().len(), calls_before);
        }
    }

    #[tokio::test]
    async fn cancel_capacity_overlap_retains_previous_index() {
        use crate::services::task_manager::{TaskManager, TaskStatus};
        let service = MetadataIndexService::new();
        let config = config();
        let driver = |catalog| {
            Arc::new(IndexDriver {
                fail_at: None,
                error: permission_error,
                empty: false,
                calls: None,
                catalog: Some(Arc::new(catalog)),
            })
        };
        let old = service
            .index_connection(
                &config,
                driver(Catalog {
                    tables: 1,
                    columns: 10,
                    ..Catalog::default()
                }),
                true,
                |_| true,
            )
            .await
            .unwrap();
        assert_eq!(old.entry_count, 14);
        let manager = TaskManager::new();
        let task = manager.create_task("metadata-index", "overlap", None).await;
        let handle = manager.handle(task.id).await.unwrap();
        let result = service
            .index_connection(
                &config,
                driver(Catalog {
                    tables: 6000,
                    columns: 50_000,
                    views: false,
                    cancel: Some((manager.clone(), task.id)),
                    ..Catalog::default()
                }),
                true,
                |_| !handle.is_cancel_requested(),
            )
            .await;
        assert!(
            matches!(&result, Err(AppError::ConfigError(message)) if message == "metadata indexing cancelled")
        );
        let terminal =
            crate::commands::metadata::finish_metadata_index_task(&manager, &handle, result)
                .await
                .unwrap();
        assert_eq!(terminal.status, TaskStatus::Cancelled);
        assert_eq!(service.state.read().await.entries[&config.id].len(), 14);
    }

    fn permission_error() -> AppError {
        AppError::QueryFailed {
            sql: "metadata fixture".into(),
            message: "permission denied".into(),
        }
    }

    fn catalog_driver(
        catalog: Catalog,
        calls: &Arc<Mutex<Vec<String>>>,
    ) -> Arc<dyn DatabaseDriver> {
        Arc::new(IndexDriver {
            fail_at: None,
            error: permission_error,
            empty: false,
            calls: Some(calls.clone()),
            catalog: Some(Arc::new(catalog)),
        })
    }

    #[tokio::test]
    async fn mid_schema_cancel_stops_table_and_view_columns() {
        use crate::services::task_manager::{TaskManager, TaskStatus};
        for views in [false, true] {
            for existing in [false, true] {
                let service = MetadataIndexService::new();
                let config = config();
                let calls = Arc::new(Mutex::new(Vec::new()));
                if existing {
                    service
                        .index_connection(
                            &config,
                            catalog_driver(
                                Catalog {
                                    tables: 1,
                                    columns: 10,
                                    ..Catalog::default()
                                },
                                &calls,
                            ),
                            true,
                            |_| true,
                        )
                        .await
                        .unwrap();
                }
                let before =
                    serde_json::to_value(service.state.read().await.entries.get(&config.id))
                        .unwrap();
                calls.lock().unwrap().clear();
                let manager = TaskManager::new();
                let task = manager
                    .create_task("metadata-index", "mid-schema", None)
                    .await;
                let handle = manager.handle(task.id).await.unwrap();
                let result = service
                    .index_connection(
                        &config,
                        catalog_driver(
                            Catalog {
                                tables: 1000,
                                columns: 1,
                                views,
                                cancel: Some((manager.clone(), task.id)),
                                ..Catalog::default()
                            },
                            &calls,
                        ),
                        true,
                        |_| !handle.is_cancel_requested(),
                    )
                    .await;
                assert!(result.is_err());
                let terminal = crate::commands::metadata::finish_metadata_index_task(
                    &manager, &handle, result,
                )
                .await
                .unwrap();
                assert_eq!(terminal.status, TaskStatus::Cancelled);
                let count = calls
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|call| *call == "columns")
                    .count();
                assert_eq!(count, 1);
                assert_eq!(
                    serde_json::to_value(service.state.read().await.entries.get(&config.id))
                        .unwrap(),
                    before
                );
            }
        }
    }

    #[tokio::test]
    async fn capacity_only_commits_and_skips_remaining_calls() {
        use crate::services::task_manager::{TaskManager, TaskStatus};
        let service = MetadataIndexService::new();
        let config = config();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = service
            .index_connection(
                &config,
                catalog_driver(
                    Catalog {
                        tables: 6000,
                        columns: 10,
                        ..Catalog::default()
                    },
                    &calls,
                ),
                true,
                |_| true,
            )
            .await;
        let summary = result.as_ref().unwrap();
        assert_eq!(summary.entry_count, 50_000);
        assert!(summary.capacity_reached);
        assert_eq!(service.state.read().await.entries[&config.id].len(), 50_000);
        let recorded = calls.lock().unwrap().clone();
        assert_eq!(
            recorded.iter().filter(|call| *call == "columns").count(),
            4546
        );
        assert!(!recorded
            .iter()
            .any(|call| call == "views" || call == "functions"));
        let manager = TaskManager::new();
        let task = manager
            .create_task("metadata-index", "capacity", None)
            .await;
        let handle = manager.handle(task.id).await.unwrap();
        let terminal =
            crate::commands::metadata::finish_metadata_index_task(&manager, &handle, result)
                .await
                .unwrap();
        assert_eq!(terminal.status, TaskStatus::Succeeded);
    }

    #[tokio::test]
    async fn cancellation_before_work_and_during_every_metadata_call_never_commits() {
        use crate::services::task_manager::TaskManager;
        for stage in [
            "before",
            "databases",
            "schemas",
            "tables",
            "columns",
            "views",
            "functions",
        ] {
            let service = MetadataIndexService::new();
            let config = config();
            let calls = Arc::new(Mutex::new(Vec::new()));
            let manager = TaskManager::new();
            let task = manager.create_task("metadata-index", stage, None).await;
            let handle = manager.handle(task.id).await.unwrap();
            let started = Arc::new(tokio::sync::Notify::new());
            let resume = Arc::new(tokio::sync::Notify::new());
            if stage == "before" {
                manager.request_cancel(task.id).await.unwrap();
            }
            let driver = catalog_driver(
                Catalog {
                    tables: 1,
                    columns: 1,
                    pause: Some((stage, started.clone(), resume.clone())),
                    ..Catalog::default()
                },
                &calls,
            );
            let (result, ()) = tokio::join!(
                service.index_connection(&config, driver, true, |_| !handle.is_cancel_requested()),
                async {
                    if stage != "before" {
                        started.notified().await;
                        manager.request_cancel(task.id).await.unwrap();
                        resume.notify_one();
                    }
                }
            );
            assert!(
                matches!(result, Err(AppError::ConfigError(message)) if message == "metadata indexing cancelled")
            );
            assert!(!service.state.read().await.entries.contains_key(&config.id));
            if stage == "before" {
                assert!(calls.lock().unwrap().is_empty());
            }
        }
    }

    #[tokio::test]
    async fn cancellation_while_waiting_to_commit_preserves_old_index() {
        use crate::services::task_manager::TaskManager;
        let service = MetadataIndexService::new();
        let config = config();
        let calls = Arc::new(Mutex::new(Vec::new()));
        service
            .index_connection(
                &config,
                catalog_driver(
                    Catalog {
                        tables: 1,
                        columns: 10,
                        ..Catalog::default()
                    },
                    &calls,
                ),
                true,
                |_| true,
            )
            .await
            .unwrap();
        let manager = TaskManager::new();
        let task = manager.create_task("metadata-index", "commit", None).await;
        let handle = manager.handle(task.id).await.unwrap();
        let started = Arc::new(tokio::sync::Notify::new());
        let resume = Arc::new(tokio::sync::Notify::new());
        let driver = catalog_driver(
            Catalog {
                pause: Some(("functions", started.clone(), resume.clone())),
                ..Catalog::default()
            },
            &calls,
        );
        let mut build = Box::pin(
            service.index_connection(&config, driver, true, |_| !handle.is_cancel_requested()),
        );
        tokio::select! {
            _ = started.notified() => {}
            result = &mut build => panic!("unexpected completion: {result:?}"),
        }
        let guard = service.state.write().await;
        resume.notify_one();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut build)
                .await
                .is_err()
        );
        manager.request_cancel(task.id).await.unwrap();
        drop(guard);
        assert!(build.await.is_err());
        assert_eq!(service.state.read().await.entries[&config.id].len(), 14);
    }

    #[tokio::test]
    async fn final_guard_rejects_capacity_even_after_all_loop_checks_pass() {
        let service = MetadataIndexService::new();
        let config = config();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = service
            .index_connection_with_limit(
                &config,
                catalog_driver(Catalog::default(), &calls),
                true,
                1,
                |_| service.state.try_read().is_ok(),
            )
            .await;
        assert!(
            matches!(result, Err(AppError::ConfigError(message)) if message == "metadata indexing cancelled")
        );
        assert!(!service.state.read().await.entries.contains_key(&config.id));
        assert!(calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn invalidated_builds_never_commit() {
        for clear in [false, true] {
            let service = MetadataIndexService::new();
            let config = config();
            let calls = Arc::new(Mutex::new(Vec::new()));
            let started = Arc::new(tokio::sync::Notify::new());
            let resume = Arc::new(tokio::sync::Notify::new());
            let driver = catalog_driver(
                Catalog {
                    pause: Some(("functions", started.clone(), resume.clone())),
                    ..Catalog::default()
                },
                &calls,
            );
            let (result, ()) = tokio::join!(
                service.index_connection(&config, driver, true, |_| true),
                async {
                    started.notified().await;
                    if clear {
                        service.clear_connection(config.id).await;
                    } else {
                        service
                            .index_connection(
                                &config,
                                catalog_driver(
                                    Catalog {
                                        tables: 1,
                                        columns: 10,
                                        ..Catalog::default()
                                    },
                                    &calls,
                                ),
                                true,
                                |_| true,
                            )
                            .await
                            .unwrap();
                    }
                    resume.notify_one();
                }
            );
            assert!(
                matches!(result, Err(AppError::ConfigError(message)) if message.contains("invalidated"))
            );
            assert_eq!(
                service
                    .state
                    .read()
                    .await
                    .entries
                    .get(&config.id)
                    .map(Vec::len),
                if clear { None } else { Some(14) }
            );
        }
    }

    impl IndexDriver {
        fn metadata<T>(&self, operation: &str, values: Vec<T>) -> Result<Vec<T>, AppError> {
            if let Some(calls) = &self.calls {
                calls.lock().unwrap().push(operation.to_string());
            }
            if self.fail_at == Some(operation) {
                return Err((self.error)());
            }
            Ok(if self.empty { Vec::new() } else { values })
        }
        fn unsupported(&self) -> AppError {
            AppError::UnsupportedOperation {
                driver: "index fixture".into(),
                operation: "unused fixture operation".into(),
            }
        }
    }

    #[async_trait]
    impl DatabaseDriver for IndexDriver {
        fn driver_name(&self) -> &'static str {
            "index fixture"
        }
        fn capabilities(&self) -> DriverCapabilities {
            DriverCapabilities {
                has_database: true,
                has_schema: true,
                supports_transactions: false,
                supports_explain: false,
                supports_cancel: false,
                supports_ddl: false,
                supports_streaming: false,
            }
        }
        async fn ping(&self) -> Result<(), AppError> {
            Ok(())
        }
        async fn execute_query(&self, _: &str, _: Option<&str>) -> Result<QueryResult, AppError> {
            Err(self.unsupported())
        }
        async fn execute_query_stream(
            &self,
            _: &str,
            _: &str,
            _: usize,
            _: Option<u64>,
            _: tokio::sync::mpsc::Sender<Result<QueryResultChunk, AppError>>,
        ) -> Result<QueryStreamSummary, AppError> {
            Err(self.unsupported())
        }
        async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
            if let Some(catalog) = &self.catalog {
                catalog.boundary("databases").await;
            }
            self.metadata("databases", vec![DatabaseInfo { name: "app".into() }])
        }
        async fn get_schemas(&self, _: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
            if let Some(catalog) = &self.catalog {
                catalog.boundary("schemas").await;
            }
            self.metadata(
                "schemas",
                vec![SchemaInfo {
                    name: "public".into(),
                    database: Some("app".into()),
                }],
            )
        }
        async fn get_tables(&self, _: &str) -> Result<Vec<TableInfo>, AppError> {
            if let Some(catalog) = &self.catalog {
                catalog.boundary("tables").await;
                return self.metadata("tables", catalog.objects(false));
            }
            self.metadata(
                "tables",
                vec![TableInfo {
                    name: "kept".into(),
                    schema: Some("public".into()),
                    table_type: TableType::Table,
                    row_count: None,
                }],
            )
        }
        async fn get_views(&self, _: &str) -> Result<Vec<TableInfo>, AppError> {
            if let Some(catalog) = &self.catalog {
                catalog.boundary("views").await;
                return self.metadata("views", catalog.objects(true));
            }
            self.metadata("views", Vec::new())
        }
        async fn get_functions(&self, _: &str) -> Result<Vec<String>, AppError> {
            if let Some(catalog) = &self.catalog {
                catalog.boundary("functions").await;
            }
            self.metadata("functions", Vec::new())
        }
        async fn get_columns(&self, _: &str, _: &str) -> Result<Vec<ColumnInfo>, AppError> {
            if let Some(catalog) = &self.catalog {
                catalog.boundary("columns").await;
                if let Some((manager, task_id)) = &catalog.cancel {
                    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                    manager.request_cancel(*task_id).await.unwrap();
                }
                return self.metadata("columns", (0..catalog.columns).map(|ordinal| {
                    serde_json::from_value(serde_json::json!({ "table": "large", "name": format!("column_{ordinal}"), "ordinalPosition": ordinal + 1, "dataType": "INTEGER", "nullable": false, "isPrimaryKey": false })).unwrap()
                }).collect());
            }
            self.metadata("columns", vec![serde_json::from_value(serde_json::json!({ "table": "kept", "name": "id", "ordinalPosition": 1, "dataType": "INTEGER", "nullable": false, "isPrimaryKey": true })).unwrap()])
        }
        async fn get_indexes(&self, _: &str, _: &str) -> Result<Vec<IndexInfo>, AppError> {
            Err(self.unsupported())
        }
        async fn get_foreign_keys(
            &self,
            _: &str,
            _: &str,
        ) -> Result<Vec<ForeignKeyInfo>, AppError> {
            Err(self.unsupported())
        }
        async fn get_table_ddl(&self, _: &str, _: &str) -> Result<String, AppError> {
            Err(self.unsupported())
        }
        async fn explain_query(&self, _: &str, _: Option<&str>) -> Result<ExplainResult, AppError> {
            Err(self.unsupported())
        }
        async fn cancel_query(&self, _: &str) -> Result<(), AppError> {
            Err(self.unsupported())
        }
    }

    fn config() -> ConnectionConfig {
        serde_json::from_value(serde_json::json!({ "id": Uuid::new_v4(), "name": "Fixture", "driverType": "postgres", "driverPaths": [], "createdAt": chrono::Utc::now(), "updatedAt": chrono::Utc::now() })).unwrap()
    }

    #[tokio::test]
    async fn capacity_stop_skips_columns_and_later_metadata_requests() {
        let service = MetadataIndexService::new();
        let config = config();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let mut progress = Vec::new();
        let summary = service
            .index_connection_with_limit(
                &config,
                Arc::new(IndexDriver {
                    fail_at: None,
                    error: permission_error,
                    empty: false,
                    calls: Some(calls.clone()),
                    catalog: None,
                }),
                true,
                4,
                |value| {
                    progress.push(value.clone());
                    true
                },
            )
            .await
            .unwrap();

        assert_eq!(summary.entry_count, 4);
        assert!(summary.capacity_reached);
        let calls = calls.lock().unwrap().clone();
        assert_eq!(calls, ["databases", "schemas", "tables"]);
        assert!(progress
            .iter()
            .all(|value| { value.total.is_none_or(|total| value.current <= total) }));
    }

    async fn assert_failed_refresh(stage: &'static str, error: fn() -> AppError) {
        for existing in [false, true] {
            let service = MetadataIndexService::new();
            let config = config();
            if existing {
                service
                    .index_connection(
                        &config,
                        Arc::new(IndexDriver {
                            fail_at: None,
                            error: permission_error,
                            empty: false,
                            calls: None,
                            catalog: None,
                        }),
                        false,
                        |_| true,
                    )
                    .await
                    .unwrap();
            }
            let before =
                serde_json::to_value(service.state.read().await.entries.get(&config.id)).unwrap();
            let result = service
                .index_connection(
                    &config,
                    Arc::new(IndexDriver {
                        fail_at: Some(stage),
                        error,
                        empty: false,
                        calls: None,
                        catalog: None,
                    }),
                    true,
                    |_| true,
                )
                .await;
            assert_eq!(result.unwrap_err().code(), error().code());
            assert_eq!(
                serde_json::to_value(service.state.read().await.entries.get(&config.id)).unwrap(),
                before
            );
        }
    }

    #[tokio::test]
    async fn permission_errors_propagate_at_every_stage_and_never_commit_partial_entries() {
        for stage in [
            "databases",
            "schemas",
            "tables",
            "views",
            "functions",
            "columns",
        ] {
            assert_failed_refresh(stage, permission_error).await;
        }
    }

    #[tokio::test]
    async fn connection_timeout_and_serialization_errors_preserve_the_previous_index() {
        assert_failed_refresh("tables", || AppError::ConnectionFailed {
            driver: "fixture".into(),
            message: "connection lost".into(),
        })
        .await;
        assert_failed_refresh("columns", || AppError::Timeout {
            operation: "metadata".into(),
            elapsed_ms: 1,
        })
        .await;
        assert_failed_refresh("functions", || {
            AppError::SerializationError("malformed metadata".into())
        })
        .await;
        assert_failed_refresh("columns", || {
            AppError::ResultLimitExceeded("metadata result budget".into())
        })
        .await;
    }

    #[tokio::test]
    async fn unsupported_metadata_is_skipped_without_hiding_real_errors() {
        for stage in [
            "databases",
            "schemas",
            "tables",
            "views",
            "functions",
            "columns",
        ] {
            let service = MetadataIndexService::new();
            let config = config();
            let summary = service
                .index_connection(
                    &config,
                    Arc::new(IndexDriver {
                        fail_at: Some(stage),
                        error: || AppError::UnsupportedOperation {
                            driver: "fixture".into(),
                            operation: "metadata".into(),
                        },
                        empty: false,
                        calls: None,
                        catalog: None,
                    }),
                    true,
                    |_| true,
                )
                .await
                .unwrap();
            assert!(summary.entry_count >= 1);
        }
    }

    #[tokio::test]
    async fn truly_empty_metadata_successfully_commits_a_minimal_index() {
        let service = MetadataIndexService::new();
        let config = config();
        let summary = service
            .index_connection(
                &config,
                Arc::new(IndexDriver {
                    fail_at: None,
                    error: permission_error,
                    empty: true,
                    calls: None,
                    catalog: None,
                }),
                false,
                |_| true,
            )
            .await
            .unwrap();
        assert_eq!(summary.entry_count, 1);
        assert_eq!(service.search("kept", Some(config.id), 10).await.len(), 0);
    }

    #[tokio::test]
    async fn search_returns_matching_entries_with_connection_path() {
        let service = MetadataIndexService::new();
        let connection_id = Uuid::new_v4();
        service
            .replace_connection_entries(
                connection_id,
                vec![MetadataIndexEntry {
                    connection_id,
                    connection_name: "Local PostgreSQL".to_string(),
                    kind: MetadataIndexKind::Table,
                    name: "orders".to_string(),
                    database: Some("postgres".to_string()),
                    schema: Some("public".to_string()),
                    table: Some("orders".to_string()),
                    path: vec![
                        "Local PostgreSQL".to_string(),
                        "public".to_string(),
                        "orders".to_string(),
                    ],
                }],
            )
            .await;

        let results = service.search("ord", None, 10).await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entry.connection_id, connection_id);
        assert_eq!(
            results[0].entry.path.join("."),
            "Local PostgreSQL.public.orders"
        );
    }

    #[tokio::test]
    async fn clear_invalidates_an_index_that_is_still_building() {
        let service = MetadataIndexService::new();
        let connection_id = Uuid::new_v4();
        let old = service.reserve_generation_for_test(connection_id).await;
        service.clear_connection(connection_id).await;
        assert!(
            !service
                .generation_is_current_for_test(connection_id, old)
                .await
        );
        let newest = service.reserve_generation_for_test(connection_id).await;
        assert!(
            service
                .generation_is_current_for_test(connection_id, newest)
                .await
        );
    }

    #[tokio::test]
    async fn newer_force_index_cannot_be_overwritten_by_older_completion() {
        let service = MetadataIndexService::new();
        let connection_id = Uuid::new_v4();
        let old = service.reserve_generation_for_test(connection_id).await;
        let newest = service.reserve_generation_for_test(connection_id).await;
        assert!(
            !service
                .generation_is_current_for_test(connection_id, old)
                .await
        );
        assert!(
            service
                .generation_is_current_for_test(connection_id, newest)
                .await
        );
    }
}
