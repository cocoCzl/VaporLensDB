use std::time::Instant;

use async_trait::async_trait;
use mysql_async::{prelude::Queryable, Column, Conn, Opts, OptsBuilder, Row, SslOpts, Value};
use tokio::sync::{mpsc, Mutex};

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

pub struct MysqlDriver {
    conn: Mutex<Conn>,
}

impl MysqlDriver {
    pub async fn connect(connection_url: &str) -> Result<Self, AppError> {
        Self::connect_with_url_credentials(connection_url, None, None).await
    }

    pub async fn connect_with_url_credentials(
        connection_url: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self, AppError> {
        let opts = Opts::from_url(connection_url).map_err(|error| {
            AppError::ConfigError(format!("Invalid MySQL connection URL: {error}"))
        })?;
        let mut builder = OptsBuilder::from_opts(opts);
        if let Some(username) = username {
            builder = builder.user(Some(username));
        }
        if let Some(password) = password {
            builder = builder.pass(Some(password));
        }
        let conn = Conn::new(tls_transport_options(builder.into())?)
            .await
            .map_err(map_mysql_connection_error)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
        let mut opts = OptsBuilder::default()
            .ip_or_hostname(host)
            .tcp_port(port)
            .user(Some(username))
            .pass(Some(password))
            .ssl_opts(mysql_ssl_options(ssl_mode)?);
        // Do not pass an empty schema as a database name. MySQL accepts a
        // connection without a default database and exposes the server's
        // database list after authentication.
        if !database.trim().is_empty() {
            opts = opts.db_name(Some(database));
        }
        let conn = Conn::new(tls_transport_options(opts.into())?)
            .await
            .map_err(map_mysql_connection_error)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

fn mysql_ssl_options(mode: Option<&str>) -> Result<Option<SslOpts>, AppError> {
    match mode.map(str::trim).filter(|mode| !mode.is_empty()) {
        None | Some("disable") => Ok(None),
        Some("require") => Ok(Some(
            SslOpts::default()
                .with_danger_accept_invalid_certs(true)
                .with_danger_skip_domain_validation(true),
        )),
        Some("verify-ca") => Ok(Some(
            SslOpts::default().with_danger_skip_domain_validation(true),
        )),
        Some("verify-full") => Ok(Some(SslOpts::default())),
        Some("prefer") => Err(AppError::ConfigError(
            "MySQL prefer TLS mode is not supported; select an explicit encryption policy".into(),
        )),
        Some(_) => Err(AppError::ConfigError("Unknown MySQL SSL mode".into())),
    }
}

fn tls_transport_options(opts: Opts) -> Result<Opts, AppError> {
    if opts.ssl_opts().is_none() {
        return Ok(opts);
    }
    if opts.socket().is_some() {
        return Err(AppError::ConfigError(
            "MySQL TLS requires a TCP connection, not an explicit local socket".into(),
        ));
    }
    // Do not let localhost discovery replace a requested TLS transport with a
    // local socket. URL certificate policy remains unchanged.
    Ok(OptsBuilder::from_opts(opts).prefer_socket(false).into())
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    fn driver_name(&self) -> &'static str {
        "mysql"
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            has_database: true,
            has_schema: false,
            supports_transactions: true,
            supports_explain: true,
            supports_cancel: false,
            supports_ddl: true,
            supports_streaming: true,
        }
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.conn
            .lock()
            .await
            .ping()
            .await
            .map_err(map_mysql_connection_error)
    }

    async fn begin_transaction(&self) -> Result<(), AppError> {
        self.execute_query("START TRANSACTION", None)
            .await
            .map(|_| ())
    }

    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let mut conn = self.conn.lock().await;
        let mut result = conn
            .query_iter(sql)
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        let affected_rows = result.affected_rows();
        let columns = columns_from_mysql(result.columns_ref());
        let mut rows = Vec::new();

        while let Some(row) = result
            .next()
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?
        {
            rows.push(row_to_json_values(&row));
        }
        result
            .drop_result()
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;

        Ok(QueryResult {
            row_count: rows.len() as u64,
            columns,
            rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            affected_rows,
            query_id: query_id.map(str::to_string),
            truncated: false,
            max_rows: None,
        })
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
        let chunk_size = chunk_size.max(1);
        let mut conn = self.conn.lock().await;
        let mut result = conn
            .query_iter(sql)
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        let affected_rows = result.affected_rows();
        let columns = columns_from_mysql(result.columns_ref());
        let mut row_count = 0_u64;
        let mut row_offset = 0_u64;
        let mut truncated = false;
        let mut rows = Vec::with_capacity(chunk_size);

        while let Some(row) = result
            .next()
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?
        {
            if max_rows.is_some_and(|limit| row_count >= limit) {
                truncated = true;
                break;
            }

            rows.push(row_to_json_values(&row));
            row_count += 1;

            if rows.len() >= chunk_size {
                send_query_chunk(&chunks, query_id, &columns, &mut rows, row_offset).await?;
                row_offset = row_count;
            }
        }
        result
            .drop_result()
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;

        if !rows.is_empty() || !columns.is_empty() {
            send_query_chunk(&chunks, query_id, &columns, &mut rows, row_offset).await?;
        }

        Ok(QueryStreamSummary {
            query_id: query_id.to_string(),
            row_count,
            affected_rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
            max_rows,
        })
    }

    async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, AppError> {
        let mut conn = self.conn.lock().await;
        let rows: Vec<String> = conn
            .query("SHOW DATABASES")
            .await
            .map_err(|error| map_mysql_query_error("SHOW DATABASES", error))?;
        Ok(rows.into_iter().map(|name| DatabaseInfo { name }).collect())
    }

    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        let databases = self.get_databases().await?;
        Ok(databases
            .into_iter()
            .map(|item| SchemaInfo {
                name: item.name,
                database: database.map(str::to_string),
            })
            .collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let sql = r#"
            SELECT table_schema, table_name, table_type, table_rows
            FROM information_schema.tables
            WHERE table_schema = ?
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        "#;
        let mut conn = self.conn.lock().await;
        let rows: Vec<(String, String, String, Option<u64>)> = conn
            .exec(sql, (schema,))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        Ok(rows.into_iter().map(table_info_from_mysql).collect())
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        let sql = r#"
            SELECT
                table_schema,
                table_name,
                column_name,
                ordinal_position,
                column_type,
                is_nullable = 'YES',
                column_default,
                character_maximum_length,
                numeric_precision,
                numeric_scale,
                column_key = 'PRI'
            FROM information_schema.columns
            WHERE table_schema = ?
              AND table_name = ?
            ORDER BY ordinal_position
        "#;
        let mut conn = self.conn.lock().await;
        let rows: Vec<(
            String,
            String,
            String,
            i32,
            String,
            bool,
            Option<String>,
            Option<i64>,
            Option<i32>,
            Option<i32>,
            bool,
        )> = conn
            .exec(sql, (schema, table))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    schema,
                    table,
                    name,
                    ordinal_position,
                    data_type,
                    nullable,
                    default_value,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale,
                    is_primary_key,
                )| ColumnInfo {
                    schema: Some(schema),
                    table,
                    name,
                    ordinal_position,
                    data_type,
                    nullable,
                    default_value,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale,
                    is_primary_key,
                },
            )
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
        let sql = r#"
            SELECT index_name, non_unique = 0, column_name
            FROM information_schema.statistics
            WHERE table_schema = ?
              AND table_name = ?
            ORDER BY index_name, seq_in_index
        "#;
        let mut conn = self.conn.lock().await;
        let rows: Vec<(String, bool, String)> = conn
            .exec(sql, (schema, table))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        let mut indexes: Vec<IndexInfo> = Vec::new();
        for (name, unique, column) in rows {
            if let Some(existing) = indexes.iter_mut().find(|index| index.name == name) {
                existing.columns.push(column);
            } else {
                indexes.push(IndexInfo {
                    schema: Some(schema.to_string()),
                    table: table.to_string(),
                    name,
                    columns: vec![column],
                    unique,
                    definition: None,
                });
            }
        }
        Ok(indexes)
    }

    async fn get_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let sql = r#"
            SELECT
                constraint_name,
                column_name,
                referenced_table_schema,
                referenced_table_name,
                referenced_column_name
            FROM information_schema.key_column_usage
            WHERE table_schema = ?
              AND table_name = ?
              AND referenced_table_name IS NOT NULL
            ORDER BY constraint_name, ordinal_position
        "#;
        let mut conn = self.conn.lock().await;
        let rows: Vec<(String, String, String, String, String)> = conn
            .exec(sql, (schema, table))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();
        for (name, column, referenced_schema, referenced_table, referenced_column) in rows {
            if let Some(existing) = foreign_keys.iter_mut().find(|key| key.name == name) {
                existing.columns.push(column);
                existing.referenced_columns.push(referenced_column);
            } else {
                foreign_keys.push(ForeignKeyInfo {
                    schema: Some(schema.to_string()),
                    table: table.to_string(),
                    name,
                    columns: vec![column],
                    referenced_schema: Some(referenced_schema),
                    referenced_table,
                    referenced_columns: vec![referenced_column],
                });
            }
        }
        Ok(foreign_keys)
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let sql = r#"
            SELECT table_schema, table_name, table_type, table_rows
            FROM information_schema.tables
            WHERE table_schema = ?
              AND table_type = 'VIEW'
            ORDER BY table_name
        "#;
        let mut conn = self.conn.lock().await;
        let rows: Vec<(String, String, String, Option<u64>)> = conn
            .exec(sql, (schema,))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        Ok(rows.into_iter().map(table_info_from_mysql).collect())
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let sql = r#"
            SELECT routine_name
            FROM information_schema.routines
            WHERE routine_schema = ?
            ORDER BY routine_name
        "#;
        let mut conn = self.conn.lock().await;
        conn.exec(sql, (schema,))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let sql = format!(
            "SHOW CREATE TABLE `{}`.`{}`",
            escape_identifier(schema),
            escape_identifier(table)
        );
        let mut conn = self.conn.lock().await;
        let row: Option<(String, String)> = conn
            .query_first(&sql)
            .await
            .map_err(|error| map_mysql_query_error(&sql, error))?;
        row.map(|(_, ddl)| ddl).ok_or_else(|| AppError::NotFound {
            resource: "table".to_string(),
            id: format!("{schema}.{table}"),
        })
    }

    async fn get_schema_objects(
        &self,
        schema: &str,
        kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        if !matches!(kind, DbObjectKind::Trigger) {
            return Ok(Vec::new());
        }

        let sql = r#"
            SELECT trigger_name
            FROM information_schema.triggers
            WHERE trigger_schema = ?
            ORDER BY trigger_name
        "#;
        let mut conn = self.conn.lock().await;
        let rows: Vec<String> = conn
            .exec(sql, (schema,))
            .await
            .map_err(|error| map_mysql_query_error(sql, error))?;
        Ok(rows
            .into_iter()
            .map(|name| DbObjectInfo {
                schema: Some(schema.to_string()),
                name,
                kind: DbObjectKind::Trigger,
                object_type: Some("TRIGGER".to_string()),
                status: None,
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

        let sql = format!(
            "SHOW CREATE TRIGGER `{}`.`{}`",
            escape_identifier(schema),
            escape_identifier(name)
        );
        let mut conn = self.conn.lock().await;
        let row: Option<Row> = conn
            .query_first(&sql)
            .await
            .map_err(|error| map_mysql_query_error(&sql, error))?;
        row.and_then(|row| row.get::<String, _>(2))
            .ok_or_else(|| AppError::NotFound {
                resource: "trigger".to_string(),
                id: format!("{schema}.{name}"),
            })
    }

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        let start = Instant::now();
        let result = self.execute_query(&format!("EXPLAIN {sql}"), None).await?;
        Ok(ExplainResult {
            format: ExplainFormat::Table,
            plan: serde_json::Value::Null,
            result: Some(result),
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn cancel_query(&self, _query_id: &str) -> Result<(), AppError> {
        Err(AppError::UnsupportedOperation {
            driver: "mysql".to_string(),
            operation: "cancel_query".to_string(),
        })
    }
}

fn table_info_from_mysql(
    (schema, name, table_type, row_count): (String, String, String, Option<u64>),
) -> TableInfo {
    TableInfo {
        schema: Some(schema),
        name,
        table_type: if table_type.eq_ignore_ascii_case("VIEW") {
            TableType::View
        } else {
            TableType::Table
        },
        row_count,
    }
}

fn columns_from_mysql(columns: &[Column]) -> Vec<ColumnMeta> {
    columns
        .iter()
        .map(|column| ColumnMeta {
            name: column.name_str().into_owned(),
            data_type: format!("{:?}", column.column_type()),
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
    (0..row.len())
        .map(|index| {
            row.as_ref(index)
                .map(value_to_json)
                .unwrap_or(serde_json::Value::Null)
        })
        .collect()
}

fn value_to_json(value: &Value) -> serde_json::Value {
    match value {
        Value::NULL => serde_json::Value::Null,
        Value::Bytes(value) => serde_json::Value::String(String::from_utf8_lossy(value).into()),
        Value::Int(value) => crate::utils::result_value::signed_integer(*value),
        Value::UInt(value) => crate::utils::result_value::unsigned_integer(*value),
        Value::Float(value) => serde_json::json!(value),
        Value::Double(value) => serde_json::json!(value),
        Value::Date(year, month, day, hour, minute, second, micros) => serde_json::Value::String(
            format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{micros:06}"),
        ),
        Value::Time(negative, days, hours, minutes, seconds, micros) => {
            serde_json::Value::String(format!(
                "{}{} {hours:02}:{minutes:02}:{seconds:02}.{micros:06}",
                if *negative { "-" } else { "" },
                days
            ))
        }
    }
}

fn map_mysql_connection_error(error: mysql_async::Error) -> AppError {
    AppError::ConnectionFailed {
        driver: "mysql".to_string(),
        message: error.to_string(),
    }
}

fn map_mysql_query_error(sql: &str, error: mysql_async::Error) -> AppError {
    AppError::QueryFailed {
        sql: sql.to_string(),
        message: error.to_string(),
    }
}

fn escape_identifier(value: &str) -> String {
    value.replace('`', "``")
}

#[cfg(test)]
mod result_value_tests {
    use super::*;

    #[test]
    fn preserves_signed_and_unsigned_bigints() {
        assert_eq!(value_to_json(&Value::Int(42)), serde_json::json!(42));
        assert_eq!(
            value_to_json(&Value::Int(i64::MIN)),
            serde_json::json!("-9223372036854775808")
        );
        assert_eq!(
            value_to_json(&Value::UInt(u64::MAX)),
            serde_json::json!("18446744073709551615")
        );
        assert_eq!(value_to_json(&Value::NULL), serde_json::Value::Null);
    }

    #[test]
    fn tls_options_distinguish_encryption_from_identity_verification() {
        for (mode, invalid_certs, skip_name) in [
            ("require", true, true),
            ("verify-ca", false, true),
            ("verify-full", false, false),
        ] {
            let ssl = super::mysql_ssl_options(Some(mode)).unwrap().unwrap();
            assert_eq!(ssl.accept_invalid_certs(), invalid_certs);
            assert_eq!(ssl.skip_domain_validation(), skip_name);
            assert!(!ssl.disable_built_in_roots());
        }
        assert!(super::mysql_ssl_options(None).unwrap().is_none());
        assert!(super::mysql_ssl_options(Some("disable")).unwrap().is_none());
        assert!(super::mysql_ssl_options(Some("prefer")).is_err());
        assert!(super::mysql_ssl_options(Some("unknown")).is_err());
    }

    #[test]
    fn url_tls_keeps_verification_and_disables_socket_discovery() {
        let opts = mysql_async::Opts::from_url("mysql://localhost/db?require_ssl=true").unwrap();
        let opts = super::tls_transport_options(opts).unwrap();
        assert!(!opts.prefer_socket());
        assert!(!opts.ssl_opts().unwrap().accept_invalid_certs());
        assert!(!opts.ssl_opts().unwrap().skip_domain_validation());
        let opts = mysql_async::OptsBuilder::from_opts(opts).socket(Some("/tmp/mysql.sock"));
        assert!(super::tls_transport_options(opts.into()).is_err());
    }

    #[tokio::test]
    async fn required_tls_rejects_server_without_ssl_before_authentication() {
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
                // Protocol 10 greeting, protocol-41/secure-connection/plugin-auth,
                // deliberately omitting CLIENT_SSL (0x0800).
                let mut greeting = vec![10];
                greeting.extend_from_slice(b"8.0.0\0");
                greeting.extend_from_slice(&1u32.to_le_bytes());
                greeting.extend_from_slice(b"12345678\0");
                greeting.extend_from_slice(&0x8201u16.to_le_bytes());
                greeting.push(45);
                greeting.extend_from_slice(&2u16.to_le_bytes());
                greeting.extend_from_slice(&8u16.to_le_bytes());
                greeting.push(21);
                greeting.extend_from_slice(&[0; 10]);
                greeting.extend_from_slice(b"123456789012\0mysql_native_password\0");
                let length = greeting.len() as u32;
                socket.write_all(&length.to_le_bytes()[..3]).await.unwrap();
                socket.write_all(&[0]).await.unwrap();
                socket.write_all(&greeting).await.unwrap();
                let mut response = Vec::new();
                socket.read_to_end(&mut response).await.unwrap();
                assert!(
                    response.is_empty(),
                    "must not send a plaintext authentication response"
                );
            });
            let attempt = async {
                if mode == "url-require" {
                    super::MysqlDriver::connect(&format!(
                        "mysql://user:password@127.0.0.1:{port}/db?require_ssl=true"
                    ))
                    .await
                } else {
                    super::MysqlDriver::connect_with_params_tls(
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
            let error = timeout(Duration::from_secs(5), attempt)
                .await
                .unwrap()
                .err()
                .expect("TLS must fail");
            assert!(error.to_string().to_lowercase().contains("ssl"), "{error}");
            timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap();
        }
    }
}
