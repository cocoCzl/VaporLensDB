use std::str::FromStr;
use std::{collections::HashMap, sync::Mutex, time::Instant};

use async_trait::async_trait;
use futures_util::{pin_mut, TryStreamExt};
use postgres_native_tls::MakeTlsConnector;
use tokio::{sync::mpsc, task::JoinHandle};
use tokio_postgres::{
    config::SslMode,
    types::{Format, IsNull, Json, ToSql, Type},
    CancelToken, Client, Config, Row, Statement,
};

#[derive(Debug)]
struct CsvParameter<'a>(&'a DbParameter);

impl ToSql for CsvParameter<'_> {
    fn to_sql(
        &self,
        _ty: &Type,
        out: &mut tokio_postgres::types::private::BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        match self.0 {
            DbParameter::Null => Ok(IsNull::Yes),
            DbParameter::Text(value) => {
                out.extend_from_slice(value.as_bytes());
                Ok(IsNull::No)
            }
        }
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }

    tokio_postgres::types::to_sql_checked!();

    fn encode_format(&self, _ty: &Type) -> Format {
        Format::Text
    }
}

use crate::{
    drivers::trait_def::{
        DatabaseDriver, DbParameter, DriverStreamRequest, StreamControl, StreamStopReason,
        StreamTransactionMode,
    },
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
    utils::{error_redaction::sanitize_diagnostic_error, query_budget::QueryChunkBuffer},
};

struct PostgresTlsPolicy {
    mode: SslMode,
    verify_ca: bool,
    verify_hostname: bool,
}

impl PostgresTlsPolicy {
    fn resolve(mode: Option<&str>, url_mode: SslMode) -> Result<Self, AppError> {
        let mode = mode.map(str::trim).filter(|mode| !mode.is_empty());
        let (mode, verify_ca, verify_hostname) = match mode {
            None => (url_mode, false, false),
            Some("disable") => (SslMode::Disable, false, false),
            Some("prefer") => (SslMode::Prefer, false, false),
            Some("require") => (SslMode::Require, false, false),
            Some("verify-ca") => (SslMode::Require, true, false),
            Some("verify-full") => (SslMode::Require, true, true),
            Some(_) => return Err(AppError::ConfigError("Unknown PostgreSQL SSL mode".into())),
        };
        Ok(Self {
            mode,
            verify_ca,
            verify_hostname,
        })
    }
}

pub struct PostgresDriver {
    client: Client,
    cancel_token: CancelToken,
    tls: MakeTlsConnector,
    active_queries: Mutex<HashMap<String, CancelToken>>,
    _connection_task: JoinHandle<()>,
}

impl PostgresDriver {
    pub async fn connect(connection_url: &str) -> Result<Self, AppError> {
        Self::connect_with_url_credentials(connection_url, None, None).await
    }

    pub async fn connect_with_url_credentials(
        connection_url: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self, AppError> {
        let mut config = Config::from_str(connection_url).map_err(|error| {
            AppError::ConfigError(format!("Invalid PostgreSQL connection URL: {error}"))
        })?;
        if let Some(username) = username {
            config.user(username);
        }
        if let Some(password) = password {
            config.password(password);
        }
        Self::connect_config(config, None).await
    }

    pub async fn connect_with_params(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, AppError> {
        Self::connect_with_params_tls(host, port, database, username, password, None).await
    }

    pub async fn connect_with_params_tls(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: &str,
        ssl_mode: Option<&str>,
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

        Self::connect_config(config, ssl_mode).await
    }

    async fn connect_config(mut config: Config, mode: Option<&str>) -> Result<Self, AppError> {
        let policy = PostgresTlsPolicy::resolve(mode, config.get_ssl_mode())?;
        config.ssl_mode(policy.mode);
        let mut builder = native_tls::TlsConnector::builder();
        builder.danger_accept_invalid_certs(!policy.verify_ca);
        builder.danger_accept_invalid_hostnames(!policy.verify_hostname);
        let tls = MakeTlsConnector::new(builder.build().map_err(|_| {
            AppError::ConfigError("Unable to initialize PostgreSQL TLS connector".into())
        })?);
        let (client, connection) = config
            .connect(tls.clone())
            .await
            .map_err(map_postgres_connection_error)?;

        let connection_task = tokio::spawn(async move {
            if let Err(error) = connection.await {
                log::error!(
                    "postgres connection task failed: {}",
                    sanitize_diagnostic_error(&error.to_string(), None)
                );
            }
        });

        Ok(Self {
            cancel_token: client.cancel_token(),
            tls,
            client,
            active_queries: Mutex::new(HashMap::new()),
            _connection_task: connection_task,
        })
    }

    fn map_query_error(&self, sql: &str, error: tokio_postgres::Error) -> AppError {
        AppError::QueryFailed {
            sql: sql.to_string(),
            message: postgres_error_message(&error),
        }
    }
}

fn map_postgres_connection_error(error: tokio_postgres::Error) -> AppError {
    AppError::ConnectionFailed {
        driver: "postgres".to_string(),
        message: postgres_error_message(&error),
    }
}

/// `tokio-postgres::Error` intentionally renders server errors as the generic
/// "db error". Preserve the server's primary message and SQLSTATE instead;
/// the message is still passed through the central diagnostic redactor at the
/// `AppError` boundary.
fn postgres_error_message(error: &tokio_postgres::Error) -> String {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = source {
        if let Some(database_error) = current.downcast_ref::<tokio_postgres::error::DbError>() {
            return format!(
                "{} (SQLSTATE {})",
                database_error.message(),
                database_error.code().code()
            );
        }
        source = current.source();
    }

    error.to_string()
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn driver_name(&self) -> &'static str {
        "postgres"
    }

    fn supports_parameterized_import(&self) -> bool {
        true
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
        // SET search_path and the following query share this physical session.
        // Hold the manager's serial permit across both operations.
        false
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.client
            .simple_query("SELECT 1")
            .await
            .map_err(map_postgres_connection_error)?;
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

        let statement = self
            .client
            .prepare(sql)
            .await
            .map_err(|error| self.map_query_error(sql, error))?;
        let columns = columns_from_statement(&statement);
        let rows = self
            .client
            .query(&statement, &[])
            .await
            .map_err(|error| self.map_query_error(sql, error))?;

        rows_to_query_result(columns, rows, start.elapsed().as_millis() as u64)
    }

    async fn execute_parameterized(
        &self,
        sql: &str,
        params: &[DbParameter],
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let _query_registration = self.register_query(query_id);
        // CSV cells arrive as text. Send PostgreSQL text-format parameters so
        // the server parses each value using the prepared statement's inferred
        // target type (integer, date, UUID, etc.) while NULL remains protocol
        // NULL. A Rust String encoded in binary format only accepts TEXT-like
        // targets and rejects valid CSV values for typed columns client-side.
        let values = params.iter().map(CsvParameter).collect::<Vec<_>>();
        let references = values
            .iter()
            .map(|value| value as &(dyn ToSql + Sync))
            .collect::<Vec<_>>();
        if !returns_rows(sql) {
            let affected_rows = self
                .client
                .execute(sql, &references)
                .await
                .map_err(|error| self.map_query_error(sql, error))?;
            return Ok(QueryResult::empty(
                start.elapsed().as_millis() as u64,
                affected_rows,
            ));
        }
        let statement = self
            .client
            .prepare(sql)
            .await
            .map_err(|error| self.map_query_error(sql, error))?;
        let columns = columns_from_statement(&statement);
        let rows = self
            .client
            .query(&statement, &references)
            .await
            .map_err(|error| self.map_query_error(sql, error))?;
        rows_to_query_result(columns, rows, start.elapsed().as_millis() as u64)
    }

    async fn execute_query_stream(
        &self,
        sql: &str,
        query_id: &str,
        chunk_size: usize,
        max_rows: Option<u64>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
    ) -> Result<QueryStreamSummary, AppError> {
        self.execute_query_stream_controlled(
            DriverStreamRequest {
                sql,
                query_id,
                chunk_size,
                max_rows,
            },
            chunks,
            StreamControl::new(StreamTransactionMode::Manual),
        )
        .await
    }

    async fn execute_query_stream_controlled(
        &self,
        request: DriverStreamRequest<'_>,
        chunks: mpsc::Sender<Result<QueryResultChunk, AppError>>,
        control: StreamControl,
    ) -> Result<QueryStreamSummary, AppError> {
        let DriverStreamRequest {
            sql,
            query_id,
            chunk_size,
            max_rows,
        } = request;
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
        let mut rows = QueryChunkBuffer::new(chunk_size);
        let mut processing_error = None;
        let mut cancelled_for_failure = false;

        loop {
            if control.mode == StreamTransactionMode::Auto
                && matches!(
                    control.stop_reason(),
                    Some(
                        StreamStopReason::CellOrChunkLimit | StreamStopReason::ReceiverUnavailable
                    )
                )
                && !cancelled_for_failure
            {
                self.cancel_query(query_id).await?;
                cancelled_for_failure = true;
            }
            let next = if control.mode == StreamTransactionMode::Auto && !control.is_stopped() {
                tokio::select! {
                    row = stream.try_next() => row,
                    () = control.stopped() => { continue; }
                }
            } else {
                stream.try_next().await
            };
            let row = match next {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(error)
                    if cancelled_for_failure
                        && error.code()
                            == Some(&tokio_postgres::error::SqlState::QUERY_CANCELED) =>
                {
                    continue
                }
                Err(error) => return Err(self.map_query_error(sql, error)),
            };
            if max_rows.is_some_and(|limit| row_count >= limit) {
                truncated = true;
                control.stop(StreamStopReason::MaxRows);
            }
            if control.is_stopped() {
                continue;
            }

            if columns.is_empty() {
                columns = columns_from_row(&row);
            }

            let buffered = row_to_json_values(&row).and_then(|values| rows.push(values));
            let buffered = match buffered {
                Ok(buffered) => buffered,
                Err(error) => {
                    control.stop(StreamStopReason::CellOrChunkLimit);
                    processing_error = Some(error);
                    continue;
                }
            };
            if let Some(chunk_rows) = buffered {
                let chunk_row_count = chunk_rows.len() as u64;
                if let Err(error) =
                    send_query_chunk(&chunks, query_id, &columns, chunk_rows, row_offset).await
                {
                    control.stop(StreamStopReason::ReceiverUnavailable);
                    processing_error = Some(error);
                    continue;
                }
                row_offset += chunk_row_count;
            }
            row_count += 1;
        }

        if !rows.is_empty() || !columns.is_empty() {
            send_query_chunk(&chunks, query_id, &columns, rows.take(), row_offset).await?;
        }
        if let Some(error) = processing_error {
            return Err(error);
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
                ,c.is_identity = 'YES' AS is_identity
                ,c.is_generated = 'ALWAYS' AS is_generated
                ,(
                    c.is_identity = 'YES'
                    OR COALESCE(c.column_default, '') LIKE 'nextval(%'
                ) AS is_auto_increment
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
                source_namespace.nspname,
                source_relation.relname,
                fk_constraint.conname,
                array_agg(source_column.attname ORDER BY source_key.ordinality),
                referenced_namespace.nspname,
                referenced_relation.relname,
                array_agg(referenced_column.attname ORDER BY source_key.ordinality)
            FROM pg_catalog.pg_constraint AS fk_constraint
            JOIN pg_catalog.pg_class AS source_relation
              ON source_relation.oid = fk_constraint.conrelid
            JOIN pg_catalog.pg_namespace AS source_namespace
              ON source_namespace.oid = source_relation.relnamespace
            JOIN LATERAL unnest(fk_constraint.conkey) WITH ORDINALITY AS source_key(attnum, ordinality)
              ON true
            JOIN LATERAL unnest(fk_constraint.confkey) WITH ORDINALITY AS referenced_key(attnum, ordinality)
              ON referenced_key.ordinality = source_key.ordinality
            JOIN pg_catalog.pg_attribute AS source_column
              ON source_column.attrelid = fk_constraint.conrelid
             AND source_column.attnum = source_key.attnum
             AND source_column.attnum > 0
             AND NOT source_column.attisdropped
            JOIN pg_catalog.pg_class AS referenced_relation
              ON referenced_relation.oid = fk_constraint.confrelid
            JOIN pg_catalog.pg_namespace AS referenced_namespace
              ON referenced_namespace.oid = referenced_relation.relnamespace
            JOIN pg_catalog.pg_attribute AS referenced_column
              ON referenced_column.attrelid = fk_constraint.confrelid
             AND referenced_column.attnum = referenced_key.attnum
             AND referenced_column.attnum > 0
             AND NOT referenced_column.attisdropped
            WHERE fk_constraint.contype = 'f'
              AND source_namespace.nspname = $1
              AND source_relation.relname = $2
            GROUP BY source_namespace.nspname,
                     source_relation.relname,
                     fk_constraint.conname,
                     referenced_namespace.nspname,
                     referenced_relation.relname
            ORDER BY fk_constraint.conname
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

    async fn get_table_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
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
              AND c.relname = $2
              AND NOT t.tgisinternal
            ORDER BY t.tgname
        ";

        let rows = self
            .client
            .query(sql, &[&schema, &table])
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

    async fn explain_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<ExplainResult, AppError> {
        let _query_registration = self.register_query(query_id);
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
            .cancel_query(self.tls.clone())
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
            let _ = token.cancel_query(self.tls.clone()).await;
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

fn rows_to_query_result(
    columns: Vec<ColumnMeta>,
    rows: Vec<Row>,
    elapsed_ms: u64,
) -> Result<QueryResult, AppError> {
    let row_count = rows.len() as u64;
    let rows = rows
        .iter()
        .map(row_to_json_values)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(QueryResult {
        columns,
        rows,
        row_count,
        elapsed_ms,
        affected_rows: 0,
        query_id: None,
        truncated: false,
        max_rows: None,
    })
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
    rows: Vec<Vec<serde_json::Value>>,
    row_offset: u64,
) -> Result<(), AppError> {
    let chunk = QueryResultChunk {
        query_id: query_id.to_string(),
        columns: columns.to_vec(),
        rows,
        row_offset,
    };

    chunks
        .send(Ok(chunk))
        .await
        .map_err(|_| AppError::ResultProcessingError("query stream receiver dropped".to_string()))
}

fn row_to_json_values(row: &Row) -> Result<Vec<serde_json::Value>, AppError> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| {
            row.try_get::<_, Option<super::postgres_value::PgValue>>(index)
                .map(|value| value.map_or(serde_json::Value::Null, |value| value.0))
                .map_err(|_| AppError::SerializationError(format!(
                    "Cannot decode PostgreSQL result column {} ({}, type {}). The value was not replaced with NULL.",
                    index + 1, column.name(), column.type_().name()
                )))
        })
        .collect()
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
        is_identity: row.get(11),
        is_generated: row.get(12),
        is_auto_increment: row.get(13),
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
    let sql = crate::utils::sql_parser::mask_sql(sql);
    let mut words = sql
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .filter(|word| !word.is_empty());
    let first = words.next().unwrap_or_default().to_ascii_lowercase();
    matches!(
        first.as_str(),
        "select" | "with" | "show" | "explain" | "values" | "table"
    ) || words.any(|word| word.eq_ignore_ascii_case("returning"))
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

    #[derive(Default)]
    struct ProtocolCounts {
        produced: AtomicUsize,
        completed: AtomicUsize,
        cancellations: AtomicUsize,
    }

    #[derive(Default)]
    struct ProtocolFixture {
        fields: Vec<(&'static str, u32)>,
        rows: Vec<Vec<Vec<u8>>>,
        fail: bool,
        parameterized: bool,
        counts: Arc<ProtocolCounts>,
        pause_after_two: Option<Arc<tokio::sync::Semaphore>>,
        await_cancel: bool,
        cancelled: tokio_util::sync::CancellationToken,
    }

    async fn frame(server: &mut (impl AsyncWrite + Unpin), tag: u8, body: &[u8]) {
        server.write_u8(tag).await.unwrap();
        server.write_u32((body.len() + 4) as u32).await.unwrap();
        server.write_all(body).await.unwrap();
    }

    async fn serve_protocol(
        mut server: impl AsyncRead + AsyncWrite + Unpin,
        fixture: ProtocolFixture,
    ) {
        let length = server.read_u32().await.unwrap();
        let mut startup = vec![0; length as usize - 4];
        server.read_exact(&mut startup).await.unwrap();
        frame(&mut server, b'R', &[0, 0, 0, 0]).await;
        let mut backend_key = 73_i32.to_be_bytes().to_vec();
        backend_key.extend_from_slice(&93_i32.to_be_bytes());
        frame(&mut server, b'K', &backend_key).await;
        frame(&mut server, b'Z', b"I").await;
        while let Ok(tag) = server.read_u8().await {
            let length = server.read_u32().await.unwrap();
            let mut body = vec![0; length as usize - 4];
            server.read_exact(&mut body).await.unwrap();
            match tag {
                b'P' => frame(&mut server, b'1', &[]).await,
                b'D' => {
                    let mut parameters = (u16::from(fixture.parameterized)).to_be_bytes().to_vec();
                    if fixture.parameterized {
                        parameters.extend_from_slice(&23_u32.to_be_bytes());
                    }
                    frame(&mut server, b't', &parameters).await;
                    if fixture.fields.is_empty() {
                        frame(&mut server, b'n', &[]).await;
                    } else {
                        let mut description = (fixture.fields.len() as u16).to_be_bytes().to_vec();
                        for (name, type_oid) in &fixture.fields {
                            description.extend_from_slice(name.as_bytes());
                            description.push(0);
                            description.extend_from_slice(&0_u32.to_be_bytes());
                            description.extend_from_slice(&0_i16.to_be_bytes());
                            description.extend_from_slice(&type_oid.to_be_bytes());
                            description.extend_from_slice(&(-1_i16).to_be_bytes());
                            description.extend_from_slice(&(-1_i32).to_be_bytes());
                            description.extend_from_slice(&0_i16.to_be_bytes());
                        }
                        frame(&mut server, b'T', &description).await;
                    }
                }
                b'B' => frame(&mut server, b'2', &[]).await,
                b'E' => {
                    if fixture.fail {
                        frame(&mut server, b'E', b"SERROR\0C42501\0Mpermission denied\0\0").await;
                    } else {
                        for (row_index, values) in fixture.rows.iter().enumerate() {
                            let mut row = (values.len() as u16).to_be_bytes().to_vec();
                            for value in values {
                                row.extend_from_slice(&(value.len() as i32).to_be_bytes());
                                row.extend_from_slice(value);
                            }
                            frame(&mut server, b'D', &row).await;
                            fixture.counts.produced.fetch_add(1, Ordering::SeqCst);
                            if row_index == 1 {
                                if let Some(gate) = &fixture.pause_after_two {
                                    gate.acquire().await.unwrap().forget();
                                }
                            }
                        }
                        if fixture.await_cancel {
                            fixture.cancelled.cancelled().await;
                            frame(&mut server, b'E', b"SERROR\0C57014\0Mquery cancelled\0\0").await;
                        } else {
                            frame(
                                &mut server,
                                b'C',
                                if fixture.fields.is_empty() {
                                    b"UPDATE 2\0"
                                } else {
                                    b"SELECT 0\0"
                                },
                            )
                            .await;
                            fixture.counts.completed.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                }
                b'S' => frame(&mut server, b'Z', b"I").await,
                b'C' => frame(&mut server, b'3', &[]).await,
                b'X' => break,
                _ => panic!("unexpected PostgreSQL fixture request"),
            }
        }
    }

    async fn cancellable_driver(
        fixture: ProtocolFixture,
    ) -> (
        super::PostgresDriver,
        Arc<ProtocolCounts>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let counts = fixture.counts.clone();
        let cancelled = fixture.cancelled.clone();
        let cancellation_counts = counts.clone();
        let server_task = tokio::spawn(async move {
            let (server, _) = listener.accept().await.unwrap();
            let cancellation_task = tokio::spawn(async move {
                loop {
                    let (mut request, _) = listener.accept().await.unwrap();
                    assert_eq!(request.read_u32().await.unwrap(), 16);
                    assert_eq!(request.read_u32().await.unwrap(), 80_877_102);
                    assert_eq!(request.read_i32().await.unwrap(), 73);
                    assert_eq!(request.read_i32().await.unwrap(), 93);
                    cancellation_counts
                        .cancellations
                        .fetch_add(1, Ordering::SeqCst);
                    cancelled.cancel();
                }
            });
            serve_protocol(server, fixture).await;
            cancellation_task.abort();
            assert!(cancellation_task.await.unwrap_err().is_cancelled());
        });
        let driver = super::PostgresDriver::connect(&format!(
            "host=127.0.0.1 port={port} user=fixture sslmode=disable"
        ))
        .await
        .unwrap();
        (driver, counts, server_task)
    }

    #[tokio::test]
    async fn auto_successful_truncation_does_not_cancel_side_effecting_select() {
        use crate::drivers::trait_def::{
            DatabaseDriver, DriverStreamRequest, StreamControl, StreamTransactionMode,
        };
        let driver = described_driver(vec![("value", 23)], true, false, false).await;
        let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
        let summary = driver
            .execute_query_stream_controlled(
                DriverStreamRequest {
                    sql: "SELECT side_effecting_function()",
                    query_id: "successful-truncation",
                    chunk_size: 1,
                    max_rows: Some(0),
                },
                sender,
                StreamControl::new(StreamTransactionMode::Auto),
            )
            .await
            .expect("successful truncation must drain without native cancellation");
        assert!(summary.truncated);
        assert_eq!(summary.row_count, 0);
        let chunk = receiver.recv().await.unwrap().unwrap();
        assert_eq!(chunk.columns[0].name, "value");
        assert!(chunk.rows.is_empty());
    }

    #[tokio::test]
    async fn successful_max_rows_drains_without_decoding_discarded_values_in_both_modes() {
        use crate::{
            drivers::trait_def::StreamTransactionMode,
            services::query_engine::{QueryEngine, QueryStreamEvent, StreamQueryRequest},
        };
        for mode in [StreamTransactionMode::Auto, StreamTransactionMode::Manual] {
            let (driver, counts, server) = cancellable_driver(ProtocolFixture {
                fields: vec![("value", 23)],
                rows: vec![
                    vec![7_i32.to_be_bytes().to_vec()],
                    vec![vec![0]],
                    vec![vec![0]],
                    vec![vec![0]],
                ],
                ..Default::default()
            })
            .await;
            let driver = Arc::new(driver);
            let done = std::sync::Mutex::new(None);
            let retained = std::sync::Mutex::new(Vec::new());
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                QueryEngine::new().execute_query_stream_with_sink_in_mode(
                    driver.clone(),
                    StreamQueryRequest {
                        sql: "SELECT side_effecting_function()".into(),
                        query_id: "max-rows-drain".into(),
                        chunk_size: Some(1),
                        max_rows: Some(1),
                    },
                    mode,
                    |event| {
                        match event {
                            QueryStreamEvent::Chunk(chunk) => {
                                assert_eq!(chunk.columns[0].name, "value");
                                retained.lock().unwrap().extend(chunk.rows);
                            }
                            QueryStreamEvent::Done(summary) => {
                                *done.lock().unwrap() = Some(summary)
                            }
                            QueryStreamEvent::Error(_) => panic!("truncation must not emit ERROR"),
                        }
                        Ok(())
                    },
                ),
            )
            .await
            .unwrap()
            .unwrap();
            let done = done.into_inner().unwrap().unwrap();
            assert!(done.truncated);
            assert_eq!(done.row_count, 1);
            assert_eq!(
                retained.into_inner().unwrap(),
                vec![vec![serde_json::json!(7)]]
            );
            assert_eq!(counts.produced.load(Ordering::SeqCst), 4);
            assert_eq!(counts.completed.load(Ordering::SeqCst), 1);
            assert_eq!(counts.cancellations.load(Ordering::SeqCst), 0);
            assert!(driver.active_queries.lock().unwrap().is_empty());
            drop(driver);
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn successful_result_bytes_stop_drains_without_decoding_late_values_in_both_modes() {
        use crate::drivers::trait_def::{
            DatabaseDriver, DriverStreamRequest, StreamControl, StreamStopReason,
            StreamTransactionMode,
        };
        for mode in [StreamTransactionMode::Auto, StreamTransactionMode::Manual] {
            let gate = Arc::new(tokio::sync::Semaphore::new(0));
            let (driver, counts, server) = cancellable_driver(ProtocolFixture {
                fields: vec![("value", 23)],
                rows: vec![
                    vec![7_i32.to_be_bytes().to_vec()],
                    vec![8_i32.to_be_bytes().to_vec()],
                    vec![vec![0]],
                    vec![vec![0]],
                ],
                pause_after_two: Some(gate.clone()),
                ..Default::default()
            })
            .await;
            let control = StreamControl::new(mode);
            let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
            let execution = driver.execute_query_stream_controlled(
                DriverStreamRequest {
                    sql: "SELECT side_effecting_function()",
                    query_id: "byte-drain",
                    chunk_size: 1,
                    max_rows: None,
                },
                sender,
                control.clone(),
            );
            let consume = async {
                let first = receiver.recv().await.unwrap().unwrap();
                assert_eq!(first.rows, vec![vec![serde_json::json!(7)]]);
                control.stop(StreamStopReason::ResultBytes);
                gate.add_permits(1);
                let mut retained = first.rows;
                while let Some(chunk) = receiver.recv().await {
                    retained.extend(chunk.unwrap().rows);
                }
                retained
            };
            let (summary, retained) =
                tokio::time::timeout(std::time::Duration::from_secs(5), async {
                    tokio::join!(execution, consume)
                })
                .await
                .unwrap();
            assert_eq!(summary.unwrap().row_count, 2);
            assert_eq!(
                retained,
                vec![vec![serde_json::json!(7)], vec![serde_json::json!(8)]]
            );
            assert_eq!(counts.produced.load(Ordering::SeqCst), 4);
            assert_eq!(counts.completed.load(Ordering::SeqCst), 1);
            assert_eq!(counts.cancellations.load(Ordering::SeqCst), 0);
            drop(driver);
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn query_engine_result_byte_budget_emits_truncated_done_after_normal_pg_completion() {
        use crate::services::query_engine::{
            QueryEngine, QueryStreamEvent, StreamQueryRequest, MAX_INTERACTIVE_RESULT_BYTES,
        };
        let row_bytes = 900_000;
        let total_rows = MAX_INTERACTIVE_RESULT_BYTES / row_bytes + 4;
        let (driver, counts, server) = cancellable_driver(ProtocolFixture {
            fields: vec![("value", 25)],
            rows: vec![vec![vec![b'x'; row_bytes]]; total_rows],
            ..Default::default()
        })
        .await;
        let driver = Arc::new(driver);
        let done = std::sync::Mutex::new(None);
        let retained = AtomicUsize::new(0);
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            QueryEngine::new().execute_query_stream_with_sink(
                driver.clone(),
                StreamQueryRequest {
                    sql: "SELECT side_effecting_function()".into(),
                    query_id: "byte-truncated-done".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                |event| {
                    match event {
                        QueryStreamEvent::Chunk(chunk) => {
                            retained.fetch_add(chunk.rows.len(), Ordering::SeqCst);
                        }
                        QueryStreamEvent::Done(summary) => *done.lock().unwrap() = Some(summary),
                        QueryStreamEvent::Error(_) => panic!("byte truncation must not emit ERROR"),
                    }
                    Ok(())
                },
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let done = done.into_inner().unwrap().unwrap();
        assert!(done.truncated);
        assert!(done.row_count > 0 && done.row_count < total_rows as u64);
        assert_eq!(done.row_count as usize, retained.load(Ordering::SeqCst));
        assert!(done.received_bytes <= MAX_INTERACTIVE_RESULT_BYTES as u64);
        assert_eq!(counts.produced.load(Ordering::SeqCst), total_rows);
        assert_eq!(counts.completed.load(Ordering::SeqCst), 1);
        assert_eq!(counts.cancellations.load(Ordering::SeqCst), 0);
        assert!(driver.active_queries.lock().unwrap().is_empty());
        drop(driver);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn hard_processing_failure_cancels_auto_but_drains_manual() {
        use crate::drivers::trait_def::{
            DatabaseDriver, DriverStreamRequest, StreamControl, StreamTransactionMode,
        };
        for (type_oid, value) in [
            (23, vec![0]),
            (
                25,
                vec![b'x'; crate::utils::query_budget::MAX_INTERACTIVE_CELL_BYTES + 1],
            ),
        ] {
            for mode in [StreamTransactionMode::Auto, StreamTransactionMode::Manual] {
                let (driver, counts, server) = cancellable_driver(ProtocolFixture {
                    fields: vec![("value", type_oid)],
                    rows: vec![vec![value.clone()]],
                    await_cancel: mode == StreamTransactionMode::Auto,
                    ..Default::default()
                })
                .await;
                let (sender, _receiver) = tokio::sync::mpsc::channel(1);
                let error = tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    driver.execute_query_stream_controlled(
                        DriverStreamRequest {
                            sql: "SELECT side_effecting_function()",
                            query_id: "hard-failure",
                            chunk_size: 1,
                            max_rows: None,
                        },
                        sender,
                        StreamControl::new(mode),
                    ),
                )
                .await
                .unwrap()
                .unwrap_err();
                if type_oid == 23 {
                    assert!(matches!(error, super::AppError::SerializationError(_)));
                } else {
                    assert!(matches!(error, super::AppError::ResultLimitExceeded(_)));
                }
                assert!(!error.affects_transaction());
                assert_eq!(
                    counts.cancellations.load(Ordering::SeqCst),
                    usize::from(mode == StreamTransactionMode::Auto)
                );
                assert_eq!(
                    counts.completed.load(Ordering::SeqCst),
                    usize::from(mode == StreamTransactionMode::Manual)
                );
                assert!(driver.active_queries.lock().unwrap().is_empty());
                drop(driver);
                server.await.unwrap();
            }
        }
    }

    #[tokio::test]
    async fn delivery_failure_can_native_cancel_auto_while_waiting_for_rows() {
        use crate::services::query_engine::{QueryEngine, QueryStreamEvent, StreamQueryRequest};
        let (driver, counts, server) = cancellable_driver(ProtocolFixture {
            fields: vec![("value", 23)],
            rows: vec![vec![7_i32.to_be_bytes().to_vec()]; 2],
            await_cancel: true,
            ..Default::default()
        })
        .await;
        let driver = Arc::new(driver);
        let errors = AtomicUsize::new(0);
        let error = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            QueryEngine::new().execute_query_stream_with_sink(
                driver.clone(),
                StreamQueryRequest {
                    sql: "SELECT side_effecting_function()".into(),
                    query_id: "delivery-failure".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                |event| match event {
                    QueryStreamEvent::Chunk(_) => Err(super::AppError::ResultProcessingError(
                        "fixture receiver unavailable".into(),
                    )),
                    QueryStreamEvent::Error(_) => {
                        errors.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                    QueryStreamEvent::Done(_) => panic!("delivery failure must not emit DONE"),
                },
            ),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert!(matches!(error, super::AppError::ResultProcessingError(_)));
        assert!(!error.affects_transaction());
        assert_eq!(errors.load(Ordering::SeqCst), 1);
        assert_eq!(counts.cancellations.load(Ordering::SeqCst), 1);
        assert_eq!(counts.completed.load(Ordering::SeqCst), 0);
        drop(driver);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn explicit_user_cancel_still_uses_native_cancel_and_returns_failure_in_both_modes() {
        use crate::{
            drivers::trait_def::{DatabaseDriver, StreamTransactionMode},
            services::query_engine::{QueryEngine, QueryStreamEvent, StreamQueryRequest},
        };
        for mode in [StreamTransactionMode::Auto, StreamTransactionMode::Manual] {
            let (driver, counts, server) = cancellable_driver(ProtocolFixture {
                fields: vec![("value", 23)],
                rows: vec![vec![7_i32.to_be_bytes().to_vec()]; 2],
                await_cancel: true,
                ..Default::default()
            })
            .await;
            let driver = Arc::new(driver);
            let (ready, receive_ready) = tokio::sync::oneshot::channel();
            let ready = std::sync::Mutex::new(Some(ready));
            let errors = AtomicUsize::new(0);
            let engine = QueryEngine::new();
            let execution = engine.execute_query_stream_with_sink_in_mode(
                driver.clone(),
                StreamQueryRequest {
                    sql: "SELECT side_effecting_function()".into(),
                    query_id: "explicit-cancel".into(),
                    chunk_size: Some(1),
                    max_rows: None,
                },
                mode,
                |event| {
                    match event {
                        QueryStreamEvent::Chunk(_) => {
                            if let Some(ready) = ready.lock().unwrap().take() {
                                ready.send(()).unwrap();
                            }
                        }
                        QueryStreamEvent::Error(_) => {
                            errors.fetch_add(1, Ordering::SeqCst);
                        }
                        QueryStreamEvent::Done(_) => panic!("user cancellation must not emit DONE"),
                    }
                    Ok(())
                },
            );
            let cancel = async {
                receive_ready.await.unwrap();
                driver.cancel_query("explicit-cancel").await.unwrap();
            };
            let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                tokio::join!(execution, cancel)
            })
            .await
            .unwrap();
            let error = result.unwrap_err();
            assert!(matches!(error, super::AppError::QueryFailed { .. }));
            assert!(error.affects_transaction());
            assert_eq!(errors.load(Ordering::SeqCst), 1);
            assert_eq!(counts.cancellations.load(Ordering::SeqCst), 1);
            assert_eq!(counts.completed.load(Ordering::SeqCst), 0);
            assert!(driver.active_queries.lock().unwrap().is_empty());
            drop(driver);
            server.await.unwrap();
        }
    }

    async fn described_driver(
        fields: Vec<(&'static str, u32)>,
        nonempty: bool,
        fail: bool,
        parameterized: bool,
    ) -> super::PostgresDriver {
        let rows = if nonempty {
            vec![fields
                .iter()
                .map(|(_, type_oid)| {
                    if *type_oid == 23 {
                        7_i32.to_be_bytes().to_vec()
                    } else {
                        b"value".to_vec()
                    }
                })
                .collect()]
        } else {
            vec![]
        };
        let (stream, server) = tokio::io::duplex(16 * 1024);
        tokio::spawn(serve_protocol(
            server,
            ProtocolFixture {
                fields,
                rows,
                fail,
                parameterized,
                ..Default::default()
            },
        ));
        let mut config = tokio_postgres::Config::new();
        config
            .user("fixture")
            .ssl_mode(tokio_postgres::config::SslMode::Disable);
        let (client, connection) = config
            .connect_raw(stream, tokio_postgres::NoTls)
            .await
            .unwrap();
        super::PostgresDriver {
            cancel_token: client.cancel_token(),
            client,
            tls: postgres_native_tls::MakeTlsConnector::new(
                native_tls::TlsConnector::new().unwrap(),
            ),
            active_queries: std::sync::Mutex::new(std::collections::HashMap::new()),
            _connection_task: tokio::spawn(async move {
                connection.await.unwrap();
            }),
        }
    }

    #[tokio::test]
    async fn empty_select_keeps_statement_columns_including_aliases_and_types() {
        use crate::drivers::trait_def::DatabaseDriver;
        for (sql, fields, expected) in [
            (
                "SELECT 1 AS id WHERE false",
                vec![("id", 23)],
                vec![("id", "int4")],
            ),
            (
                "SELECT CAST(NULL AS bigint) AS id, CAST(NULL AS text) AS name WHERE false",
                vec![("id", 20), ("name", 25)],
                vec![("id", "int8"), ("name", "text")],
            ),
        ] {
            let driver = described_driver(fields, false, false, false).await;
            let result = driver.execute_query(sql, None).await.unwrap();
            assert_eq!(result.row_count, 0);
            assert!(result.rows.is_empty());
            assert_eq!(
                result
                    .columns
                    .iter()
                    .map(|column| (column.name.as_str(), column.data_type.as_str()))
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn empty_parameterized_select_keeps_columns() {
        use crate::drivers::trait_def::{DatabaseDriver, DbParameter};
        let driver = described_driver(vec![("id", 23)], false, false, true).await;
        let result = driver
            .execute_parameterized(
                "SELECT $1::integer AS id WHERE false",
                &[DbParameter::Text("7".into())],
                None,
            )
            .await
            .unwrap();
        assert!(result.rows.is_empty());
        assert_eq!(result.row_count, 0);
        assert_eq!(result.columns[0].name, "id");
        assert_eq!(result.columns[0].data_type, "int4");
    }

    #[tokio::test]
    async fn described_nonempty_select_dml_and_query_errors_keep_their_semantics() {
        use crate::drivers::trait_def::DatabaseDriver;
        let driver = described_driver(vec![("alias", 23)], true, false, false).await;
        let result = driver
            .execute_query("SELECT 7 AS alias", None)
            .await
            .unwrap();
        assert_eq!(result.rows, vec![vec![serde_json::json!(7)]]);
        assert_eq!(result.row_count, 1);
        assert_eq!(result.columns[0].name, "alias");
        let driver = described_driver(vec![], false, false, false).await;
        let result = driver
            .execute_query("UPDATE fixture SET id = 7", None)
            .await
            .unwrap();
        assert!(result.columns.is_empty());
        assert_eq!(result.affected_rows, 2);
        let driver = described_driver(vec![("id", 23)], false, true, false).await;
        assert!(matches!(
            driver
                .execute_query("SELECT id FROM denied", None)
                .await
                .unwrap_err(),
            super::AppError::QueryFailed { .. }
        ));
    }

    #[test]
    fn csv_parameters_use_server_parsed_text_format_for_typed_columns() {
        use super::{CsvParameter, DbParameter, Format, IsNull, ToSql, Type};
        let value = DbParameter::Text("42".into());
        let parameter = CsvParameter(&value);
        let mut encoded = tokio_postgres::types::private::BytesMut::new();
        assert!(matches!(
            parameter.to_sql(&Type::INT4, &mut encoded).unwrap(),
            IsNull::No
        ));
        assert_eq!(&encoded[..], b"42");
        assert!(matches!(parameter.encode_format(&Type::INT4), Format::Text));
        assert!(CsvParameter::accepts(&Type::INT4));
    }

    #[test]
    fn tls_policy_distinguishes_encryption_ca_and_hostname_checks() {
        use super::{PostgresTlsPolicy, SslMode};
        for (mode, ssl, ca, hostname) in [
            ("disable", SslMode::Disable, false, false),
            ("prefer", SslMode::Prefer, false, false),
            ("require", SslMode::Require, false, false),
            ("verify-ca", SslMode::Require, true, false),
            ("verify-full", SslMode::Require, true, true),
        ] {
            let policy = PostgresTlsPolicy::resolve(Some(mode), SslMode::Prefer).unwrap();
            assert_eq!(policy.mode, ssl);
            assert_eq!(policy.verify_ca, ca);
            assert_eq!(policy.verify_hostname, hostname);
        }
        assert_eq!(
            PostgresTlsPolicy::resolve(None, SslMode::Require)
                .unwrap()
                .mode,
            SslMode::Require
        );
        assert!(PostgresTlsPolicy::resolve(Some("unknown"), SslMode::Prefer).is_err());
    }

    #[tokio::test]
    async fn required_tls_never_sends_startup_credentials_to_a_plaintext_server() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
            time::{timeout, Duration},
        };
        for mode in ["require", "verify-ca", "verify-full", "url-require"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 8];
                socket.read_exact(&mut request).await.unwrap();
                assert_eq!(request, [0, 0, 0, 8, 4, 210, 22, 47]); // PostgreSQL SSLRequest
                socket.write_all(b"N").await.unwrap();
                let mut remaining = Vec::new();
                socket.read_to_end(&mut remaining).await.unwrap();
                assert!(
                    remaining.is_empty(),
                    "must not downgrade to a plaintext StartupMessage"
                );
            });
            let attempt = async {
                if mode == "url-require" {
                    super::PostgresDriver::connect(&format!(
                        "postgres://user:password@127.0.0.1:{port}/db?sslmode=require"
                    ))
                    .await
                } else {
                    super::PostgresDriver::connect_with_params_tls(
                        "127.0.0.1",
                        port,
                        "db",
                        "user",
                        "password",
                        Some(mode),
                    )
                    .await
                }
            };
            assert!(timeout(Duration::from_secs(5), attempt)
                .await
                .unwrap()
                .is_err());
            timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap();
        }
    }
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
        assert!(returns_rows("/* before */ -- query\n SELECT 1"));
        assert!(returns_rows("UPDATE t SET x=1\nRETURNING\nid"));
        assert!(!returns_rows("UPDATE t SET x=$body$ returning id $body$"));
        assert!(!returns_rows("UPDATE t SET x=1 /* returning id */"));
        assert!(!returns_rows("UPDATE t SET \"returning\"=1"));
    }
}
