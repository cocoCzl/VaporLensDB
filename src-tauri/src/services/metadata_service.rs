use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        error::AppError,
        metadata::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo},
    },
};

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
    columns: HashMap<String, Vec<ColumnInfo>>,
    indexes: HashMap<String, Vec<IndexInfo>>,
    foreign_keys: HashMap<String, Vec<ForeignKeyInfo>>,
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
        cache.columns.retain(|key, _| !key.starts_with(&prefix));
        cache.indexes.retain(|key, _| !key.starts_with(&prefix));
        cache
            .foreign_keys
            .retain(|key, _| !key.starts_with(&prefix));
    }

    pub async fn get_databases(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
    ) -> Result<Vec<DatabaseInfo>, AppError> {
        let key = cache_key(connection_id, ["databases"]);
        if let Some(cached) = self.cache.read().await.databases.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_databases().await?;
        self.cache
            .write()
            .await
            .databases
            .insert(key, values.clone());
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
        if let Some(cached) = self.cache.read().await.schemas.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_schemas(database).await?;
        self.cache.write().await.schemas.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_tables(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "tables"]);
        if let Some(cached) = self.cache.read().await.tables.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_tables(schema).await?;
        self.cache.write().await.tables.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_views(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "views"]);
        if let Some(cached) = self.cache.read().await.views.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_views(schema).await?;
        self.cache.write().await.views.insert(key, values.clone());
        Ok(values)
    }

    pub async fn get_functions(
        &self,
        connection_id: Uuid,
        driver: Arc<dyn DatabaseDriver>,
        schema: &str,
    ) -> Result<Vec<String>, AppError> {
        let key = cache_key(connection_id, ["schema", schema, "functions"]);
        if let Some(cached) = self.cache.read().await.functions.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_functions(schema).await?;
        self.cache
            .write()
            .await
            .functions
            .insert(key, values.clone());
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
        if let Some(cached) = self.cache.read().await.columns.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_columns(schema, table).await?;
        self.cache.write().await.columns.insert(key, values.clone());
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
        if let Some(cached) = self.cache.read().await.indexes.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_indexes(schema, table).await?;
        self.cache.write().await.indexes.insert(key, values.clone());
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
        if let Some(cached) = self.cache.read().await.foreign_keys.get(&key).cloned() {
            return Ok(cached);
        }

        let values = driver.get_foreign_keys(schema, table).await?;
        self.cache
            .write()
            .await
            .foreign_keys
            .insert(key, values.clone());
        Ok(values)
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
