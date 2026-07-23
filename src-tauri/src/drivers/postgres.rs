use std::{collections::HashMap, sync::Mutex, time::Instant};

use async_trait::async_trait;
use futures_util::{pin_mut, TryStreamExt};
use tokio::{sync::mpsc, task::JoinHandle};
use tokio_postgres::{
    types::{Json, ToSql, Type},
    CancelToken, Client, Config, NoTls, Row, Statement,
};

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

pub struct PostgresDriver {
    client: Client,
    cancel_token: CancelToken,
    active_queries: Mutex<HashMap<String, CancelToken>>,
    _connection_task: JoinHandle<()>,
}

impl PostgresDriver {
    pub async fn connect(connection_url: &str) -> Result<Self, AppError> {
        let (client, connection) = tokio_postgres::connect(connection_url, NoTls)
            .await
            .map_err(|error| AppError::ConnectionFailed {
                driver: "postgres".to_string(),
                message: error.to_string(),
            })?;

        let connection_task = tokio::spawn(async move {
            if let Err(error) = connection.await {
                log::error!("postgres connection task failed: {error}");
            }
        });

        Ok(Self {
            cancel_token: client.cancel_token(),
            client,
            active_queries: Mutex::new(HashMap::new()),
            _connection_task: connection_task,
        })
    }

    pub async fn connect_with_params(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, AppError> {
        if host.contains('=') || database.contains('=') || username.contains('=') {
            return Err(AppError::ConfigError(
                "PostgreSQL host/database/username should be plain values, not key=value connection strings"
                    .to_string(),
            ));
        }

        let mut config = Config::new();
        config
            .host(host)
            .port(port)
            .dbname(database)
            .user(username)
            .password(password);

        let (client, connection) =
            config
                .connect(NoTls)
                .await
                .map_err(|error| AppError::ConnectionFailed {
                    driver: "postgres".to_string(),
                    message: error.to_string(),
                })?;

        let connection_task = tokio::spawn(async move {
            if let Err(error) = connection.await {
                log::error!("postgres connection task failed: {error}");
            }
        });

        Ok(Self {
            cancel_token: client.cancel_token(),
            client,
            active_queries: Mutex::new(HashMap::new()),
            _connection_task: connection_task,
        })
    }

    fn map_query_error(&self, sql: &str, error: tokio_postgres::Error) -> AppError {
        AppError::QueryFailed {
            sql: sql.to_string(),
            message: error.to_string(),
        }
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn driver_name(&self) -> &'static str {
        "postgres"
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            has_database: true,
            has_schema: true,
            supports_transactions: true,
            supports_explain: true,
            supports_cancel: true,
            supports_ddl: true,
            supports_streaming: true,
        }
    }

    fn supports_concurrent_queries(&self) -> bool {
        true
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.client
            .simple_query("SELECT 1")
            .await
            .map_err(|error| AppError::ConnectionFailed {
                driver: "postgres".to_string(),
                message: error.to_string(),
            })?;
        Ok(())
    }

    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let _query_registration = self.register_query(query_id);

        if !returns_rows(sql) {
            let affected_rows = self
                .client
                .execute(sql, &[])
                .await
                .map_err(|error| self.map_query_error(sql, error))?;
            return Ok(QueryResult::empty(
                start.elapsed().as_millis() as u64,
                affected_rows,
            ));
        }

        let rows = self
            .client
            .query(sql, &[])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows_to_query_result(
            rows,
            start.elapsed().as_millis() as u64,
        ))
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
        let _query_registration = self.register_query(Some(query_id));
        let chunk_size = chunk_size.max(1);

        if !returns_rows(sql) {
            let affected_rows = self
                .client
                .execute(sql, &[])
                .await
                .map_err(|error| self.map_query_error(sql, error))?;
            return Ok(QueryStreamSummary {
                query_id: query_id.to_string(),
                row_count: 0,
                affected_rows,
                elapsed_ms: start.elapsed().as_millis() as u64,
                truncated: false,
                max_rows,
            });
        }

        let statement = self
            .client
            .prepare(sql)
            .await
            .map_err(|error| self.map_query_error(sql, error))?;
        let params = std::iter::empty::<&(dyn ToSql + Sync)>();
        let stream = self
            .client
            .query_raw(&statement, params)
            .await
            .map_err(|error| self.map_query_error(sql, error))?;
        pin_mut!(stream);
        let mut row_count = 0_u64;
        let mut row_offset = 0_u64;
        let mut truncated = false;
        let mut columns = columns_from_statement(&statement);
        let mut rows: Vec<Vec<serde_json::Value>> = Vec::with_capacity(chunk_size);

        while let Some(row) = stream
            .try_next()
            .await
            .map_err(|error| self.map_query_error(sql, error))?
        {
            if max_rows.is_some_and(|limit| row_count >= limit) {
                truncated = true;
                break;
            }

            if columns.is_empty() {
                columns = columns_from_row(&row);
            }

            rows.push(row_to_json_values(&row));
            row_count += 1;

            if rows.len() >= chunk_size {
                send_query_chunk(&chunks, query_id, &columns, &mut rows, row_offset).await?;
                row_offset = row_count;
            }
        }

        if !rows.is_empty() || !columns.is_empty() {
            send_query_chunk(&chunks, query_id, &columns, &mut rows, row_offset).await?;
        }

        Ok(QueryStreamSummary {
            query_id: query_id.to_string(),
            row_count,
            affected_rows: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
            max_rows,
        })
    }

    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
        let sql = "
            SELECT datname
            FROM pg_database
            WHERE datistemplate = false
            ORDER BY datname
        ";

        let rows = self
            .client
            .query(sql, &[])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows
            .into_iter()
            .map(|row| DatabaseInfo { name: row.get(0) })
            .collect())
    }

    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        let sql = "
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT LIKE 'pg_%'
              AND schema_name <> 'information_schema'
            ORDER BY schema_name
        ";

        let rows = self
            .client
            .query(sql, &[])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows
            .into_iter()
            .map(|row| SchemaInfo {
                name: row.get(0),
                database: database.map(str::to_string),
            })
            .collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let sql = "
            SELECT table_schema, table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = $1
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        ";

        let rows = self
            .client
            .query(sql, &[&schema])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows.into_iter().map(table_info_from_row).collect())
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        let sql = "
            SELECT
                c.table_schema,
                c.table_name,
                c.column_name,
                c.ordinal_position,
                c.data_type,
                c.is_nullable = 'YES' AS nullable,
                c.column_default,
                c.character_maximum_length::bigint,
                c.numeric_precision,
                c.numeric_scale,
                EXISTS (
                    SELECT 1
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                     AND tc.table_name = kcu.table_name
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_schema = c.table_schema
                      AND tc.table_name = c.table_name
                      AND kcu.column_name = c.column_name
                ) AS is_primary_key
            FROM information_schema.columns c
            WHERE c.table_schema = $1
              AND c.table_name = $2
            ORDER BY c.ordinal_position
        ";

        let rows = self
            .client
            .query(sql, &[&schema, &table])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows.into_iter().map(column_info_from_row).collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
        let sql = "
            SELECT
                schemaname,
                tablename,
                indexname,
                indexdef,
                indisunique,
                COALESCE(array_agg(a.attname::text ORDER BY key_order.ordinality)
                    FILTER (WHERE a.attname IS NOT NULL), '{}') AS columns
            FROM pg_indexes i
            JOIN pg_class tbl
              ON tbl.relname = i.tablename
            JOIN pg_namespace ns
              ON ns.oid = tbl.relnamespace
             AND ns.nspname = i.schemaname
            JOIN pg_class idx
              ON idx.relname = i.indexname
             AND idx.relnamespace = ns.oid
            JOIN pg_index pgidx
              ON pgidx.indexrelid = idx.oid
            LEFT JOIN LATERAL unnest(pgidx.indkey) WITH ORDINALITY AS key_order(attnum, ordinality)
              ON true
            LEFT JOIN pg_attribute a
              ON a.attrelid = tbl.oid
             AND a.attnum = key_order.attnum
            WHERE i.schemaname = $1
              AND i.tablename = $2
            GROUP BY i.schemaname, i.tablename, i.indexname, i.indexdef, pgidx.indisunique
            ORDER BY i.indexname
        ";

        let rows = self
            .client
            .query(sql, &[&schema, &table])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows
            .into_iter()
            .map(|row| IndexInfo {
                schema: Some(row.get(0)),
                table: row.get(1),
                name: row.get(2),
                definition: row.get(3),
                unique: row.get(4),
                columns: row.get::<_, Vec<String>>(5),
            })
            .collect())
    }

    async fn get_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let sql = "
            SELECT
                tc.table_schema,
                tc.table_name,
                tc.constraint_name,
                array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS columns,
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                array_agg(ccu.column_name::text ORDER BY kcu.ordinal_position) AS foreign_columns
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2
            GROUP BY tc.table_schema, tc.table_name, tc.constraint_name, ccu.table_schema, ccu.table_name
            ORDER BY tc.constraint_name
        ";

        let rows = self
            .client
            .query(sql, &[&schema, &table])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows
            .into_iter()
            .map(|row| ForeignKeyInfo {
                schema: Some(row.get(0)),
                table: row.get(1),
                name: row.get(2),
                columns: row.get(3),
                referenced_schema: Some(row.get(4)),
                referenced_table: row.get(5),
                referenced_columns: row.get(6),
            })
            .collect())
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let sql = "
            SELECT table_schema, table_name, 'VIEW' AS table_type
            FROM information_schema.views
            WHERE table_schema = $1
            ORDER BY table_name
        ";

        let rows = self
            .client
            .query(sql, &[&schema])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows.into_iter().map(table_info_from_row).collect())
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let sql = "
            SELECT routine_name
            FROM information_schema.routines
            WHERE routine_schema = $1
            ORDER BY routine_name
        ";

        let rows = self
            .client
            .query(sql, &[&schema])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows.into_iter().map(|row| row.get(0)).collect())
    }

    async fn get_schema_objects(
        &self,
        schema: &str,
        kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        if !matches!(kind, DbObjectKind::Trigger) {
            return Ok(Vec::new());
        }

        let sql = "
            SELECT
                n.nspname AS schema_name,
                t.tgname AS trigger_name,
                CASE t.tgenabled
                    WHEN 'O' THEN 'ENABLED'
                    WHEN 'D' THEN 'DISABLED'
                    WHEN 'R' THEN 'REPLICA'
                    WHEN 'A' THEN 'ALWAYS'
                    ELSE NULL
                END AS status
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND NOT t.tgisinternal
            ORDER BY t.tgname
        ";

        let rows = self
            .client
            .query(sql, &[&schema])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        Ok(rows
            .into_iter()
            .map(|row| DbObjectInfo {
                schema: Some(row.get(0)),
                name: row.get(1),
                kind: DbObjectKind::Trigger,
                object_type: Some("TRIGGER".to_string()),
                status: row.get(2),
            })
            .collect())
    }

    async fn get_object_ddl(
        &self,
        schema: &str,
        name: &str,
        kind: DbObjectKind,
    ) -> Result<String, AppError> {
        if matches!(
            kind,
            DbObjectKind::Table | DbObjectKind::View | DbObjectKind::MaterializedView
        ) {
            return self.get_table_ddl(schema, name).await;
        }

        if !matches!(kind, DbObjectKind::Trigger) {
            return Err(AppError::UnsupportedOperation {
                driver: self.driver_name().to_string(),
                operation: "get_object_ddl".to_string(),
            });
        }

        let sql = "
            SELECT pg_get_triggerdef(t.oid, true)
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND t.tgname = $2
              AND NOT t.tgisinternal
            ORDER BY c.relname
            LIMIT 1
        ";
        let row = self
            .client
            .query_opt(sql, &[&schema, &name])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        row.map(|row| row.get(0)).ok_or_else(|| AppError::NotFound {
            resource: "trigger".to_string(),
            id: format!("{schema}.{name}"),
        })
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let columns = self.get_columns(schema, table).await?;
        if columns.is_empty() {
            return Err(AppError::NotFound {
                resource: "table".to_string(),
                id: format!("{schema}.{table}"),
            });
        }

        let indexes = self.get_indexes(schema, table).await?;
        let foreign_keys = self.get_foreign_keys(schema, table).await?;
        let primary_key_columns: Vec<String> = columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| quote_identifier(&column.name))
            .collect();

        let mut lines = Vec::new();
        for column in columns {
            let mut line = format!(
                "  {} {}",
                quote_identifier(&column.name),
                normalize_pg_type(&column)
            );

            if !column.nullable {
                line.push_str(" NOT NULL");
            }

            if let Some(default_value) = column.default_value {
                line.push_str(" DEFAULT ");
                line.push_str(&default_value);
            }

            lines.push(line);
        }

        if !primary_key_columns.is_empty() {
            lines.push(format!(
                "  PRIMARY KEY ({})",
                primary_key_columns.join(", ")
            ));
        }

        let mut ddl = format!(
            "CREATE TABLE {}.{} (\n{}\n);",
            quote_identifier(schema),
            quote_identifier(table),
            lines.join(",\n")
        );

        for foreign_key in foreign_keys {
            ddl.push_str(&format!(
                "\n\nALTER TABLE {}.{} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {}.{} ({});",
                quote_identifier(schema),
                quote_identifier(table),
                quote_identifier(&foreign_key.name),
                foreign_key
                    .columns
                    .iter()
                    .map(|column| quote_identifier(column))
                    .collect::<Vec<_>>()
                    .join(", "),
                quote_identifier(foreign_key.referenced_schema.as_deref().unwrap_or(schema)),
                quote_identifier(&foreign_key.referenced_table),
                foreign_key
                    .referenced_columns
                    .iter()
                    .map(|column| quote_identifier(column))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        for index in indexes {
            if !index.unique || !index.name.ends_with("_pkey") {
                if let Some(definition) = index.definition {
                    ddl.push_str("\n\n");
                    ddl.push_str(&definition);
                    ddl.push(';');
                }
            }
        }

        Ok(ddl)
    }

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        let explain_sql = format!("EXPLAIN (FORMAT JSON) {sql}");
        let start = Instant::now();
        let rows = self
            .client
            .query(&explain_sql, &[])
            .await
            .map_err(|error| self.map_query_error(&explain_sql, error))?;

        let plan = rows
            .first()
            .map(|row| row.get::<_, Json<serde_json::Value>>(0).0)
            .unwrap_or_else(|| serde_json::json!([]));

        Ok(ExplainResult {
            format: ExplainFormat::Json,
            plan,
            result: None,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn cancel_query(&self, query_id: &str) -> Result<(), AppError> {
        let token = self
            .active_queries
            .lock()
            .map_err(|_| AppError::ConfigError("active query registry is poisoned".to_string()))?
            .get(query_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound {
                resource: "active query".to_string(),
                id: query_id.to_string(),
            })?;

        token
            .cancel_query(NoTls)
            .await
            .map_err(|error| AppError::QueryFailed {
                sql: "<cancel>".to_string(),
                message: error.to_string(),
            })
    }

    async fn cancel_all_queries(&self) -> Result<(), AppError> {
        let tokens = self
            .active_queries
            .lock()
            .map_err(|_| AppError::ConfigError("active query registry is poisoned".to_string()))?
            .values()
            .cloned()
            .collect::<Vec<_>>();

        for token in tokens {
            let _ = token.cancel_query(NoTls).await;
        }

        Ok(())
    }
}

impl PostgresDriver {
    fn register_query<'a>(&'a self, query_id: Option<&str>) -> QueryRegistration<'a> {
        let Some(query_id) = query_id.filter(|value| !value.is_empty()) else {
            return QueryRegistration {
                driver: self,
                query_id: None,
            };
        };

        if let Ok(mut active_queries) = self.active_queries.lock() {
            active_queries.insert(query_id.to_string(), self.cancel_token.clone());
        }

        QueryRegistration {
            driver: self,
            query_id: Some(query_id.to_string()),
        }
    }
}

struct QueryRegistration<'a> {
    driver: &'a PostgresDriver,
    query_id: Option<String>,
}

impl Drop for QueryRegistration<'_> {
    fn drop(&mut self) {
        let Some(query_id) = self.query_id.as_deref() else {
            return;
        };

        if let Ok(mut active_queries) = self.driver.active_queries.lock() {
            active_queries.remove(query_id);
        }
    }
}

fn rows_to_query_result(rows: Vec<Row>, elapsed_ms: u64) -> QueryResult {
    let columns = rows.first().map(columns_from_row).unwrap_or_default();

    let row_count = rows.len() as u64;
    let rows = rows.iter().map(row_to_json_values).collect();

    QueryResult {
        columns,
        rows,
        row_count,
        elapsed_ms,
        affected_rows: 0,
        query_id: None,
        truncated: false,
        max_rows: None,
    }
}

fn columns_from_row(row: &Row) -> Vec<ColumnMeta> {
    row.columns()
        .iter()
        .map(|column| ColumnMeta {
            name: column.name().to_string(),
            data_type: column.type_().name().to_string(),
            nullable: true,
        })
        .collect()
}

fn columns_from_statement(statement: &Statement) -> Vec<ColumnMeta> {
    statement
        .columns()
        .iter()
        .map(|column| ColumnMeta {
            name: column.name().to_string(),
            data_type: column.type_().name().to_string(),
            nullable: true,
        })
        .collect()
}

async fn send_query_chunk(
    chunks: &mpsc::Sender<Result<QueryResultChunk, AppError>>,
    query_id: &str,
    columns: &[ColumnMeta],
    rows: &mut Vec<Vec<serde_json::Value>>,
    row_offset: u64,
) -> Result<(), AppError> {
    let chunk = QueryResultChunk {
        query_id: query_id.to_string(),
        columns: columns.to_vec(),
        rows: std::mem::take(rows),
        row_offset,
    };

    chunks
        .send(Ok(chunk))
        .await
        .map_err(|_| AppError::ConfigError("query stream receiver dropped".to_string()))
}

fn row_to_json_values(row: &Row) -> Vec<serde_json::Value> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| value_to_json(row, index, column.type_()))
        .collect()
}

fn value_to_json(row: &Row, index: usize, pg_type: &Type) -> serde_json::Value {
    if matches!(pg_type, &Type::BOOL) {
        optional_to_json(row.try_get::<_, Option<bool>>(index))
    } else if matches!(
        pg_type,
        &Type::INT2 | &Type::INT4 | &Type::OID | &Type::XID | &Type::CID
    ) {
        optional_to_json(row.try_get::<_, Option<i32>>(index))
    } else if matches!(pg_type, &Type::INT8) {
        optional_to_json(row.try_get::<_, Option<i64>>(index))
    } else if matches!(pg_type, &Type::FLOAT4) {
        optional_to_json(row.try_get::<_, Option<f32>>(index))
    } else if matches!(pg_type, &Type::FLOAT8) {
        optional_to_json(row.try_get::<_, Option<f64>>(index))
    } else if matches!(pg_type, &Type::JSON | &Type::JSONB) {
        row.try_get::<_, Option<Json<serde_json::Value>>>(index)
            .ok()
            .flatten()
            .map(|value| value.0)
            .unwrap_or(serde_json::Value::Null)
    } else {
        row.try_get::<_, Option<String>>(index)
            .ok()
            .flatten()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null)
    }
}

fn optional_to_json<T>(value: Result<Option<T>, tokio_postgres::Error>) -> serde_json::Value
where
    T: serde::Serialize,
{
    value
        .ok()
        .flatten()
        .and_then(|value| serde_json::to_value(value).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn table_info_from_row(row: Row) -> TableInfo {
    let table_type = match row.get::<_, String>(2).as_str() {
        "BASE TABLE" => TableType::Table,
        "VIEW" => TableType::View,
        other => TableType::Other(other.to_string()),
    };

    TableInfo {
        schema: Some(row.get(0)),
        name: row.get(1),
        table_type,
        row_count: None,
    }
}

fn column_info_from_row(row: Row) -> ColumnInfo {
    ColumnInfo {
        schema: Some(row.get(0)),
        table: row.get(1),
        name: row.get(2),
        ordinal_position: row.get(3),
        data_type: row.get(4),
        nullable: row.get(5),
        default_value: row.get(6),
        character_maximum_length: row.get(7),
        numeric_precision: row.get(8),
        numeric_scale: row.get(9),
        is_primary_key: row.get(10),
    }
}

fn normalize_pg_type(column: &ColumnInfo) -> String {
    match column.data_type.as_str() {
        "character varying" => column
            .character_maximum_length
            .map(|length| format!("varchar({length})"))
            .unwrap_or_else(|| "varchar".to_string()),
        "character" => column
            .character_maximum_length
            .map(|length| format!("char({length})"))
            .unwrap_or_else(|| "char".to_string()),
        "numeric" => match (column.numeric_precision, column.numeric_scale) {
            (Some(precision), Some(scale)) => format!("numeric({precision}, {scale})"),
            (Some(precision), None) => format!("numeric({precision})"),
            _ => "numeric".to_string(),
        },
        other => other.to_string(),
    }
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
fn escape_param(value: &str) -> String {
    value.replace('\\', "\\\\").replace(' ', "\\ ")
}

fn returns_rows(sql: &str) -> bool {
    let sql = sql.trim_start().to_ascii_lowercase();
    ["select", "with", "show", "explain", "values", "table"]
        .iter()
        .any(|keyword| sql.starts_with(keyword))
        || sql.contains(" returning ")
}

#[cfg(test)]
mod tests {
    use super::{escape_param, quote_identifier, returns_rows};

    #[test]
    fn quotes_identifiers() {
        assert_eq!(quote_identifier("user"), "\"user\"");
        assert_eq!(quote_identifier("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn escapes_connection_params() {
        assert_eq!(escape_param("pass word"), "pass\\ word");
    }

    #[test]
    fn detects_row_returning_statements() {
        assert!(returns_rows("select 1"));
        assert!(returns_rows("insert into t values (1) returning id"));
        assert!(!returns_rows("update t set name = 'returning'"));
    }
}
