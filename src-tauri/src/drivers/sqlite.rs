use std::{collections::BTreeMap, path::Path, sync::Arc, time::Instant};

use async_trait::async_trait;
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use tokio::{sync::mpsc, task};

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        error::AppError,
        metadata::{
            ColumnInfo, DatabaseInfo, DbObjectInfo, DbObjectKind, DriverCapabilities,
            ForeignKeyInfo, IndexInfo, SchemaInfo, TableInfo, TableType,
        },
        query_result::{
            ColumnMeta, ExplainFormat, ExplainResult, QueryResult, QueryResultChunk,
            QueryStreamSummary,
        },
    },
};

const SQLITE_SCHEMA_MAIN: &str = "main";

pub struct SqliteDriver {
    path: Arc<String>,
    database_name: String,
}

impl SqliteDriver {
    pub async fn connect(path: &str) -> Result<Self, AppError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(AppError::ConfigError(
                "SQLite database path is required".to_string(),
            ));
        }

        let normalized = path.to_string();
        let path_for_open = normalized.clone();
        task::spawn_blocking(move || open_sqlite_connection(&path_for_open))
            .await
            .map_err(|error| {
                AppError::IoError(format!("failed to join SQLite connect task: {error}"))
            })??;

        Ok(Self {
            database_name: sqlite_database_name(path),
            path: Arc::new(normalized),
        })
    }

    async fn with_connection<T, F>(
        &self,
        operation: &'static str,
        task_fn: F,
    ) -> Result<T, AppError>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
    {
        let path = Arc::clone(&self.path);
        task::spawn_blocking(move || {
            let connection = open_sqlite_connection(path.as_str())?;
            task_fn(&connection)
        })
        .await
        .map_err(|error| {
            AppError::IoError(format!("failed to join SQLite {operation} task: {error}"))
        })?
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    fn driver_name(&self) -> &'static str {
        "sqlite"
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            has_database: true,
            has_schema: true,
            supports_transactions: true,
            supports_explain: true,
            supports_cancel: false,
            supports_ddl: true,
            supports_streaming: false,
        }
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.with_connection("ping", |connection| {
            connection
                .execute_batch("SELECT 1;")
                .map_err(AppError::from)
        })
        .await
    }

    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let sql = sql.to_string();
        let query_id = query_id.map(str::to_string);
        self.with_connection("query", move |connection| {
            execute_sqlite_query(connection, &sql, query_id)
        })
        .await
    }

    async fn execute_query_stream(
        &self,
        sql: &str,
        query_id: &str,
        chunk_size: usize,
        max_rows: Option<u64>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
    ) -> Result<QueryStreamSummary, AppError> {
        let start = Instant::now();
        let result = self.execute_query(sql, Some(query_id)).await?;
        let limit = max_rows.unwrap_or(result.rows.len() as u64) as usize;
        let truncated = result.rows.len() > limit;
        let rows = result.rows.into_iter().take(limit).collect::<Vec<_>>();
        let chunk_size = chunk_size.max(1);
        let mut row_offset = 0_u64;

        for chunk_rows in rows.chunks(chunk_size) {
            chunks
                .send(Ok(QueryResultChunk {
                    query_id: query_id.to_string(),
                    columns: result.columns.clone(),
                    rows: chunk_rows.to_vec(),
                    row_offset,
                }))
                .await
                .map_err(|_| AppError::ConfigError("query stream receiver dropped".to_string()))?;
            row_offset += chunk_rows.len() as u64;
        }

        Ok(QueryStreamSummary {
            query_id: query_id.to_string(),
            row_count: row_offset,
            affected_rows: result.affected_rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
            max_rows,
        })
    }

    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
        Ok(vec![DatabaseInfo {
            name: self.database_name.clone(),
        }])
    }

    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        Ok(vec![SchemaInfo {
            name: SQLITE_SCHEMA_MAIN.to_string(),
            database: database
                .map(str::to_string)
                .or_else(|| Some(self.database_name.clone())),
        }])
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let schema = schema.to_string();
        self.with_connection("metadata tables", move |connection| {
            let sql = r#"
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY name
            "#;
            let mut statement = connection.prepare(sql)?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            let names = rows.collect::<Result<Vec<_>, _>>()?;
            Ok(names
                .into_iter()
                .map(|name| TableInfo {
                    schema: Some(schema.clone()),
                    name,
                    table_type: TableType::Table,
                    row_count: None,
                })
                .collect())
        })
        .await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        let schema = schema.to_string();
        let table = table.to_string();
        self.with_connection("metadata columns", move |connection| {
            let sql =
                "SELECT name, cid, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?1)";
            let mut statement = connection.prepare(sql)?;
            let rows = statement.query_map([table.as_str()], |row| {
                Ok(ColumnInfo {
                    schema: Some(schema.clone()),
                    table: table.clone(),
                    name: row.get::<_, String>(0)?,
                    ordinal_position: row.get::<_, i32>(1)? + 1,
                    data_type: row.get::<_, String>(2)?,
                    nullable: !row.get::<_, bool>(3)?,
                    default_value: row.get::<_, Option<String>>(4)?,
                    character_maximum_length: None,
                    numeric_precision: None,
                    numeric_scale: None,
                    is_primary_key: row.get::<_, i32>(5)? > 0,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
        .await
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
        let schema = schema.to_string();
        let table = table.to_string();
        self.with_connection("metadata indexes", move |connection| {
            let list_sql = "SELECT name, origin, partial, \"unique\" FROM pragma_index_list(?1)";
            let mut statement = connection.prepare(list_sql)?;
            let rows = statement.query_map([table.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })?;

            let mut indexes = Vec::new();
            for row in rows {
                let (name, origin, partial, unique) = row?;
                let mut column_statement =
                    connection.prepare("SELECT name FROM pragma_index_info(?1) ORDER BY seqno")?;
                let column_rows =
                    column_statement.query_map([name.as_str()], |row| row.get::<_, String>(0))?;
                let columns = column_rows.collect::<Result<Vec<_>, _>>()?;
                let definition = Some(format!(
                    "{}{}{}",
                    if unique { "UNIQUE " } else { "" },
                    origin.to_uppercase(),
                    if partial { " PARTIAL" } else { "" }
                ));
                indexes.push(IndexInfo {
                    schema: Some(schema.clone()),
                    table: table.clone(),
                    name,
                    columns,
                    unique,
                    definition,
                });
            }

            Ok(indexes)
        })
        .await
    }

    async fn get_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let schema = schema.to_string();
        let table = table.to_string();
        self.with_connection("metadata foreign keys", move |connection| {
            let sql = r#"
                SELECT id, seq, "table", "from", "to"
                FROM pragma_foreign_key_list(?1)
                ORDER BY id, seq
            "#;
            let mut statement = connection.prepare(sql)?;
            let rows = statement.query_map([table.as_str()], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })?;

            let mut grouped: BTreeMap<i64, ForeignKeyAccumulator> = BTreeMap::new();
            for row in rows {
                let (id, seq, referenced_table, from, to) = row?;
                let entry = grouped.entry(id).or_insert_with(|| ForeignKeyAccumulator {
                    referenced_table,
                    columns: Vec::new(),
                    referenced_columns: Vec::new(),
                });
                if entry.columns.len() <= seq as usize {
                    entry.columns.push(from);
                    entry
                        .referenced_columns
                        .push(to.unwrap_or_else(|| "rowid".to_string()));
                }
            }

            Ok(grouped
                .into_iter()
                .map(|(id, fk)| ForeignKeyInfo {
                    schema: Some(schema.clone()),
                    table: table.clone(),
                    name: format!("fk_{}_{}", table, id),
                    columns: fk.columns,
                    referenced_schema: Some(SQLITE_SCHEMA_MAIN.to_string()),
                    referenced_table: fk.referenced_table,
                    referenced_columns: fk.referenced_columns,
                })
                .collect())
        })
        .await
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let schema = schema.to_string();
        self.with_connection("metadata views", move |connection| {
            let sql = r#"
                SELECT name
                FROM sqlite_master
                WHERE type = 'view'
                ORDER BY name
            "#;
            let mut statement = connection.prepare(sql)?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            let names = rows.collect::<Result<Vec<_>, _>>()?;
            Ok(names
                .into_iter()
                .map(|name| TableInfo {
                    schema: Some(schema.clone()),
                    name,
                    table_type: TableType::View,
                    row_count: None,
                })
                .collect())
        })
        .await
    }

    async fn get_functions(&self, _schema: &str) -> Result<Vec<String>, AppError> {
        Ok(Vec::new())
    }

    async fn get_table_ddl(&self, _schema: &str, table: &str) -> Result<String, AppError> {
        let table = table.to_string();
        self.with_connection("metadata table ddl", move |connection| {
            sqlite_object_ddl(connection, &table, &["table", "view"])
        })
        .await
    }

    async fn get_schema_objects(
        &self,
        schema: &str,
        kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        let schema = schema.to_string();
        self.with_connection("metadata schema objects", move |connection| {
            let (sql, params): (&str, Vec<&str>) = match kind {
                DbObjectKind::Index => (
                    "SELECT name, type FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                    vec![],
                ),
                DbObjectKind::Trigger => (
                    "SELECT name, type FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
                    vec![],
                ),
                DbObjectKind::View => (
                    "SELECT name, type FROM sqlite_master WHERE type = 'view' ORDER BY name",
                    vec![],
                ),
                DbObjectKind::Table => (
                    "SELECT name, type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                    vec![],
                ),
                _ => return Ok(Vec::new()),
            };
            let mut statement = connection.prepare(sql)?;
            let rows = statement.query_map(rusqlite::params_from_iter(params), |row| {
                Ok(DbObjectInfo {
                    schema: Some(schema.clone()),
                    name: row.get::<_, String>(0)?,
                    kind: kind.clone(),
                    object_type: row.get::<_, String>(1).ok(),
                    status: None,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
        .await
    }

    async fn get_object_ddl(
        &self,
        _schema: &str,
        name: &str,
        kind: DbObjectKind,
    ) -> Result<String, AppError> {
        let name = name.to_string();
        self.with_connection("metadata object ddl", move |connection| {
            let object_types: &[&str] = match kind {
                DbObjectKind::Table => &["table"],
                DbObjectKind::View => &["view"],
                DbObjectKind::Index => &["index"],
                DbObjectKind::Trigger => &["trigger"],
                _ => &["table", "view", "index", "trigger"],
            };
            sqlite_object_ddl(connection, &name, object_types)
        })
        .await
    }

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        let plan_sql = format!("EXPLAIN QUERY PLAN {}", sql.trim().trim_end_matches(';'));
        let result = self.execute_query(&plan_sql, None).await?;
        Ok(ExplainResult {
            format: ExplainFormat::Json,
            plan: serde_json::to_value(result)?,
            elapsed_ms: 0,
        })
    }

    async fn cancel_query(&self, _query_id: &str) -> Result<(), AppError> {
        Err(AppError::UnsupportedOperation {
            driver: self.driver_name().to_string(),
            operation: "cancel_query".to_string(),
        })
    }
}

struct ForeignKeyAccumulator {
    referenced_table: String,
    columns: Vec<String>,
    referenced_columns: Vec<String>,
}

fn open_sqlite_connection(path: &str) -> Result<Connection, AppError> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(AppError::from)
}

fn sqlite_database_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn execute_sqlite_query(
    connection: &Connection,
    sql: &str,
    query_id: Option<String>,
) -> Result<QueryResult, AppError> {
    let start = Instant::now();
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| AppError::QueryFailed {
            sql: sql.to_string(),
            message: error.to_string(),
        })?;

    if statement.column_count() == 0 {
        let affected_rows = statement
            .execute([])
            .map_err(|error| AppError::QueryFailed {
                sql: sql.to_string(),
                message: error.to_string(),
            })? as u64;
        let mut result = QueryResult::empty(start.elapsed().as_millis() as u64, affected_rows);
        result.query_id = query_id;
        return Ok(result);
    }

    let columns = statement
        .column_names()
        .into_iter()
        .map(|name| ColumnMeta {
            name: name.to_string(),
            data_type: "UNKNOWN".to_string(),
            nullable: true,
        })
        .collect::<Vec<_>>();
    let mut rows = statement.query([]).map_err(|error| AppError::QueryFailed {
        sql: sql.to_string(),
        message: error.to_string(),
    })?;
    let mut values = Vec::new();

    while let Some(row) = rows.next().map_err(|error| AppError::QueryFailed {
        sql: sql.to_string(),
        message: error.to_string(),
    })? {
        values.push(sqlite_row_to_json_values(row, columns.len())?);
    }

    Ok(QueryResult {
        columns,
        row_count: values.len() as u64,
        rows: values,
        elapsed_ms: start.elapsed().as_millis() as u64,
        affected_rows: 0,
        query_id,
        truncated: false,
        max_rows: None,
    })
}

fn sqlite_row_to_json_values(
    row: &rusqlite::Row<'_>,
    column_count: usize,
) -> Result<Vec<serde_json::Value>, AppError> {
    let mut values = Vec::with_capacity(column_count);
    for index in 0..column_count {
        let value = row.get_ref(index).map_err(AppError::from)?;
        values.push(sqlite_value_to_json(value));
    }
    Ok(values)
}

fn sqlite_value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(value) => serde_json::json!(value),
        ValueRef::Real(value) => serde_json::json!(value),
        ValueRef::Text(value) => serde_json::json!(String::from_utf8_lossy(value).to_string()),
        ValueRef::Blob(value) => serde_json::json!(encode_hex(value)),
    }
}

fn sqlite_object_ddl(
    connection: &Connection,
    name: &str,
    object_types: &[&str],
) -> Result<String, AppError> {
    let placeholders = object_types
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT sql FROM sqlite_master WHERE name = ? AND type IN ({placeholders}) ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 9 END LIMIT 1"
    );
    let mut params = Vec::with_capacity(object_types.len() + 1);
    params.push(name);
    params.extend(object_types.iter().copied());
    connection
        .query_row(&sql, rusqlite::params_from_iter(params), |row| {
            row.get::<_, Option<String>>(0)
        })
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound {
            resource: "sqlite object ddl".to_string(),
            id: name.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::{encode_hex, sqlite_database_name, sqlite_value_to_json};
    use rusqlite::types::ValueRef;

    #[test]
    fn derives_database_name_from_path() {
        assert_eq!(sqlite_database_name("/tmp/demo.sqlite"), "demo.sqlite");
        assert_eq!(sqlite_database_name("relative.db"), "relative.db");
    }

    #[test]
    fn maps_blob_to_hex_string() {
        let value = sqlite_value_to_json(ValueRef::Blob(&[0xde, 0xad, 0xbe, 0xef]));
        assert_eq!(value, serde_json::json!("deadbeef"));
        assert_eq!(encode_hex(&[0x0a, 0x1b]), "0a1b");
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from_digit((byte >> 4) as u32, 16).unwrap_or('0'));
        output.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap_or('0'));
    }
    output
}
