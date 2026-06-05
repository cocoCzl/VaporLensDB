use std::{
    path::{Path, PathBuf},
    time::Instant,
};

use async_trait::async_trait;
use tokio::{process::Command, sync::mpsc};

use crate::{
    drivers::trait_def::DatabaseDriver,
    models::{
        connection::ConnectionConfig,
        driver_catalog::DriverDefinition,
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
    services::external_driver::{resolve_jdbc_bridge_jar, validate_jdbc_prerequisites},
};

pub struct JdbcDriver {
    config: ConnectionConfig,
    password: String,
    bridge_jar: PathBuf,
    metadata_sql: Option<JdbcMetadataSql>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcQueryOutput {
    columns: Vec<ColumnMeta>,
    rows: Vec<Vec<serde_json::Value>>,
    row_count: u64,
    affected_rows: u64,
    elapsed_ms: u64,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JdbcMetadataSql {
    databases: Option<String>,
    schemas: Option<String>,
    tables: Option<String>,
    views: Option<String>,
    columns: Option<String>,
    indexes: Option<String>,
    foreign_keys: Option<String>,
    functions: Option<String>,
    schema_objects: Option<String>,
    table_ddl: Option<String>,
    object_ddl: Option<String>,
}

impl JdbcDriver {
    pub async fn connect(
        config: &ConnectionConfig,
        password: Option<&str>,
        definition: Option<&DriverDefinition>,
    ) -> Result<Self, AppError> {
        let config = effective_jdbc_config(config, definition);
        validate_jdbc_prerequisites(&config).await?;
        let bridge_jar = resolve_jdbc_bridge_jar()?;
        let metadata_sql = definition
            .and_then(|definition| definition.metadata_dialect_sql.as_deref())
            .map(parse_metadata_sql)
            .transpose()?;
        let driver = Self {
            config,
            password: password.unwrap_or("").to_string(),
            bridge_jar,
            metadata_sql,
        };
        driver.ping().await?;
        Ok(driver)
    }

    async fn run_bridge(&self, command: &str, sql: Option<&str>) -> Result<String, AppError> {
        let driver_class = required(self.config.driver_class.as_deref(), "JDBC driver class")?;
        let connection_url = required(self.config.connection_url.as_deref(), "JDBC URL")?;
        let username = self.config.username.as_deref().unwrap_or("");
        let classpath = build_classpath(&self.bridge_jar, &self.config.driver_paths);

        let mut process = Command::new("java");
        process
            .arg("-cp")
            .arg(classpath)
            .arg("com.vaporlensdb.jdbcbridge.JdbcBridge")
            .arg(command)
            .arg(driver_class)
            .arg(connection_url)
            .arg(username)
            .arg(&self.password);

        if let Some(sql) = sql {
            process.arg(sql);
        }

        let output = process
            .output()
            .await
            .map_err(|error| AppError::ConnectionFailed {
                driver: self.driver_name().to_string(),
                message: format!("failed to run JDBC bridge: {error}"),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if command == "query" {
                return Err(AppError::QueryFailed {
                    sql: sql.unwrap_or("<unknown>").to_string(),
                    message: if stderr.is_empty() {
                        "JDBC bridge query failed without stderr".to_string()
                    } else {
                        stderr
                    },
                });
            }

            return Err(AppError::ConnectionFailed {
                driver: self.driver_name().to_string(),
                message: if stderr.is_empty() {
                    "JDBC bridge failed without stderr".to_string()
                } else {
                    stderr
                },
            });
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    async fn metadata_query(
        &self,
        operation: &str,
        selector: impl FnOnce(&JdbcMetadataSql) -> Option<&str>,
        params: &[(&str, &str)],
    ) -> Result<QueryResult, AppError> {
        let dialect = self
            .metadata_sql
            .as_ref()
            .ok_or_else(|| unsupported(operation))?;
        let template = selector(dialect).ok_or_else(|| unsupported(operation))?;
        let sql = apply_metadata_template(template, params);
        self.execute_query(&sql, None).await
    }

    async fn get_table_like_metadata(
        &self,
        operation: &str,
        schema: &str,
        selector: impl FnOnce(&JdbcMetadataSql) -> Option<&str>,
        fallback_type: TableType,
    ) -> Result<Vec<TableInfo>, AppError> {
        let result = self
            .metadata_query(operation, selector, &[("schema", schema)])
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(TableInfo {
                    schema: row_string(&result, row, &["schema", "schema_name"])
                        .or_else(|| Some(schema.to_string())),
                    name: row_string(&result, row, &["name", "table", "table_name"])?,
                    table_type: row_string(&result, row, &["table_type", "type"])
                        .map(|value| table_type_from_value(&value))
                        .unwrap_or_else(|| fallback_type.clone()),
                    row_count: row_u64(&result, row, &["row_count", "rows"]),
                })
            })
            .collect())
    }
}

#[async_trait]
impl DatabaseDriver for JdbcDriver {
    fn driver_name(&self) -> &'static str {
        "jdbc"
    }

    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            has_database: true,
            has_schema: true,
            supports_transactions: true,
            supports_explain: false,
            supports_cancel: false,
            supports_ddl: false,
            supports_streaming: false,
        }
    }

    async fn ping(&self) -> Result<(), AppError> {
        self.run_bridge("ping", None).await.map(|_| ())
    }

    async fn execute_query(
        &self,
        sql: &str,
        query_id: Option<&str>,
    ) -> Result<QueryResult, AppError> {
        let sql = normalize_jdbc_sql(sql);
        let output = self
            .run_bridge("query", Some(&sql))
            .await
            .map_err(|error| {
                if matches!(error, AppError::QueryFailed { .. }) {
                    error
                } else {
                    AppError::QueryFailed {
                        sql: sql.clone(),
                        message: error.to_string(),
                    }
                }
            })?;
        let output: JdbcQueryOutput = serde_json::from_str(&output)?;
        Ok(QueryResult {
            columns: output.columns,
            rows: output.rows,
            row_count: output.row_count,
            elapsed_ms: output.elapsed_ms,
            affected_rows: output.affected_rows,
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
        let result = self
            .metadata_query("get_databases", |sql| sql.databases.as_deref(), &[])
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| row_string(&result, row, &["name", "database", "database_name"]))
            .map(|name| DatabaseInfo { name })
            .collect())
    }

    async fn get_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, AppError> {
        let result = self
            .metadata_query(
                "get_schemas",
                |sql| sql.schemas.as_deref(),
                &[("database", database.unwrap_or(""))],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(SchemaInfo {
                    name: row_string(&result, row, &["name", "schema", "schema_name"])?,
                    database: row_string(&result, row, &["database", "database_name"]),
                })
            })
            .collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        self.get_table_like_metadata(
            "get_tables",
            schema,
            |sql| sql.tables.as_deref(),
            TableType::Table,
        )
        .await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, AppError> {
        let result = self
            .metadata_query(
                "get_columns",
                |sql| sql.columns.as_deref(),
                &[("schema", schema), ("table", table)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| {
                Some(ColumnInfo {
                    schema: row_string(&result, row, &["schema", "schema_name"])
                        .or_else(|| Some(schema.to_string())),
                    table: row_string(&result, row, &["table", "table_name"])
                        .unwrap_or_else(|| table.to_string()),
                    name: row_string(&result, row, &["name", "column", "column_name"])?,
                    ordinal_position: row_i32(&result, row, &["ordinal_position", "position"])
                        .unwrap_or((index + 1) as i32),
                    data_type: row_string(&result, row, &["data_type", "type", "type_name"])
                        .unwrap_or_else(|| "unknown".to_string()),
                    nullable: row_bool(&result, row, &["nullable", "is_nullable"]).unwrap_or(true),
                    default_value: row_string(&result, row, &["default_value", "column_default"]),
                    character_maximum_length: row_i64(
                        &result,
                        row,
                        &["character_maximum_length", "max_length"],
                    ),
                    numeric_precision: row_i32(&result, row, &["numeric_precision", "precision"]),
                    numeric_scale: row_i32(&result, row, &["numeric_scale", "scale"]),
                    is_primary_key: row_bool(&result, row, &["is_primary_key", "primary_key"])
                        .unwrap_or(false),
                })
            })
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, AppError> {
        let result = self
            .metadata_query(
                "get_indexes",
                |sql| sql.indexes.as_deref(),
                &[("schema", schema), ("table", table)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(IndexInfo {
                    schema: row_string(&result, row, &["schema", "schema_name"])
                        .or_else(|| Some(schema.to_string())),
                    table: row_string(&result, row, &["table", "table_name"])
                        .unwrap_or_else(|| table.to_string()),
                    name: row_string(&result, row, &["name", "index", "index_name"])?,
                    columns: row_string(&result, row, &["columns", "column_names"])
                        .map(split_csv)
                        .unwrap_or_default(),
                    unique: row_bool(&result, row, &["unique", "is_unique"]).unwrap_or(false),
                    definition: row_string(&result, row, &["definition", "index_definition"]),
                })
            })
            .collect())
    }

    async fn get_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, AppError> {
        let result = self
            .metadata_query(
                "get_foreign_keys",
                |sql| sql.foreign_keys.as_deref(),
                &[("schema", schema), ("table", table)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(ForeignKeyInfo {
                    schema: row_string(&result, row, &["schema", "schema_name"])
                        .or_else(|| Some(schema.to_string())),
                    table: row_string(&result, row, &["table", "table_name"])
                        .unwrap_or_else(|| table.to_string()),
                    name: row_string(&result, row, &["name", "foreign_key", "fk_name"])?,
                    columns: row_string(&result, row, &["columns", "column_names"])
                        .map(split_csv)
                        .unwrap_or_default(),
                    referenced_schema: row_string(
                        &result,
                        row,
                        &["referenced_schema", "ref_schema"],
                    ),
                    referenced_table: row_string(&result, row, &["referenced_table", "ref_table"])?,
                    referenced_columns: row_string(
                        &result,
                        row,
                        &["referenced_columns", "ref_columns"],
                    )
                    .map(split_csv)
                    .unwrap_or_default(),
                })
            })
            .collect())
    }

    async fn get_views(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        self.get_table_like_metadata(
            "get_views",
            schema,
            |sql| sql.views.as_deref(),
            TableType::View,
        )
        .await
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<String>, AppError> {
        let result = self
            .metadata_query(
                "get_functions",
                |sql| sql.functions.as_deref(),
                &[("schema", schema)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| row_string(&result, row, &["name", "function", "function_name"]))
            .collect())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let result = self
            .metadata_query(
                "get_table_ddl",
                |sql| sql.table_ddl.as_deref(),
                &[("schema", schema), ("table", table)],
            )
            .await?;
        result
            .rows
            .first()
            .and_then(|row| row_string(&result, row, &["ddl", "definition"]))
            .ok_or_else(|| AppError::QueryFailed {
                sql: "metadata table DDL".to_string(),
                message: "metadata SQL did not return a ddl column".to_string(),
            })
    }

    async fn get_schema_objects(
        &self,
        schema: &str,
        kind: DbObjectKind,
    ) -> Result<Vec<DbObjectInfo>, AppError> {
        let kind_value = db_object_kind_value(&kind);
        let result = self
            .metadata_query(
                "get_schema_objects",
                |sql| sql.schema_objects.as_deref(),
                &[("schema", schema), ("kind", kind_value)],
            )
            .await?;
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                let row_kind = row_string(&result, row, &["kind", "object_kind"])
                    .as_deref()
                    .map(db_object_kind_from_value)
                    .unwrap_or_else(|| kind.clone());
                Some(DbObjectInfo {
                    schema: row_string(&result, row, &["schema", "schema_name", "owner"])
                        .or_else(|| Some(schema.to_string())),
                    name: row_string(&result, row, &["name", "object_name"])?,
                    kind: row_kind,
                    object_type: row_string(&result, row, &["object_type", "type"]),
                    status: row_string(&result, row, &["status"]),
                })
            })
            .collect())
    }

    async fn get_object_ddl(
        &self,
        schema: &str,
        name: &str,
        kind: DbObjectKind,
    ) -> Result<String, AppError> {
        let result = self
            .metadata_query(
                "get_object_ddl",
                |sql| sql.object_ddl.as_deref(),
                &[
                    ("schema", schema),
                    ("name", name),
                    ("kind", db_object_kind_value(&kind)),
                ],
            )
            .await?;
        result
            .rows
            .first()
            .and_then(|row| row_string(&result, row, &["ddl", "definition", "source"]))
            .ok_or_else(|| AppError::QueryFailed {
                sql: "metadata object DDL".to_string(),
                message: "metadata SQL did not return a ddl column".to_string(),
            })
    }

    async fn explain_query(&self, sql: &str) -> Result<ExplainResult, AppError> {
        Ok(ExplainResult {
            format: ExplainFormat::Json,
            plan: serde_json::to_value(self.execute_query(sql, None).await?)?,
            elapsed_ms: 0,
        })
    }

    async fn cancel_query(&self, _query_id: &str) -> Result<(), AppError> {
        Err(unsupported("cancel_query"))
    }
}

fn build_classpath(bridge_jar: &Path, driver_paths: &[String]) -> String {
    let separator = if cfg!(windows) { ";" } else { ":" };
    std::iter::once(bridge_jar.display().to_string())
        .chain(driver_paths.iter().cloned())
        .collect::<Vec<_>>()
        .join(separator)
}

fn effective_jdbc_config(
    config: &ConnectionConfig,
    definition: Option<&DriverDefinition>,
) -> ConnectionConfig {
    let mut config = config.clone();
    if config
        .driver_class
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        config.driver_class =
            definition.and_then(|definition| definition.jdbc_driver_class.clone());
    }
    if config.driver_paths.is_empty() {
        if let Some(definition) = definition {
            config.driver_paths = definition.driver_artifacts.clone();
        }
    }
    config
}

fn parse_metadata_sql(value: &str) -> Result<JdbcMetadataSql, AppError> {
    serde_json::from_str(value).map_err(|error| {
        AppError::ConfigError(format!(
            "metadata dialect SQL must be a JSON object with keys like schemas/tables/columns: {error}"
        ))
    })
}

fn apply_metadata_template(template: &str, params: &[(&str, &str)]) -> String {
    params
        .iter()
        .fold(template.to_string(), |sql, (name, value)| {
            sql.replace(&format!("{{{name}}}"), &escape_sql_literal(value))
        })
}

fn escape_sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn row_string(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<String> {
    let index = column_index(result, names)?;
    match row.get(index)? {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Null => None,
        value => Some(value.to_string()),
    }
}

fn row_bool(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<bool> {
    let value = row.get(column_index(result, names)?)?;
    match value {
        serde_json::Value::Bool(value) => Some(*value),
        serde_json::Value::Number(value) => Some(value.as_i64().unwrap_or(0) != 0),
        serde_json::Value::String(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            if matches!(normalized.as_str(), "1" | "true" | "yes" | "y") {
                Some(true)
            } else if matches!(normalized.as_str(), "0" | "false" | "no" | "n") {
                Some(false)
            } else {
                None
            }
        }
        serde_json::Value::Null => None,
        _ => None,
    }
}

fn row_i32(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<i32> {
    row_i64(result, row, names).map(|value| value as i32)
}

fn row_i64(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<i64> {
    let value = row.get(column_index(result, names)?)?;
    match value {
        serde_json::Value::Number(value) => value.as_i64(),
        serde_json::Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn row_u64(result: &QueryResult, row: &[serde_json::Value], names: &[&str]) -> Option<u64> {
    row_i64(result, row, names).and_then(|value| value.try_into().ok())
}

fn column_index(result: &QueryResult, names: &[&str]) -> Option<usize> {
    result.columns.iter().position(|column| {
        names
            .iter()
            .any(|name| column.name.eq_ignore_ascii_case(name))
    })
}

fn split_csv(value: String) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn table_type_from_value(value: &str) -> TableType {
    match value.trim().to_ascii_lowercase().as_str() {
        "table" | "base table" => TableType::Table,
        "view" => TableType::View,
        "materialized view" | "materialized_view" => TableType::MaterializedView,
        "system table" | "system_table" => TableType::SystemTable,
        value => TableType::Other(value.to_string()),
    }
}

fn db_object_kind_value(kind: &DbObjectKind) -> &'static str {
    match kind {
        DbObjectKind::Table => "table",
        DbObjectKind::View => "view",
        DbObjectKind::MaterializedView => "materializedView",
        DbObjectKind::Index => "index",
        DbObjectKind::Procedure => "procedure",
        DbObjectKind::Function => "function",
        DbObjectKind::Package => "package",
        DbObjectKind::Sequence => "sequence",
        DbObjectKind::Trigger => "trigger",
        DbObjectKind::Synonym => "synonym",
    }
}

fn db_object_kind_from_value(value: &str) -> DbObjectKind {
    match value.trim().to_ascii_lowercase().as_str() {
        "table" => DbObjectKind::Table,
        "view" => DbObjectKind::View,
        "materializedview" | "materialized_view" | "materialized view" => {
            DbObjectKind::MaterializedView
        }
        "index" => DbObjectKind::Index,
        "procedure" => DbObjectKind::Procedure,
        "function" => DbObjectKind::Function,
        "package" => DbObjectKind::Package,
        "sequence" => DbObjectKind::Sequence,
        "trigger" => DbObjectKind::Trigger,
        "synonym" => DbObjectKind::Synonym,
        _ => DbObjectKind::Table,
    }
}

fn required<'a>(value: Option<&'a str>, name: &str) -> Result<&'a str, AppError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::ConfigError(format!("{name} is required")))
}

fn normalize_jdbc_sql(sql: &str) -> String {
    sql.trim().trim_end_matches(';').trim_end().to_string()
}

fn unsupported(operation: &str) -> AppError {
    AppError::UnsupportedOperation {
        driver: "jdbc".to_string(),
        operation: operation.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        db_object_kind_from_value, db_object_kind_value, normalize_jdbc_sql, parse_metadata_sql,
    };
    use crate::models::metadata::DbObjectKind;

    #[test]
    fn removes_trailing_statement_semicolon_for_jdbc() {
        assert_eq!(
            normalize_jdbc_sql("SELECT 1 FROM dual;"),
            "SELECT 1 FROM dual"
        );
        assert_eq!(
            normalize_jdbc_sql("SELECT 1 FROM dual;\n"),
            "SELECT 1 FROM dual"
        );
    }

    #[test]
    fn keeps_inner_semicolon_text() {
        assert_eq!(
            normalize_jdbc_sql("SELECT ';' AS value FROM dual;"),
            "SELECT ';' AS value FROM dual"
        );
    }

    #[test]
    fn parses_extended_metadata_sql_templates() {
        let dialect = parse_metadata_sql(
            r#"{
                "databases": "SELECT name FROM dual",
                "schemaObjects": "SELECT object_name AS name FROM all_objects",
                "objectDdl": "SELECT ddl FROM dual"
            }"#,
        )
        .expect("parse metadata SQL");

        assert!(dialect.databases.is_some());
        assert!(dialect.schema_objects.is_some());
        assert!(dialect.object_ddl.is_some());
    }

    #[test]
    fn maps_oracle_object_kind_values() {
        assert_eq!(
            db_object_kind_from_value("MATERIALIZED VIEW"),
            DbObjectKind::MaterializedView
        );
        assert_eq!(db_object_kind_value(&DbObjectKind::Package), "package");
        assert_eq!(db_object_kind_value(&DbObjectKind::Synonym), "synonym");
    }
}
