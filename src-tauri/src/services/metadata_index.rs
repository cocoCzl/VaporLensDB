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

#[derive(Debug, Clone, Copy)]
pub struct MetadataIndexProgress {
    pub current: u64,
    pub total: Option<u64>,
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
        F: FnMut(MetadataIndexProgress) -> bool + Send,
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
        F: FnMut(MetadataIndexProgress) -> bool + Send,
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
        F: FnMut(MetadataIndexProgress) -> bool + Send,
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
        if !on_progress(MetadataIndexProgress {
            current: 0,
            total: None,
        }) {
            return Err(AppError::ConfigError(
                "metadata indexing cancelled".to_string(),
            ));
        }

        let mut capacity_reached = false;
        if has_capacity(&entries, capacity) {
            let databases = supported_metadata(driver.get_databases().await)?;
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

        let schemas = if has_capacity(&entries, capacity) {
            supported_metadata(driver.get_schemas(connection.database.as_deref()).await)?
        } else {
            Vec::new()
        };
        let schema_total = schemas.len() as u64;
        if !on_progress(MetadataIndexProgress {
            current: 0,
            total: Some(schema_total),
        }) {
            return Err(AppError::ConfigError(
                "metadata indexing cancelled".to_string(),
            ));
        }

        let mut current = 0_u64;
        for schema in &schemas {
            if !has_capacity(&entries, capacity) {
                capacity_reached = true;
                break;
            }
            push_index_entry(&mut entries, schema_entry(connection, schema), capacity);
            if !has_capacity(&entries, capacity) {
                capacity_reached = true;
                break;
            }

            let tables = supported_metadata(driver.get_tables(&schema.name).await)?;

            for table in &tables {
                push_index_entry(
                    &mut entries,
                    table_entry(connection, schema, table),
                    capacity,
                );
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
                append_columns(connection, schema, table, &mut entries, &driver, capacity).await?;
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
            }
            if capacity_reached {
                break;
            }

            let views = supported_metadata(driver.get_views(&schema.name).await)?;
            for view in &views {
                push_index_entry(&mut entries, view_entry(connection, schema, view), capacity);
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
                append_columns(connection, schema, view, &mut entries, &driver, capacity).await?;
                if !has_capacity(&entries, capacity) {
                    capacity_reached = true;
                    break;
                }
            }
            if capacity_reached {
                break;
            }

            let functions = supported_metadata(driver.get_functions(&schema.name).await)?;
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
            if !on_progress(MetadataIndexProgress {
                current,
                total: Some(schema_total),
            }) {
                return Err(AppError::ConfigError(
                    "metadata indexing cancelled".to_string(),
                ));
            }

            // Keep the task responsive between schemas for cancellation checks in callers.
            if current < schema_total {
                tokio::task::yield_now().await;
            }
        }

        let entry_count = entries.len();
        let mut indexed = self.state.write().await;
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

async fn append_columns(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    table: &TableInfo,
    entries: &mut Vec<MetadataIndexEntry>,
    driver: &Arc<dyn DatabaseDriver>,
    capacity: usize,
) -> Result<(), AppError> {
    if !has_capacity(entries, capacity) {
        return Ok(());
    }
    let columns = supported_metadata(driver.get_columns(&schema.name, &table.name).await)?;
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
    Ok(())
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
    }

    fn permission_error() -> AppError {
        AppError::QueryFailed {
            sql: "metadata fixture".into(),
            message: "permission denied".into(),
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
            self.metadata("databases", vec![DatabaseInfo { name: "app".into() }])
        }
        async fn get_schemas(&self, _: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
            self.metadata(
                "schemas",
                vec![SchemaInfo {
                    name: "public".into(),
                    database: Some("app".into()),
                }],
            )
        }
        async fn get_tables(&self, _: &str) -> Result<Vec<TableInfo>, AppError> {
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
            self.metadata("views", Vec::new())
        }
        async fn get_functions(&self, _: &str) -> Result<Vec<String>, AppError> {
            self.metadata("functions", Vec::new())
        }
        async fn get_columns(&self, _: &str, _: &str) -> Result<Vec<ColumnInfo>, AppError> {
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
                }),
                true,
                4,
                |value| {
                    progress.push(value);
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
