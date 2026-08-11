use crate::models::{
    connection::DriverType,
    driver_catalog::{
        DriverBackend, DriverConnectionVariant, DriverDefinition, DriverDefinitionCapabilities,
        DriverStatus,
    },
};

pub fn driver_definitions() -> Vec<DriverDefinition> {
    vec![
        DriverDefinition {
            id: DriverType::Postgres.to_string(),
            driver_type: DriverType::Postgres,
            driver_dialect: "postgresql".to_string(),
            name: "PostgreSQL".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(5432),
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            driver_artifacts: vec![],
            user_driver_required: false,
            built_in: true,
            download_url: None,
            notes: Some("内置 tokio-postgres，支持真实取消和流式结果。".to_string()),
            connection_variants: host_port_variants(),
            metadata_dialect_sql: Some("postgres".to_string()),
            capabilities: ready_capabilities(true),
        },
        DriverDefinition {
            id: DriverType::Mysql.to_string(),
            driver_type: DriverType::Mysql,
            driver_dialect: "mysql".to_string(),
            name: "MySQL".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(3306),
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            driver_artifacts: vec![],
            user_driver_required: false,
            built_in: true,
            download_url: None,
            notes: Some("内置 mysql_async，支持查询、流式结果和基础元数据。".to_string()),
            connection_variants: host_port_variants(),
            metadata_dialect_sql: Some("mysql".to_string()),
            capabilities: DriverDefinitionCapabilities {
                can_connect: true,
                can_query: true,
                can_stream: true,
                can_read_metadata: true,
                can_cancel: false,
                can_generate_ddl: true,
            },
        },
        DriverDefinition {
            id: DriverType::Oracle.to_string(),
            driver_type: DriverType::Oracle,
            driver_dialect: "oracle".to_string(),
            name: "Oracle（需要 JDBC 驱动）".to_string(),
            backend: DriverBackend::Jdbc,
            status: DriverStatus::Configurable,
            default_port: Some(1521),
            default_username: None,
            default_database: None,
            jdbc_driver_class: Some("oracle.jdbc.OracleDriver".to_string()),
            url_template: Some("jdbc:oracle:thin:@//{host}:{port}/{database}".to_string()),
            driver_artifact: Some("ojdbc11.jar".to_string()),
            driver_artifacts: vec![],
            user_driver_required: true,
            built_in: true,
            download_url: Some(
                "https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html"
                    .to_string(),
            ),
            notes: Some(
                "Oracle 需要本地 ojdbc；连接、查询、对象浏览、DDL/source 和补全可用。因授权原因不内置 ojdbc，用户需导入 jar。".to_string(),
            ),
            connection_variants: vec![
                variant(
                    "oracleService",
                    "Service Name",
                    &["host", "port", "database", "username"],
                ),
                variant(
                    "oracleSid",
                    "SID",
                    &["host", "port", "database", "username"],
                ),
                variant("urlOnly", "URL only", &["connectionUrl", "username"]),
            ],
            metadata_dialect_sql: Some(oracle_metadata_sql()),
            capabilities: DriverDefinitionCapabilities {
                can_connect: true,
                can_query: true,
                can_stream: false,
                can_read_metadata: true,
                can_cancel: false,
                can_generate_ddl: true,
            },
        },
        jdbc_template(
            JdbcTemplateSeed {
                id: "jdbc-postgresql",
                driver_type: DriverType::Postgres,
                dialect: "postgresql",
                name: "PostgreSQL JDBC",
                default_port: Some(5432),
                default_username: None,
                default_database: None,
                driver_class: "org.postgresql.Driver",
                url_template: "jdbc:postgresql://{host}:{port}/{database}",
                driver_artifact: "postgresql-*.jar",
                download_url: "https://jdbc.postgresql.org/download/",
                notes: "PostgreSQL JDBC 是原生 PostgreSQL 连接的可选路径；适合需要特定 JDBC JAR 的场景。",
                connection_variants: host_port_variants(),
                metadata_dialect_sql: Some(postgres_jdbc_metadata_sql),
            },
        ),
        jdbc_template(
            JdbcTemplateSeed {
                id: "jdbc-mysql",
                driver_type: DriverType::Mysql,
                dialect: "mysql",
                name: "MySQL JDBC",
                default_port: Some(3306),
                default_username: None,
                default_database: None,
                driver_class: "com.mysql.cj.jdbc.Driver",
                url_template: "jdbc:mysql://{host}:{port}/{database}",
                driver_artifact: "mysql-connector-j-*.jar",
                download_url: "https://dev.mysql.com/downloads/connector/j/",
                notes: "MySQL JDBC 是原生 MySQL 连接的可选路径；适合需要厂商 JDBC JAR 的场景。",
                connection_variants: host_port_variants(),
                metadata_dialect_sql: Some(mysql_jdbc_metadata_sql),
            },
        ),
        jdbc_template(
            JdbcTemplateSeed {
                id: "jdbc-sqlite",
                driver_type: DriverType::Sqlite,
                dialect: "sqlite",
                name: "SQLite JDBC",
                default_port: None,
                default_username: None,
                default_database: None,
                driver_class: "org.sqlite.JDBC",
                url_template: "jdbc:sqlite:{database}",
                driver_artifact: "sqlite-jdbc-*.jar",
                download_url: "https://github.com/xerial/sqlite-jdbc/releases",
                notes: "SQLite JDBC 是原生 SQLite 连接的可选路径；适合 JDBC 兼容性测试。",
                connection_variants: vec![variant("file", "File", &["connectionUrl"])],
                metadata_dialect_sql: None,
            },
        ),
        DriverDefinition {
            id: DriverType::Jdbc.to_string(),
            driver_type: DriverType::Jdbc,
            driver_dialect: "genericJdbc".to_string(),
            name: "自定义 JDBC".to_string(),
            backend: DriverBackend::Jdbc,
            status: DriverStatus::Configurable,
            default_port: None,
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: Some("jdbc:vendor://{host}:{port}/{database}".to_string()),
            driver_artifact: Some("*.jar".to_string()),
            driver_artifacts: vec![],
            user_driver_required: true,
            built_in: false,
            download_url: None,
            notes: Some("用于用户自行导入厂商 JDBC 驱动，JDBC bridge 接入后执行。".to_string()),
            connection_variants: vec![variant("urlOnly", "URL only", &["connectionUrl"])],
            metadata_dialect_sql: None,
            capabilities: jdbc_basic_capabilities(),
        },
        DriverDefinition {
            id: DriverType::Sqlite.to_string(),
            driver_type: DriverType::Sqlite,
            driver_dialect: "sqlite".to_string(),
            name: "SQLite".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: None,
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: Some("{database}".to_string()),
            driver_artifact: None,
            driver_artifacts: vec![],
            user_driver_required: false,
            built_in: true,
            download_url: None,
            notes: Some("内置 rusqlite，支持本地文件连接、查询和基础对象浏览。".to_string()),
            connection_variants: vec![variant("file", "File", &["connectionUrl"])],
            metadata_dialect_sql: Some("sqlite".to_string()),
            capabilities: DriverDefinitionCapabilities {
                can_connect: true,
                can_query: true,
                can_stream: false,
                can_read_metadata: true,
                can_cancel: false,
                can_generate_ddl: true,
            },
        },
        DriverDefinition {
            id: DriverType::Mssql.to_string(),
            driver_type: DriverType::Mssql,
            driver_dialect: "mssql".to_string(),
            name: "SQL Server".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(1433),
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            driver_artifacts: vec![],
            user_driver_required: false,
            built_in: true,
            download_url: None,
            notes: Some("内置 tiberius，支持 SQL Server 连接、查询和基础对象浏览。".to_string()),
            connection_variants: vec![variant(
                "hostPort",
                "Host / port",
                &["host", "port", "database", "username", "password"],
            )],
            metadata_dialect_sql: Some("mssql".to_string()),
            capabilities: ready_capabilities(false),
        },
    ]
}

struct JdbcTemplateSeed {
    id: &'static str,
    driver_type: DriverType,
    dialect: &'static str,
    name: &'static str,
    default_port: Option<u16>,
    default_username: Option<&'static str>,
    default_database: Option<&'static str>,
    driver_class: &'static str,
    url_template: &'static str,
    driver_artifact: &'static str,
    download_url: &'static str,
    notes: &'static str,
    connection_variants: Vec<DriverConnectionVariant>,
    metadata_dialect_sql: Option<fn() -> String>,
}

fn jdbc_template(seed: JdbcTemplateSeed) -> DriverDefinition {
    DriverDefinition {
        id: seed.id.to_string(),
        driver_type: seed.driver_type,
        driver_dialect: seed.dialect.to_string(),
        name: seed.name.to_string(),
        backend: DriverBackend::Jdbc,
        status: DriverStatus::Configurable,
        default_port: seed.default_port,
        default_username: seed.default_username.map(str::to_string),
        default_database: seed.default_database.map(str::to_string),
        jdbc_driver_class: Some(seed.driver_class.to_string()),
        url_template: Some(seed.url_template.to_string()),
        driver_artifact: Some(seed.driver_artifact.to_string()),
        driver_artifacts: vec![],
        user_driver_required: true,
        built_in: true,
        download_url: Some(seed.download_url.to_string()),
        notes: Some(seed.notes.to_string()),
        connection_variants: seed.connection_variants,
        metadata_dialect_sql: seed.metadata_dialect_sql.map(|build| build()),
        capabilities: DriverDefinitionCapabilities {
            can_connect: true,
            can_query: true,
            can_stream: false,
            can_read_metadata: true,
            can_cancel: false,
            can_generate_ddl: false,
        },
    }
}

fn ready_capabilities(can_cancel: bool) -> DriverDefinitionCapabilities {
    DriverDefinitionCapabilities {
        can_connect: true,
        can_query: true,
        can_stream: true,
        can_read_metadata: true,
        can_cancel,
        can_generate_ddl: true,
    }
}

fn jdbc_basic_capabilities() -> DriverDefinitionCapabilities {
    DriverDefinitionCapabilities {
        can_connect: true,
        can_query: true,
        can_stream: false,
        can_read_metadata: false,
        can_cancel: false,
        can_generate_ddl: false,
    }
}

fn postgres_jdbc_metadata_sql() -> String {
    serde_json::json!({
        "databases": "SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY datname",
        "schemas": "SELECT schema_name AS name, current_database() AS database_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY schema_name",
        "tables": "SELECT table_schema AS schema_name, table_name AS name, table_type, CAST(NULL AS bigint) AS row_count FROM information_schema.tables WHERE table_schema = '{schema}' AND table_type = 'BASE TABLE' ORDER BY table_name",
        "views": "SELECT table_schema AS schema_name, table_name AS name, 'view' AS table_type, CAST(NULL AS bigint) AS row_count FROM information_schema.views WHERE table_schema = '{schema}' ORDER BY table_name",
        "columns": "SELECT c.table_schema AS schema_name, c.table_name AS table_name, c.column_name AS name, c.ordinal_position, c.data_type, CASE WHEN c.is_nullable = 'YES' THEN 1 ELSE 0 END AS nullable, c.column_default AS default_value, c.character_maximum_length, c.numeric_precision, c.numeric_scale, CASE WHEN kcu.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key FROM information_schema.columns c LEFT JOIN information_schema.table_constraints tc ON tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name AND kcu.column_name = c.column_name WHERE c.table_schema = '{schema}' AND c.table_name = '{table}' ORDER BY c.ordinal_position",
        "indexes": "SELECT i.schemaname AS schema_name, i.tablename AS table_name, i.indexname AS name, string_agg(a.attname::text, ', ' ORDER BY key_order.ordinality) AS column_names, pgidx.indisunique AS is_unique, i.indexdef AS definition FROM pg_indexes i JOIN pg_class tbl ON tbl.relname = i.tablename JOIN pg_namespace ns ON ns.oid = tbl.relnamespace AND ns.nspname = i.schemaname JOIN pg_class idx ON idx.relname = i.indexname AND idx.relnamespace = ns.oid JOIN pg_index pgidx ON pgidx.indexrelid = idx.oid LEFT JOIN LATERAL unnest(pgidx.indkey) WITH ORDINALITY AS key_order(attnum, ordinality) ON true LEFT JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = key_order.attnum WHERE i.schemaname = '{schema}' AND i.tablename = '{table}' GROUP BY i.schemaname, i.tablename, i.indexname, i.indexdef, pgidx.indisunique ORDER BY i.indexname",
        "foreignKeys": "SELECT tc.table_schema AS schema_name, tc.table_name AS table_name, tc.constraint_name AS name, string_agg(kcu.column_name::text, ', ' ORDER BY kcu.ordinal_position) AS column_names, ccu.table_schema AS referenced_schema, ccu.table_name AS referenced_table, string_agg(ccu.column_name::text, ', ' ORDER BY kcu.ordinal_position) AS referenced_columns FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '{schema}' AND tc.table_name = '{table}' GROUP BY tc.table_schema, tc.table_name, tc.constraint_name, ccu.table_schema, ccu.table_name ORDER BY tc.constraint_name",
        "functions": "SELECT routine_schema AS schema_name, routine_name AS name FROM information_schema.routines WHERE routine_schema = '{schema}' ORDER BY routine_name",
        "schemaObjects": "SELECT n.nspname AS schema_name, c.relname AS name, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView' WHEN 'i' THEN 'index' WHEN 'S' THEN 'sequence' ELSE c.relkind::text END AS kind, c.relkind::text AS object_type, NULL AS status FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '{schema}' AND c.relkind = CASE '{kind}' WHEN 'table' THEN 'r' WHEN 'view' THEN 'v' WHEN 'materializedView' THEN 'm' WHEN 'index' THEN 'i' WHEN 'sequence' THEN 'S' ELSE c.relkind END ORDER BY c.relname"
    })
    .to_string()
}

fn mysql_jdbc_metadata_sql() -> String {
    serde_json::json!({
        "databases": "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name",
        "schemas": "SELECT schema_name AS name, schema_name AS database_name FROM information_schema.schemata ORDER BY schema_name",
        "tables": "SELECT table_schema AS schema_name, table_name AS name, table_type, table_rows AS row_count FROM information_schema.tables WHERE table_schema = '{schema}' AND table_type = 'BASE TABLE' ORDER BY table_name",
        "views": "SELECT table_schema AS schema_name, table_name AS name, table_type, table_rows AS row_count FROM information_schema.tables WHERE table_schema = '{schema}' AND table_type = 'VIEW' ORDER BY table_name",
        "columns": "SELECT table_schema AS schema_name, table_name AS table_name, column_name AS name, ordinal_position, column_type AS data_type, CASE WHEN is_nullable = 'YES' THEN 1 ELSE 0 END AS nullable, column_default AS default_value, character_maximum_length, numeric_precision, numeric_scale, CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END AS is_primary_key FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{table}' ORDER BY ordinal_position",
        "indexes": "SELECT table_schema AS schema_name, table_name AS table_name, index_name AS name, GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ', ') AS column_names, CASE WHEN MIN(non_unique) = 0 THEN 1 ELSE 0 END AS is_unique, NULL AS definition FROM information_schema.statistics WHERE table_schema = '{schema}' AND table_name = '{table}' GROUP BY table_schema, table_name, index_name ORDER BY index_name",
        "foreignKeys": "SELECT table_schema AS schema_name, table_name AS table_name, constraint_name AS name, GROUP_CONCAT(column_name ORDER BY ordinal_position SEPARATOR ', ') AS column_names, referenced_table_schema AS referenced_schema, referenced_table_name AS referenced_table, GROUP_CONCAT(referenced_column_name ORDER BY ordinal_position SEPARATOR ', ') AS referenced_columns FROM information_schema.key_column_usage WHERE table_schema = '{schema}' AND table_name = '{table}' AND referenced_table_name IS NOT NULL GROUP BY table_schema, table_name, constraint_name, referenced_table_schema, referenced_table_name ORDER BY constraint_name",
        "functions": "SELECT routine_schema AS schema_name, routine_name AS name FROM information_schema.routines WHERE routine_schema = '{schema}' ORDER BY routine_name",
        "schemaObjects": "SELECT table_schema AS schema_name, table_name AS name, CASE table_type WHEN 'BASE TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' ELSE LOWER(table_type) END AS kind, table_type AS object_type, NULL AS status FROM information_schema.tables WHERE table_schema = '{schema}' AND CASE '{kind}' WHEN 'table' THEN table_type = 'BASE TABLE' WHEN 'view' THEN table_type = 'VIEW' ELSE false END UNION ALL SELECT routine_schema AS schema_name, routine_name AS name, LOWER(routine_type) AS kind, routine_type AS object_type, NULL AS status FROM information_schema.routines WHERE routine_schema = '{schema}' AND LOWER(routine_type) = LOWER('{kind}') ORDER BY name"
    })
    .to_string()
}

fn oracle_metadata_sql() -> String {
    serde_json::json!({
        "databases": "SELECT COALESCE(SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'SERVICE_NAME'), SYS_CONTEXT('USERENV', 'DB_NAME')) AS name FROM dual",
        "schemas": "SELECT username AS name, COALESCE(SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'SERVICE_NAME'), SYS_CONTEXT('USERENV', 'DB_NAME')) AS database FROM all_users ORDER BY CASE WHEN username = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') THEN 0 WHEN username = USER THEN 1 ELSE 2 END, username",
        "tables": "SELECT owner AS schema_name, table_name AS name, 'table' AS table_type, num_rows AS row_count FROM all_tables WHERE owner = UPPER('{schema}') AND nested = 'NO' ORDER BY table_name",
        "views": "SELECT owner AS schema_name, view_name AS name, 'view' AS table_type, CAST(NULL AS NUMBER) AS row_count FROM all_views WHERE owner = UPPER('{schema}') ORDER BY view_name",
        "columns": "SELECT c.owner AS schema_name, c.table_name AS table_name, c.column_name AS name, c.column_id AS ordinal_position, c.data_type AS data_type, CASE WHEN c.nullable = 'Y' THEN 1 ELSE 0 END AS nullable, c.data_default AS default_value, c.char_length AS character_maximum_length, c.data_precision AS numeric_precision, c.data_scale AS numeric_scale, CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key FROM all_tab_columns c LEFT JOIN (SELECT acc.owner, acc.table_name, acc.column_name FROM all_constraints ac JOIN all_cons_columns acc ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name AND acc.table_name = ac.table_name WHERE ac.constraint_type = 'P') pk ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name WHERE c.owner = UPPER('{schema}') AND c.table_name = UPPER('{table}') ORDER BY c.column_id",
        "indexes": "SELECT i.owner AS schema_name, i.table_name AS table_name, i.index_name AS name, LISTAGG(ic.column_name, ', ') WITHIN GROUP (ORDER BY ic.column_position) AS column_names, CASE WHEN i.uniqueness = 'UNIQUE' THEN 1 ELSE 0 END AS is_unique, i.index_type AS definition FROM all_indexes i LEFT JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name WHERE i.owner = UPPER('{schema}') AND i.table_name = UPPER('{table}') GROUP BY i.owner, i.table_name, i.index_name, i.uniqueness, i.index_type ORDER BY i.index_name",
        "foreignKeys": "SELECT ac.owner AS schema_name, ac.table_name AS table_name, ac.constraint_name AS name, LISTAGG(acc.column_name, ', ') WITHIN GROUP (ORDER BY acc.position) AS column_names, rc.owner AS referenced_schema, rcc.table_name AS referenced_table, LISTAGG(rcc.column_name, ', ') WITHIN GROUP (ORDER BY rcc.position) AS referenced_columns FROM all_constraints ac JOIN all_cons_columns acc ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name AND acc.table_name = ac.table_name JOIN all_constraints rc ON rc.owner = ac.r_owner AND rc.constraint_name = ac.r_constraint_name JOIN all_cons_columns rcc ON rcc.owner = rc.owner AND rcc.constraint_name = rc.constraint_name AND rcc.position = acc.position WHERE ac.constraint_type = 'R' AND ac.owner = UPPER('{schema}') AND ac.table_name = UPPER('{table}') GROUP BY ac.owner, ac.table_name, ac.constraint_name, rc.owner, rcc.table_name ORDER BY ac.constraint_name",
        "functions": "SELECT owner AS schema_name, object_name AS name FROM all_objects WHERE owner = UPPER('{schema}') AND object_type = 'FUNCTION' ORDER BY object_name",
        "schemaObjects": "SELECT owner AS schema_name, object_name AS name, CASE object_type WHEN 'TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' WHEN 'MATERIALIZED VIEW' THEN 'materializedView' WHEN 'INDEX' THEN 'index' WHEN 'PROCEDURE' THEN 'procedure' WHEN 'FUNCTION' THEN 'function' WHEN 'PACKAGE' THEN 'package' WHEN 'SEQUENCE' THEN 'sequence' WHEN 'TRIGGER' THEN 'trigger' WHEN 'SYNONYM' THEN 'synonym' ELSE LOWER(object_type) END AS kind, object_type, status FROM all_objects WHERE owner = UPPER('{schema}') AND object_type = CASE '{kind}' WHEN 'table' THEN 'TABLE' WHEN 'view' THEN 'VIEW' WHEN 'materializedView' THEN 'MATERIALIZED VIEW' WHEN 'index' THEN 'INDEX' WHEN 'procedure' THEN 'PROCEDURE' WHEN 'function' THEN 'FUNCTION' WHEN 'package' THEN 'PACKAGE' WHEN 'sequence' THEN 'SEQUENCE' WHEN 'trigger' THEN 'TRIGGER' WHEN 'synonym' THEN 'SYNONYM' ELSE UPPER('{kind}') END ORDER BY object_name",
        "tableDdl": "SELECT DBMS_METADATA.GET_DDL(CASE WHEN o.object_type = 'MATERIALIZED VIEW' THEN 'MATERIALIZED_VIEW' ELSE o.object_type END, UPPER('{table}'), UPPER('{schema}')) AS ddl FROM all_objects o WHERE o.owner = UPPER('{schema}') AND o.object_name = UPPER('{table}') AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW') FETCH FIRST 1 ROW ONLY",
        "objectDdl": "SELECT CASE WHEN CASE '{kind}' WHEN 'procedure' THEN 'SOURCE' WHEN 'function' THEN 'SOURCE' WHEN 'package' THEN 'SOURCE' WHEN 'trigger' THEN 'SOURCE' ELSE 'DDL' END = 'SOURCE' THEN (SELECT XMLAGG(XMLELEMENT(e, text).EXTRACT('//text()') ORDER BY CASE type WHEN 'PACKAGE' THEN 0 WHEN 'PACKAGE BODY' THEN 1 ELSE 0 END, line).GETCLOBVAL() FROM all_source WHERE owner = UPPER('{schema}') AND name = UPPER('{name}') AND type IN (CASE '{kind}' WHEN 'procedure' THEN 'PROCEDURE' WHEN 'function' THEN 'FUNCTION' WHEN 'package' THEN 'PACKAGE' WHEN 'trigger' THEN 'TRIGGER' ELSE 'PACKAGE' END, CASE '{kind}' WHEN 'package' THEN 'PACKAGE BODY' ELSE CASE '{kind}' WHEN 'trigger' THEN 'TRIGGER' WHEN 'procedure' THEN 'PROCEDURE' ELSE 'FUNCTION' END END)) ELSE DBMS_METADATA.GET_DDL(CASE '{kind}' WHEN 'table' THEN 'TABLE' WHEN 'view' THEN 'VIEW' WHEN 'materializedView' THEN 'MATERIALIZED_VIEW' WHEN 'index' THEN 'INDEX' WHEN 'sequence' THEN 'SEQUENCE' WHEN 'synonym' THEN 'SYNONYM' ELSE UPPER('{kind}') END, UPPER('{name}'), UPPER('{schema}')) END AS ddl FROM dual"
    })
    .to_string()
}

fn host_port_variants() -> Vec<DriverConnectionVariant> {
    vec![
        variant(
            "hostPort",
            "Host/Port",
            &["host", "port", "database", "username"],
        ),
        variant("urlOnly", "URL only", &["connectionUrl"]),
    ]
}

fn variant(id: &str, label: &str, required_fields: &[&str]) -> DriverConnectionVariant {
    DriverConnectionVariant {
        id: id.to_string(),
        label: label.to_string(),
        required_fields: required_fields
            .iter()
            .map(|field| field.to_string())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        driver_definitions, mysql_jdbc_metadata_sql, oracle_metadata_sql,
        postgres_jdbc_metadata_sql,
    };
    use crate::models::connection::DriverType;
    use serde_json::Value;

    #[test]
    fn oracle_metadata_sql_uses_non_reserved_output_aliases() {
        let sql = oracle_metadata_sql();

        assert!(sql.contains("AS schema_name"));
        assert!(sql.contains("AS column_names"));
        assert!(sql.contains("AS is_unique"));
        assert!(!sql.contains(" AS schema,"));
        assert!(!sql.contains(" AS columns,"));
        assert!(!sql.contains(" AS unique,"));
    }

    #[test]
    fn oracle_definition_declares_metadata_and_ddl_support() {
        let definition = driver_definitions()
            .into_iter()
            .find(|definition| definition.driver_type == DriverType::Oracle)
            .expect("oracle driver definition");

        assert!(!definition.name.contains("实验性"));
        assert!(definition.user_driver_required);
        assert!(definition.capabilities.can_read_metadata);
        assert!(definition.capabilities.can_generate_ddl);
        assert!(definition.metadata_dialect_sql.is_some());
    }

    #[test]
    fn jdbc_postgres_and_mysql_templates_include_metadata_sql() {
        let definitions = driver_definitions();

        for id in ["jdbc-postgresql", "jdbc-mysql"] {
            let definition = definitions
                .iter()
                .find(|definition| definition.id == id)
                .unwrap_or_else(|| panic!("{id} driver definition"));

            assert!(definition.built_in);
            assert_eq!(definition.backend.to_string(), "jdbc");
            assert!(definition.capabilities.can_read_metadata);
            assert_metadata_sql_shape(
                definition
                    .metadata_dialect_sql
                    .as_deref()
                    .unwrap_or_else(|| panic!("{id} metadata SQL")),
            );
        }
    }

    #[test]
    fn postgres_and_mysql_jdbc_metadata_sql_uses_expected_catalogs() {
        let postgres = postgres_jdbc_metadata_sql();
        assert_metadata_sql_shape(&postgres);
        assert!(postgres.contains("pg_database"));
        assert!(postgres.contains("pg_class"));
        assert!(postgres.contains("pg_namespace"));
        assert!(postgres.contains("information_schema"));

        let mysql = mysql_jdbc_metadata_sql();
        assert_metadata_sql_shape(&mysql);
        assert!(mysql.contains("information_schema.schemata"));
        assert!(mysql.contains("information_schema.tables"));
        assert!(mysql.contains("information_schema.key_column_usage"));
    }

    #[test]
    fn planned_mongo_and_redis_are_not_seeded_as_driver_definitions() {
        let definitions = driver_definitions();
        assert!(!definitions
            .iter()
            .any(|definition| definition.driver_type == DriverType::Mongo));
        assert!(!definitions
            .iter()
            .any(|definition| definition.driver_type == DriverType::Redis));
    }

    #[test]
    fn oracle_metadata_sql_covers_object_tree_without_dba_views() {
        let sql = oracle_metadata_sql();
        let normalized = sql.to_ascii_lowercase();

        for required in [
            "all_users",
            "all_tables",
            "all_views",
            "all_tab_columns",
            "all_indexes",
            "all_ind_columns",
            "all_constraints",
            "all_cons_columns",
            "all_objects",
            "all_source",
            "dbms_metadata.get_ddl",
            "materialized view",
            "procedure",
            "function",
            "package",
            "sequence",
            "trigger",
            "synonym",
        ] {
            assert!(
                normalized.contains(required),
                "oracle metadata SQL should contain {required}"
            );
        }

        for dba_only in ["dba_", "sys.all$"] {
            assert!(
                !normalized.contains(dba_only),
                "oracle metadata SQL must not depend on {dba_only}"
            );
        }
    }

    fn assert_metadata_sql_shape(sql: &str) {
        let parsed: Value = serde_json::from_str(sql).expect("metadata SQL should be JSON");
        let object = parsed
            .as_object()
            .expect("metadata SQL should be a JSON object");

        for key in [
            "databases",
            "schemas",
            "tables",
            "views",
            "columns",
            "indexes",
            "foreignKeys",
            "functions",
            "schemaObjects",
        ] {
            let value = object
                .get(key)
                .unwrap_or_else(|| panic!("metadata SQL should contain {key}"));
            assert!(
                value.as_str().is_some_and(|sql| !sql.trim().is_empty()),
                "metadata SQL key {key} should be a non-empty string"
            );
        }
    }
}
