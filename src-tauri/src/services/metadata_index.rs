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
    entries: Arc<RwLock<HashMap<Uuid, Vec<MetadataIndexEntry>>>>,
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
        mut on_progress: F,
    ) -> Result<MetadataIndexSummary, AppError>
    where
        F: FnMut(MetadataIndexProgress) -> bool + Send,
    {
        if !force {
            let entries = self.entries.read().await;
            if let Some(existing) = entries.get(&connection.id) {
                return Ok(MetadataIndexSummary {
                    connection_id: connection.id,
                    entry_count: existing.len(),
                });
            }
        }

        let mut entries = vec![connection_entry(connection)];
        let mut current = 1;
        if !on_progress(MetadataIndexProgress {
            current,
            total: None,
        }) {
            return Err(AppError::ConfigError(
                "metadata indexing cancelled".to_string(),
            ));
        }

        let databases = driver.get_databases().await.unwrap_or_default();
        for database in &databases {
            push_index_entry(&mut entries, database_entry(connection, database));
        }
        current += databases.len() as u64;
        if !on_progress(MetadataIndexProgress {
            current,
            total: None,
        }) {
            return Err(AppError::ConfigError(
                "metadata indexing cancelled".to_string(),
            ));
        }

        let schemas = driver.get_schemas(connection.database.as_deref()).await?;
        let schema_total = schemas.len() as u64;
        for (schema_index, schema) in schemas.iter().enumerate() {
            if entries.len() >= MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION {
                break;
            }
            push_index_entry(&mut entries, schema_entry(connection, schema));

            let tables = driver.get_tables(&schema.name).await.unwrap_or_default();
            let views = driver.get_views(&schema.name).await.unwrap_or_default();
            let functions = driver.get_functions(&schema.name).await.unwrap_or_default();
            current += 1 + tables.len() as u64 + views.len() as u64 + functions.len() as u64;

            for table in &tables {
                push_index_entry(&mut entries, table_entry(connection, schema, table));
                append_columns(connection, schema, table, &mut entries, &driver).await;
                if entries.len() >= MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION {
                    break;
                }
            }
            for view in &views {
                push_index_entry(&mut entries, view_entry(connection, schema, view));
                append_columns(connection, schema, view, &mut entries, &driver).await;
                if entries.len() >= MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION {
                    break;
                }
            }
            for function in functions {
                push_index_entry(&mut entries, function_entry(connection, schema, &function));
                if entries.len() >= MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION {
                    break;
                }
            }

            if !on_progress(MetadataIndexProgress {
                current,
                total: Some(1 + databases.len() as u64 + schema_total),
            }) {
                return Err(AppError::ConfigError(
                    "metadata indexing cancelled".to_string(),
                ));
            }

            // Keep the task responsive between schemas for cancellation checks in callers.
            if schema_index + 1 < schemas.len() {
                tokio::task::yield_now().await;
            }
        }

        let entry_count = entries.len();
        let mut indexed = self.entries.write().await;
        while indexed
            .iter()
            .filter(|(id, _)| **id != connection.id)
            .map(|(_, values)| values.len())
            .sum::<usize>()
            + entries.len()
            > MAX_METADATA_INDEX_ENTRIES_TOTAL
        {
            let Some(evicted) = indexed.keys().copied().find(|id| *id != connection.id) else {
                break;
            };
            indexed.remove(&evicted);
        }
        indexed.insert(connection.id, entries);
        Ok(MetadataIndexSummary {
            connection_id: connection.id,
            entry_count,
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

        let entries = self.entries.read().await;
        let candidates = entries
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
        self.entries.write().await.remove(&connection_id);
    }

    pub async fn clear_all(&self) {
        self.entries.write().await.clear();
    }

    #[cfg(test)]
    async fn replace_connection_entries(
        &self,
        connection_id: Uuid,
        entries: Vec<MetadataIndexEntry>,
    ) {
        self.entries.write().await.insert(connection_id, entries);
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

async fn append_columns(
    connection: &ConnectionConfig,
    schema: &SchemaInfo,
    table: &TableInfo,
    entries: &mut Vec<MetadataIndexEntry>,
    driver: &Arc<dyn DatabaseDriver>,
) {
    let columns = driver
        .get_columns(&schema.name, &table.name)
        .await
        .unwrap_or_default();
    for column in columns {
        push_index_entry(entries, column_entry(connection, schema, table, &column));
        if entries.len() >= MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION {
            break;
        }
    }
}

fn push_index_entry(entries: &mut Vec<MetadataIndexEntry>, entry: MetadataIndexEntry) {
    if entries.len() < MAX_METADATA_INDEX_ENTRIES_PER_CONNECTION {
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
    use uuid::Uuid;

    use super::{MetadataIndexEntry, MetadataIndexKind, MetadataIndexService};

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
}
