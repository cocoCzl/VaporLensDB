use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::{Duration, Instant},
};

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        error::AppError,
        metadata::{
            ColumnInfo, DatabaseInfo, DbObjectInfo, DbObjectKind, ForeignKeyInfo, IndexInfo,
            SchemaInfo, TableInfo,
        },
    },
};

/// Limits metadata retained across all live Data Sources. Individual entries
/// can be large (notably column lists and DDL), so bounding entry count avoids
/// indefinite growth while preserving the existing explicit refresh behavior.
const MAX_METADATA_CACHE_ENTRIES: usize = 256;
const METADATA_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct MetadataService {
    cache: RwLock<MetadataCache>,
}

#[derive(Default)]
struct MetadataCache {
    databases: HashMap<String, Vec<DatabaseInfo>>,
    schemas: HashMap<String, Vec<SchemaInfo>>,
    tables: HashMap<String, Vec<TableInfo>>,
    views: HashMap<String, Vec<TableInfo>>,
    functions: HashMap<String, Vec<String>>,
    schema_objects: HashMap<String, Vec<DbObjectInfo>>,
    columns: HashMap<String, Vec<ColumnInfo>>,
    indexes: HashMap<String, Vec<IndexInfo>>,
    foreign_keys: HashMap<String, Vec<ForeignKeyInfo>>,
    ddls: HashMap<String, String>,
    insertion_order: VecDeque<String>,
    last_access: HashMap<String, Instant>,
}

impl MetadataCache {
    fn prepare_insert(&mut self, key: &str) {
        if self.insertion_order.iter().any(|existing| existing == key) {
            self.touch(key);
            return;
        }
        if self.insertion_order.len() >= MAX_METADATA_CACHE_ENTRIES {
            if let Some(evicted) = self.insertion_order.pop_front() {
                self.remove_key(&evicted);
            }
        }
        self.insertion_order.push_back(key.to_string());
        self.last_access.insert(key.to_string(), Instant::now());
    }

    fn is_fresh(&mut self, key: &str) -> bool {
        let fresh = self
            .last_access
            .get(key)
            .is_some_and(|accessed| accessed.elapsed() < METADATA_CACHE_TTL);
        if fresh {
            self.touch(key);
        } else {
            self.remove_key(key);
        }
        fresh
    }

    fn touch(&mut self, key: &str) {
        self.insertion_order.retain(|existing| existing != key);
        self.insertion_order.push_back(key.to_string());
        self.last_access.insert(key.to_string(), Instant::now());
    }

    fn remove_key(&mut self, key: &str) {
        self.databases.remove(key);
        self.schemas.remove(key);
        self.tables.remove(key);
        self.views.remove(key);
        self.functions.remove(key);
        self.schema_objects.remove(key);
        self.columns.remove(key);
        self.indexes.remove(key);
        self.foreign_keys.remove(key);
        self.ddls.remove(key);
        self.last_access.remove(key);
        self.insertion_order.retain(|existing| existing != key);
    }
}

impl MetadataService {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn clear_connection(&self, connection_id: Uuid) {
        let prefix = connection_id.to_string();
        let mut cache = self.cache.write().await;
        cache.databases.retain(|key, _| !key.starts_with(&prefix));
        cache.schemas.retain(|key, _| !key.starts_with(&prefix));
        cache.tables.retain(|key, _| !key.starts_with(&prefix));
        cache.views.retain(|key, _| !key.starts_with(&prefix));
        cache.functions.retain(|key, _| !key.starts_with(&prefix));
        cache
            .schema_objects
            .retain(|key, _| !key.starts_with(&prefix));
        cache.columns.retain(|key, _| !key.starts_with(&prefix));
        cache.indexes.retain(|key, _| !key.starts_with(&prefix));
        cache
            .foreign_keys
            .retain(|key, _| !key.starts_with(&prefix));
        cache.ddls.retain(|key, _| !key.starts_with(&prefix));
        cache
            .insertion_order
            .retain(|key| !key.starts_with(&prefix));
        cache.last_access.retain(|key, _| !key.starts_with(&prefix));
    }

    pub async fn get_databases(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let key = cache_key(connection_id, ["databases"]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.databases.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_databases().await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.databases.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_schemas(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        database: Option<&str>,
    ) -> Result<Vec<SchemaInfo>, AppError> {
        let key = cache_key(
            connection_id,
            ["database", database.unwrap_or(""), "schemas"],
        );
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.schemas.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_schemas(database).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.schemas.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_tables(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "tables"]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.tables.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_tables(schema).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.tables.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_views(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "views"]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.views.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_views(schema).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.views.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_functions(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<String>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "functions"]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.functions.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_functions(schema).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.functions.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_schema_objects(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        let kind_key = format!("{kind:?}");
        let key = cache_key(connection_id, ["schema", schema, "objects", &kind_key]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.schema_objects.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_schema_objects(schema, kind).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.schema_objects.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_columns(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "table", table, "columns"]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.columns.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_columns(schema, table).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.columns.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_indexes(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "table", table, "indexes"]);
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.indexes.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_indexes(schema, table).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.indexes.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_foreign_keys(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let key = cache_key(
            connection_id,
            ["schema", schema, "table", table, "foreign_keys"],
        );
        if self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.foreign_keys.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let values = driver.get_foreign_keys(schema, table).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.foreign_keys.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_table_ddl(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        table: &str,
        force: bool,
    ) -> Result<String, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "table", table, "ddl"]);
        if !force && self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.ddls.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let value = driver.get_table_ddl(schema, table).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.ddls.insert(key, value.clone());
        Ok(value)
    }

    pub async fn get_object_ddl(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        name: &str,
        kind: DbObjectKind,
        force: bool,
    ) -> Result<String, AppError> {
        let kind_key = format!("{kind:?}");
        let key = cache_key(
            connection_id,
            ["schema", schema, "object", name, &kind_key, "ddl"],
        );
        if !force && self.cache_is_fresh(&key).await {
            if let Some(cached) = self.cache.read().await.ddls.get(&key).cloned() {
                return Ok(cached);
            }
        }

        let value = driver.get_object_ddl(schema, name, kind).await?;
        let mut cache = self.cache.write().await;
        cache.prepare_insert(&key);
        cache.ddls.insert(key, value.clone());
        Ok(value)
    }

    async fn cache_is_fresh(&self, key: &str) -> bool {
        self.cache.write().await.is_fresh(key)
    }
}

fn cache_key<const N: usize>(connection_id: Uuid, segments: [&str; N]) -> String {
    let mut key = connection_id.to_string();
    for segment in segments {
        key.push_str("::");
        key.push_str(segment);
    }
    key
}

#[cfg(test)]
mod tests {
    use super::{MetadataCache, MAX_METADATA_CACHE_ENTRIES};

    #[test]
    fn bounds_metadata_cache_by_evicting_the_oldest_key() {
        let mut cache = MetadataCache::default();
        for index in 0..=MAX_METADATA_CACHE_ENTRIES {
            let key = format!("key-{index}");
            cache.prepare_insert(&key);
            cache.ddls.insert(key, "ddl".to_string());
        }
        assert_eq!(cache.insertion_order.len(), MAX_METADATA_CACHE_ENTRIES);
        assert!(!cache.ddls.contains_key("key-0"));
        assert!(cache
            .ddls
            .contains_key(&format!("key-{MAX_METADATA_CACHE_ENTRIES}")));
    }
}
