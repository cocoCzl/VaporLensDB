use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::{Arc, Weak},
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
/// Maximum time since a successful load, independent of cache reads/LRU touches.
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
    loaded_at: HashMap<String, Instant>,
    // No permanent per-connection epoch map. Abandoned weak entries are pruned
    // at the next lookup; normal completion removes the last pending reference.
    pending: HashMap<String, Weak<()>>,
}

impl MetadataCache {
    fn prepare_insert(&mut self, key: &str) {
        if self.insertion_order.iter().any(|existing| existing == key) {
            self.touch(key);
            self.loaded_at.insert(key.to_string(), Instant::now());
            return;
        }
        if self.insertion_order.len() >= MAX_METADATA_CACHE_ENTRIES {
            if let Some(evicted) = self.insertion_order.pop_front() {
                self.remove_key(&evicted);
            }
        }
        self.insertion_order.push_back(key.to_string());
        self.loaded_at.insert(key.to_string(), Instant::now());
    }

    fn is_fresh(&mut self, key: &str) -> bool {
        let fresh = self
            .loaded_at
            .get(key)
            .is_some_and(|loaded| loaded.elapsed() < METADATA_CACHE_TTL);
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
        self.loaded_at.remove(key);
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
        cache.loaded_at.retain(|key, _| !key.starts_with(&prefix));
        cache.pending.retain(|key, _| !key.starts_with(&prefix));
    }

    pub async fn get_databases(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let key = cache_key(connection_id, ["databases"]);
        self.load(
            key,
            false,
            |cache, key| cache.databases.get(key).cloned(),
            |cache, key, value| {
                cache.databases.insert(key, value);
            },
            driver.get_databases(),
        )
        .await
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
        self.load(
            key,
            false,
            |cache, key| cache.schemas.get(key).cloned(),
            |cache, key, value| {
                cache.schemas.insert(key, value);
            },
            driver.get_schemas(database),
        )
        .await
    }

    pub async fn get_tables(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "tables"]);
        self.load(
            key,
            false,
            |cache, key| cache.tables.get(key).cloned(),
            |cache, key, value| {
                cache.tables.insert(key, value);
            },
            driver.get_tables(schema),
        )
        .await
    }

    pub async fn get_views(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "views"]);
        self.load(
            key,
            false,
            |cache, key| cache.views.get(key).cloned(),
            |cache, key, value| {
                cache.views.insert(key, value);
            },
            driver.get_views(schema),
        )
        .await
    }

    pub async fn get_functions(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<String>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "functions"]);
        self.load(
            key,
            false,
            |cache, key| cache.functions.get(key).cloned(),
            |cache, key, value| {
                cache.functions.insert(key, value);
            },
            driver.get_functions(schema),
        )
        .await
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
        self.load(
            key,
            false,
            |cache, key| cache.schema_objects.get(key).cloned(),
            |cache, key, value| {
                cache.schema_objects.insert(key, value);
            },
            driver.get_schema_objects(schema, kind),
        )
        .await
    }

    pub async fn get_columns(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "table", table, "columns"]);
        self.load(
            key,
            false,
            |cache, key| cache.columns.get(key).cloned(),
            |cache, key, value| {
                cache.columns.insert(key, value);
            },
            driver.get_columns(schema, table),
        )
        .await
    }

    pub async fn get_indexes(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "table", table, "indexes"]);
        self.load(
            key,
            false,
            |cache, key| cache.indexes.get(key).cloned(),
            |cache, key, value| {
                cache.indexes.insert(key, value);
            },
            driver.get_indexes(schema, table),
        )
        .await
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
        self.load(
            key,
            false,
            |cache, key| cache.foreign_keys.get(key).cloned(),
            |cache, key, value| {
                cache.foreign_keys.insert(key, value);
            },
            driver.get_foreign_keys(schema, table),
        )
        .await
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
        self.load(
            key,
            force,
            |cache, key| cache.ddls.get(key).cloned(),
            |cache, key, value| {
                cache.ddls.insert(key, value);
            },
            driver.get_table_ddl(schema, table),
        )
        .await
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
        self.load(
            key,
            force,
            |cache, key| cache.ddls.get(key).cloned(),
            |cache, key, value| {
                cache.ddls.insert(key, value);
            },
            driver.get_object_ddl(schema, name, kind),
        )
        .await
    }

    async fn load<T: Clone>(
        &self,
        key: String,
        force: bool,
        read: impl FnOnce(&MetadataCache, &str) -> Option<T>,
        write: impl FnOnce(&mut MetadataCache, String, T),
        fetch: impl Future<Output = Result<T, AppError>>,
    ) -> Result<T, AppError> {
        let token = {
            let mut cache = self.cache.write().await;
            cache.pending.retain(|_, token| token.strong_count() > 0);
            // Lookup and registration share a lock with invalidation.
            if !force && cache.is_fresh(&key) {
                if let Some(value) = read(&cache, &key) {
                    return Ok(value);
                }
            }
            if force {
                // A forced refresh never joins the prior epoch, even if it fails.
                cache.remove_key(&key);
                cache.pending.remove(&key);
            }
            let token = cache
                .pending
                .get(&key)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(()));
            cache.pending.insert(key.clone(), Arc::downgrade(&token));
            token
        };

        // No cache lock is held across database I/O.
        let result = fetch.await;
        let mut cache = self.cache.write().await;
        let current = cache
            .pending
            .get(&key)
            .is_some_and(|pending| pending.ptr_eq(&Arc::downgrade(&token)));
        if !current {
            return Err(AppError::ConfigError(
                "metadata request invalidated; retry the request".into(),
            ));
        }
        if Arc::strong_count(&token) == 1 {
            cache.pending.remove(&key);
        }
        let value = result?;
        cache.prepare_insert(&key);
        write(&mut cache, key, value.clone());
        Ok(value)
    }
}

fn cache_key<const N: usize>(connection_id: Uuid, segments: [&str; N]) -> String {
    let mut key = connection_id.to_string();
    for segment in segments {
        key.push_str("::");
        // Length prefixes prevent identifiers containing "::" from aliasing.
        key.push_str(&segment.len().to_string());
        key.push(':');
        key.push_str(segment);
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    async fn load_ddl(
        service: &MetadataService,
        key: String,
        force: bool,
        fetch: impl Future<Output = Result<String, AppError>>,
    ) -> Result<String, AppError> {
        service
            .load(
                key,
                force,
                |cache, key| cache.ddls.get(key).cloned(),
                |cache, key, value| {
                    cache.ddls.insert(key, value);
                },
                fetch,
            )
            .await
    }

    async fn pending_load(
        service: Arc<MetadataService>,
        key: String,
        force: bool,
    ) -> (
        oneshot::Sender<String>,
        tokio::task::JoinHandle<Result<String, AppError>>,
    ) {
        let (started_tx, started_rx) = oneshot::channel();
        let (finish_tx, finish_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            load_ddl(&service, key, force, async {
                started_tx.send(()).unwrap();
                Ok(finish_rx.await.unwrap())
            })
            .await
        });
        started_rx.await.unwrap();
        (finish_tx, task)
    }

    #[tokio::test]
    async fn clear_rejects_old_response_without_overwriting_new_cache() {
        let service = Arc::new(MetadataService::new());
        let id = Uuid::new_v4();
        let key = cache_key(id, ["ddl"]);
        let (finish, old) = pending_load(service.clone(), key.clone(), false).await;
        service.clear_connection(id).await;
        assert_eq!(
            load_ddl(&service, key.clone(), false, async { Ok("new".into()) })
                .await
                .unwrap(),
            "new"
        );
        finish.send("old".into()).unwrap();
        assert!(old.await.unwrap().is_err());
        assert_eq!(
            load_ddl(&service, key, false, async { panic!("must hit cache") })
                .await
                .unwrap(),
            "new"
        );
    }

    #[tokio::test]
    async fn clearing_one_connection_does_not_invalidate_another() {
        let service = Arc::new(MetadataService::new());
        let id = Uuid::new_v4();
        let other_id = Uuid::new_v4();
        let key = cache_key(id, ["ddl"]);
        let other = cache_key(other_id, ["ddl"]);
        let (finish, old) = pending_load(service.clone(), key.clone(), false).await;
        let (finish_other, pending_other) =
            pending_load(service.clone(), other.clone(), false).await;
        service.clear_connection(id).await;
        finish.send("old".into()).unwrap();
        finish_other.send("other".into()).unwrap();
        assert!(old.await.unwrap().is_err());
        assert_eq!(pending_other.await.unwrap().unwrap(), "other");
        let cache = service.cache.read().await;
        assert!(!cache.ddls.contains_key(&key));
        assert_eq!(cache.ddls.get(&other).unwrap(), "other");
        assert!(cache.pending.is_empty());
    }

    #[tokio::test]
    async fn newest_force_refresh_wins_in_either_completion_order() {
        for newest_first in [true, false] {
            let service = Arc::new(MetadataService::new());
            let key = cache_key(Uuid::new_v4(), ["ddl"]);
            let (finish_old, old) = pending_load(service.clone(), key.clone(), false).await;
            let (finish_force, force) = pending_load(service.clone(), key.clone(), true).await;
            let (finish_new, newest) = pending_load(service.clone(), key.clone(), true).await;
            if newest_first {
                finish_new.send("new".into()).unwrap();
                assert_eq!(newest.await.unwrap().unwrap(), "new");
                finish_force.send("middle".into()).unwrap();
                finish_old.send("old".into()).unwrap();
                assert!(force.await.unwrap().is_err());
                assert!(old.await.unwrap().is_err());
            } else {
                finish_force.send("middle".into()).unwrap();
                finish_old.send("old".into()).unwrap();
                assert!(force.await.unwrap().is_err());
                assert!(old.await.unwrap().is_err());
                assert!(!service.cache.read().await.ddls.contains_key(&key));
                finish_new.send("new".into()).unwrap();
                assert_eq!(newest.await.unwrap().unwrap(), "new");
            }
            assert_eq!(service.cache.read().await.ddls.get(&key).unwrap(), "new");
        }
    }

    #[tokio::test]
    async fn failed_force_does_not_resurrect_prior_cache_or_pending_result() {
        let service = Arc::new(MetadataService::new());
        let key = cache_key(Uuid::new_v4(), ["ddl"]);
        let (finish, old) = pending_load(service.clone(), key.clone(), false).await;
        load_ddl(&service, key.clone(), false, async { Ok("cached".into()) })
            .await
            .unwrap();
        assert!(load_ddl(&service, key.clone(), true, async {
            Err(AppError::ConfigError("fetch failed".into()))
        })
        .await
        .is_err());
        finish.send("old".into()).unwrap();
        assert!(old.await.unwrap().is_err());
        assert!(!service.cache.read().await.ddls.contains_key(&key));
        assert_eq!(
            load_ddl(&service, key, false, async { Ok("retry".into()) })
                .await
                .unwrap(),
            "retry"
        );
    }

    #[tokio::test]
    async fn ordinary_misses_share_epoch_and_abandoned_requests_are_pruned() {
        let service = Arc::new(MetadataService::new());
        let key = cache_key(Uuid::new_v4(), ["ddl"]);
        let (finish_one, one) = pending_load(service.clone(), key.clone(), false).await;
        let (finish_two, two) = pending_load(service.clone(), key.clone(), false).await;
        finish_one.send("one".into()).unwrap();
        assert_eq!(one.await.unwrap().unwrap(), "one");
        finish_two.send("two".into()).unwrap();
        assert_eq!(two.await.unwrap().unwrap(), "two");
        assert!(service.cache.read().await.pending.is_empty());

        for _ in 0..10 {
            let abandoned_key = cache_key(Uuid::new_v4(), ["ddl"]);
            let (_finish, task) = pending_load(service.clone(), abandoned_key, false).await;
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        }
        load_ddl(&service, key, false, async { panic!("cached") })
            .await
            .unwrap();
        assert!(service.cache.read().await.pending.is_empty());
    }

    #[test]
    fn reads_update_lru_without_extending_loaded_data_ttl() {
        let mut cache = MetadataCache::default();
        cache.prepare_insert("old");
        cache.ddls.insert("old".into(), "ddl".into());
        cache.prepare_insert("new");
        let loaded = Instant::now() - Duration::from_secs(30);
        cache.loaded_at.insert("old".into(), loaded);
        assert!(cache.is_fresh("old"));
        assert_eq!(cache.loaded_at["old"], loaded);
        assert_eq!(cache.insertion_order.back().unwrap(), "old");
        cache
            .loaded_at
            .insert("old".into(), Instant::now() - METADATA_CACHE_TTL);
        assert!(!cache.is_fresh("old"));
        assert!(!cache.ddls.contains_key("old"));
        assert!(!cache.loaded_at.contains_key("old"));
        cache.prepare_insert("old");
        assert!(cache.is_fresh("old"));
    }

    #[test]
    fn cache_keys_distinguish_delimiters_in_identifiers() {
        let id = Uuid::new_v4();
        assert_ne!(
            cache_key(id, ["schema", "a::table::b", "table", "c", "ddl"]),
            cache_key(id, ["schema", "a", "table", "b::table::c", "ddl"])
        );
        assert_ne!(cache_key(id, ["", "中文"]), cache_key(id, ["中文", ""]));
    }

    #[tokio::test]
    async fn sqlite_getters_cache_refresh_and_clear_all_metadata_kinds() {
        use crate::drivers::sqlite::SqliteDriver;

        let service = MetadataService::new();
        let id = Uuid::new_v4();
        let driver: Arc<dyn DatabaseDriver> =
            Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
        driver
            .execute_query("CREATE TABLE items (id INTEGER PRIMARY KEY)", None)
            .await
            .unwrap();
        service.get_databases(id, driver.clone()).await.unwrap();
        service.get_schemas(id, driver.clone(), None).await.unwrap();
        assert_eq!(
            service
                .get_tables(id, driver.clone(), "main")
                .await
                .unwrap()
                .len(),
            1
        );
        service.get_views(id, driver.clone(), "main").await.unwrap();
        service
            .get_functions(id, driver.clone(), "main")
            .await
            .unwrap();
        service
            .get_schema_objects(id, driver.clone(), "main", DbObjectKind::Index)
            .await
            .unwrap();
        service
            .get_columns(id, driver.clone(), "main", "items")
            .await
            .unwrap();
        service
            .get_indexes(id, driver.clone(), "main", "items")
            .await
            .unwrap();
        service
            .get_foreign_keys(id, driver.clone(), "main", "items")
            .await
            .unwrap();
        let table_ddl = service
            .get_table_ddl(id, driver.clone(), "main", "items", false)
            .await
            .unwrap();
        let object_ddl = service
            .get_object_ddl(
                id,
                driver.clone(),
                "main",
                "items",
                DbObjectKind::Table,
                false,
            )
            .await
            .unwrap();
        assert_eq!(service.cache.read().await.insertion_order.len(), 11);

        driver
            .execute_query("ALTER TABLE items ADD COLUMN label TEXT", None)
            .await
            .unwrap();
        assert_eq!(
            service
                .get_table_ddl(id, driver.clone(), "main", "items", false)
                .await
                .unwrap(),
            table_ddl
        );
        assert_eq!(
            service
                .get_object_ddl(
                    id,
                    driver.clone(),
                    "main",
                    "items",
                    DbObjectKind::Table,
                    false
                )
                .await
                .unwrap(),
            object_ddl
        );
        assert!(service
            .get_table_ddl(id, driver.clone(), "main", "items", true)
            .await
            .unwrap()
            .contains("label"));
        assert!(service
            .get_object_ddl(
                id,
                driver.clone(),
                "main",
                "items",
                DbObjectKind::Table,
                true
            )
            .await
            .unwrap()
            .contains("label"));
        assert_eq!(
            service
                .get_columns(id, driver.clone(), "main", "items")
                .await
                .unwrap()
                .len(),
            1
        );
        service.clear_connection(id).await;
        {
            let cache = service.cache.read().await;
            assert!(
                cache.databases.is_empty() && cache.schemas.is_empty() && cache.tables.is_empty()
            );
            assert!(
                cache.views.is_empty()
                    && cache.functions.is_empty()
                    && cache.schema_objects.is_empty()
            );
            assert!(
                cache.columns.is_empty()
                    && cache.indexes.is_empty()
                    && cache.foreign_keys.is_empty()
            );
            assert!(
                cache.ddls.is_empty()
                    && cache.insertion_order.is_empty()
                    && cache.loaded_at.is_empty()
            );
            assert!(cache.pending.is_empty());
        }
        assert_eq!(
            service
                .get_columns(id, driver, "main", "items")
                .await
                .unwrap()
                .len(),
            2
        );
    }

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
