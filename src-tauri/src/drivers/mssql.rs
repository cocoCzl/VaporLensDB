use std::time::Instant;

use async_trait::async_trait;
use tiberius::{AuthMethod, Client, Column, ColumnData, Config, EncryptionLevel, Row};
use tokio::{net::TcpStream, sync::mpsc, sync::Mutex};
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        error::AppError,
        metadata::{
            ColumnInfo, DatabaseInfo, DriverCapabilities, ForeignKeyInfo, IndexInfo, SchemaInfo,
            TableInfo, TableType,
        },
        query_result::{
            ColumnMeta, ExplainFormat, ExplainResult, QueryResult, QueryResultChunk,
            QueryStreamSummary,
        },
    },
};

type MssqlClient = Client<Compat<TcpStream>>;

pub struct MssqlDriver {
    client: Mutex<MssqlClient>,
}

impl MssqlDriver {
    pub async fn connect(connection_url: &str) -> Result<Self, AppError> {
        let config = if connection_url.trim_start().starts_with("jdbc:sqlserver:") {
            Config::from_jdbc_string(connection_url)
        } else {
            Config::from_ado_string(connection_url)
        }
        .map_err(|error| AppError::ConfigError(format!("Invalid SQL Server URL: {error}")))?;

        Self::connect_with_config(config).await
    }

    pub async fn connect_with_params(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, AppError> {
        let mut config = Config::new();
        config.host(host);
        config.port(port);
        config.database(database);
        config.authentication(AuthMethod::sql_server(username, password));
        config.encryption(EncryptionLevel::Required);
        config.trust_cert();

        Self::connect_with_config(config).await
    }

    async fn connect_with_config(config: Config) -> Result<Self, AppError> {
        let tcp = TcpStream::connect(config.get_addr())
            .await
            .map_err(|error| AppError::ConnectionFailed {
                driver: "mssql".to_string(),
                message: error.to_string(),
            })?;
        tcp.set_nodelay(true)
            .map_err(|error| AppError::ConnectionFailed {
                driver: "mssql".to_string(),
                message: error.to_string(),
            })?;

        let client = Client::connect(config, tcp.compat_write())
            .await
            .map_err(map_mssql_connection_error)?;

        Ok(Self {
            client: Mutex::new(client),
        })
    }

    async fn query_first_result(&self, sql: &str) -> Result<Vec<Row>, AppError> {
        let mut client = self.client.lock().await;
        let stream = client
            .simple_query(sql)
            .await
            .map_err(|error| map_mssql_query_error(sql, error))?;
        let rows = stream
            .into_first_result()
            .await
            .map_err(|error| map_mssql_query_error(sql, error))?;
        Ok(rows)
    }
}

#[async_trait]
impl DatabaseDriver for MssqlDriver {
    fn driver_name(&self) -> &'static str {
        "mssql"
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            has_database: true,
            has_schema: true,
            supports_transactions: true,
            supports_explain: true,
            supports_cancel: false,
            supports_ddl: true,
            supports_streaming: true,
        }
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.query_first_result("SELECT 1").await?;
        Ok(())
    }

    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let rows = self.query_first_result(sql).await?;
        let columns = rows
            .first()
            .map(|row| columns_from_mssql(row.columns()))
            .unwrap_or_default();
        let values = rows.iter().map(row_to_json_values).collect::<Vec<_>>();

        Ok(QueryResult {
            row_count: values.len() as u64,
            columns,
            rows: values,
            elapsed_ms: start.elapsed().as_millis() as u64,
            affected_rows: 0,
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
        let rows = self
            .query_first_result(
                r#"
                SELECT name
                FROM sys.databases
                WHERE state = 0
                ORDER BY name
                "#,
            )
            .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| get_string(&row, 0))
            .map(|name| DatabaseInfo { name })
            .collect())
    }

    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        let rows = self
            .query_first_result(
                r#"
                SELECT name
                FROM sys.schemas
                WHERE name NOT IN ('INFORMATION_SCHEMA', 'sys', 'guest')
                ORDER BY CASE WHEN name = SCHEMA_NAME() THEN 0 ELSE 1 END, name
                "#,
            )
            .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| get_string(&row, 0))
            .map(|name| SchemaInfo {
                name,
                database: database.map(str::to_string),
            })
            .collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let sql = format!(
            r#"
            SELECT s.name, t.name, CAST(SUM(p.rows) AS bigint)
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
            WHERE s.name = N'{}'
              AND t.is_ms_shipped = 0
            GROUP BY s.name, t.name
            ORDER BY t.name
            "#,
            escape_string(schema)
        );
        let rows = self.query_first_result(&sql).await?;

        Ok(rows
            .into_iter()
            .map(|row| TableInfo {
                schema: get_string(&row, 0),
                name: get_string(&row, 1).unwrap_or_default(),
                table_type: TableType::Table,
                row_count: get_i64(&row, 2).and_then(|value| u64::try_from(value).ok()),
            })
            .collect())
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        let sql = format!(
            r#"
            SELECT
                s.name,
                t.name,
                c.name,
                c.column_id,
                typ.name,
                c.is_nullable,
                dc.definition,
                c.max_length,
                c.precision,
                c.scale,
                CASE WHEN pk.column_id IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END
            FROM sys.columns c
            JOIN sys.tables t ON t.object_id = c.object_id
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            JOIN sys.types typ ON typ.user_type_id = c.user_type_id
            LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
            LEFT JOIN (
                SELECT ic.object_id, ic.column_id
                FROM sys.indexes i
                JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                WHERE i.is_primary_key = 1
            ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
            WHERE s.name = N'{}'
              AND t.name = N'{}'
            ORDER BY c.column_id
            "#,
            escape_string(schema),
            escape_string(table)
        );
        let rows = self.query_first_result(&sql).await?;

        Ok(rows
            .into_iter()
            .map(|row| ColumnInfo {
                schema: get_string(&row, 0),
                table: get_string(&row, 1).unwrap_or_else(|| table.to_string()),
                name: get_string(&row, 2).unwrap_or_default(),
                ordinal_position: get_i32(&row, 3).unwrap_or_default(),
                data_type: get_string(&row, 4).unwrap_or_default(),
                nullable: get_bool(&row, 5).unwrap_or(true),
                default_value: get_string(&row, 6),
                character_maximum_length: get_i16(&row, 7)
                    .map(i64::from)
                    .filter(|value| *value > 0),
                numeric_precision: get_u8(&row, 8).map(i32::from),
                numeric_scale: get_u8(&row, 9).map(i32::from),
                is_primary_key: get_bool(&row, 10).unwrap_or(false),
            })
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
        let sql = format!(
            r#"
            SELECT
                s.name,
                t.name,
                i.name,
                i.is_unique,
                c.name,
                i.type_desc
            FROM sys.indexes i
            JOIN sys.tables t ON t.object_id = i.object_id
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE s.name = N'{}'
              AND t.name = N'{}'
              AND i.name IS NOT NULL
            ORDER BY i.name, ic.key_ordinal, ic.index_column_id
            "#,
            escape_string(schema),
            escape_string(table)
        );
        let rows = self.query_first_result(&sql).await?;
        let mut indexes: Vec<IndexInfo> = Vec::new();

        for row in rows {
            let name = get_string(&row, 2).unwrap_or_default();
            let column = get_string(&row, 4).unwrap_or_default();
            if let Some(existing) = indexes.iter_mut().find(|index| index.name == name) {
                existing.columns.push(column);
            } else {
                indexes.push(IndexInfo {
                    schema: get_string(&row, 0),
                    table: get_string(&row, 1).unwrap_or_else(|| table.to_string()),
                    name,
                    columns: vec![column],
                    unique: get_bool(&row, 3).unwrap_or(false),
                    definition: get_string(&row, 5),
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
        let sql = format!(
            r#"
            SELECT
                s.name,
                parent.name,
                fk.name,
                pc.name,
                rs.name,
                referenced.name,
                rc.name
            FROM sys.foreign_keys fk
            JOIN sys.tables parent ON parent.object_id = fk.parent_object_id
            JOIN sys.schemas s ON s.schema_id = parent.schema_id
            JOIN sys.tables referenced ON referenced.object_id = fk.referenced_object_id
            JOIN sys.schemas rs ON rs.schema_id = referenced.schema_id
            JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
            JOIN sys.columns pc ON pc.object_id = parent.object_id AND pc.column_id = fkc.parent_column_id
            JOIN sys.columns rc ON rc.object_id = referenced.object_id AND rc.column_id = fkc.referenced_column_id
            WHERE s.name = N'{}'
              AND parent.name = N'{}'
            ORDER BY fk.name, fkc.constraint_column_id
            "#,
            escape_string(schema),
            escape_string(table)
        );
        let rows = self.query_first_result(&sql).await?;
        let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();

        for row in rows {
            let name = get_string(&row, 2).unwrap_or_default();
            let column = get_string(&row, 3).unwrap_or_default();
            let referenced_column = get_string(&row, 6).unwrap_or_default();
            if let Some(existing) = foreign_keys.iter_mut().find(|key| key.name == name) {
                existing.columns.push(column);
                existing.referenced_columns.push(referenced_column);
            } else {
                foreign_keys.push(ForeignKeyInfo {
                    schema: get_string(&row, 0),
                    table: get_string(&row, 1).unwrap_or_else(|| table.to_string()),
                    name,
                    columns: vec![column],
                    referenced_schema: get_string(&row, 4),
                    referenced_table: get_string(&row, 5).unwrap_or_default(),
                    referenced_columns: vec![referenced_column],
                });
            }
        }

        Ok(foreign_keys)
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let sql = format!(
            r#"
            SELECT s.name, v.name
            FROM sys.views v
            JOIN sys.schemas s ON s.schema_id = v.schema_id
            WHERE s.name = N'{}'
              AND v.is_ms_shipped = 0
            ORDER BY v.name
            "#,
            escape_string(schema)
        );
        let rows = self.query_first_result(&sql).await?;

        Ok(rows
            .into_iter()
            .map(|row| TableInfo {
                schema: get_string(&row, 0),
                name: get_string(&row, 1).unwrap_or_default(),
                table_type: TableType::View,
                row_count: None,
            })
            .collect())
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let sql = format!(
            r#"
            SELECT o.name
            FROM sys.objects o
            JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = N'{}'
              AND o.type IN ('FN', 'IF', 'TF', 'AF', 'FS', 'FT')
            ORDER BY o.name
            "#,
            escape_string(schema)
        );
        let rows = self.query_first_result(&sql).await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| get_string(&row, 0))
            .collect())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let columns = self.get_columns(schema, table).await?;
        if columns.is_empty() {
            return Err(AppError::NotFound {
                resource: "table".to_string(),
                id: format!("{schema}.{table}"),
            });
        }

        let column_lines = columns
            .into_iter()
            .map(|column| {
                format!(
                    "    [{}] {}{}{}",
                    column.name.replace(']', "]]"),
                    column.data_type,
                    column
                        .default_value
                        .as_deref()
                        .map(|value| format!(" DEFAULT {value}"))
                        .unwrap_or_default(),
                    if column.nullable {
                        " NULL"
                    } else {
                        " NOT NULL"
                    }
                )
            })
            .collect::<Vec<_>>()
            .join(",\n");

        Ok(format!(
            "CREATE TABLE [{}].[{}] (\n{}\n);",
            schema.replace(']', "]]"),
            table.replace(']', "]]"),
            column_lines
        ))
    }

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        let start = Instant::now();
        let escaped = sql.replace('\'', "''");
        let plan_sql = format!(
            "SET SHOWPLAN_TEXT ON; EXEC sp_executesql N'{}'; SET SHOWPLAN_TEXT OFF;",
            escaped
        );
        let result = self.execute_query(&plan_sql, None).await?;
        Ok(ExplainResult {
            format: ExplainFormat::Text,
            plan: serde_json::to_value(result.rows)?,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn cancel_query(&self, _query_id: &str) -> Result<(), AppError> {
        Err(AppError::UnsupportedOperation {
            driver: "mssql".to_string(),
            operation: "cancel_query".to_string(),
        })
    }
}

fn columns_from_mssql(columns: &[Column]) -> Vec<ColumnMeta> {
    columns
        .iter()
        .map(|column| ColumnMeta {
            name: column.name().to_string(),
            data_type: format!("{:?}", column.column_type()),
            nullable: true,
        })
        .collect()
}

fn row_to_json_values(row: &Row) -> Vec<serde_json::Value> {
    row.cells()
        .map(|(_, value)| column_data_to_json(value))
        .collect()
}

fn column_data_to_json(value: &ColumnData<'_>) -> serde_json::Value {
    match value {
        ColumnData::U8(Some(value)) => serde_json::json!(value),
        ColumnData::I16(Some(value)) => serde_json::json!(value),
        ColumnData::I32(Some(value)) => serde_json::json!(value),
        ColumnData::I64(Some(value)) => serde_json::json!(value),
        ColumnData::F32(Some(value)) => serde_json::json!(value),
        ColumnData::F64(Some(value)) => serde_json::json!(value),
        ColumnData::Bit(Some(value)) => serde_json::json!(value),
        ColumnData::String(Some(value)) => serde_json::Value::String(value.to_string()),
        ColumnData::Guid(Some(value)) => serde_json::Value::String(value.to_string()),
        ColumnData::Binary(Some(value)) => {
            serde_json::Value::String(format!("0x{}", hex_encode(value.as_ref())))
        }
        ColumnData::Numeric(Some(value)) => serde_json::Value::String(value.to_string()),
        ColumnData::Xml(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        ColumnData::DateTime(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        ColumnData::SmallDateTime(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        ColumnData::Time(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        ColumnData::Date(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        ColumnData::DateTime2(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        ColumnData::DateTimeOffset(Some(value)) => serde_json::Value::String(format!("{value:?}")),
        _ => serde_json::Value::Null,
    }
}

fn get_string(row: &Row, index: usize) -> Option<String> {
    row.get::<&str, _>(index).map(str::to_string)
}

fn get_i64(row: &Row, index: usize) -> Option<i64> {
    row.get(index)
}

fn get_i32(row: &Row, index: usize) -> Option<i32> {
    row.get(index)
}

fn get_i16(row: &Row, index: usize) -> Option<i16> {
    row.get(index)
}

fn get_u8(row: &Row, index: usize) -> Option<u8> {
    row.get(index)
}

fn get_bool(row: &Row, index: usize) -> Option<bool> {
    row.get(index)
}

fn escape_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn map_mssql_connection_error(error: tiberius::error::Error) -> AppError {
    AppError::ConnectionFailed {
        driver: "mssql".to_string(),
        message: error.to_string(),
    }
}

fn map_mssql_query_error(sql: &str, error: tiberius::error::Error) -> AppError {
    AppError::QueryFailed {
        sql: sql.to_string(),
        message: error.to_string(),
    }
}
