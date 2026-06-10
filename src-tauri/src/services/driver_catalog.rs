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
            name: "PostgreSQL".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(5432),
            default_username: Some("postgres".to_string()),
            default_database: Some("postgres".to_string()),
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            driver_artifacts: vec![],
            odbc_driver_name: None,
            user_driver_required: false,
            built_in: true,
            notes: Some("内置 tokio-postgres，支持真实取消和流式结果。".to_string()),
            connection_variants: host_port_variants(),
            metadata_dialect_sql: Some("postgres".to_string()),
            capabilities: ready_capabilities(true),
        },
        DriverDefinition {
            id: DriverType::Mysql.to_string(),
            driver_type: DriverType::Mysql,
            name: "MySQL".to_string(),
            backend: DriverBackend::NativeRust,
            status: DriverStatus::Ready,
            default_port: Some(3306),
            default_username: Some("root".to_string()),
            default_database: None,
            jdbc_driver_class: None,
            url_template: None,
            driver_artifact: None,
            driver_artifacts: vec![],
            odbc_driver_name: None,
            user_driver_required: false,
            built_in: true,
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
            name: "Oracle（实验性，需要 JDBC 驱动）".to_string(),
            backend: DriverBackend::Jdbc,
            status: DriverStatus::Configurable,
            default_port: Some(1521),
            default_username: Some("system".to_string()),
            default_database: Some("ORCLPDB1".to_string()),
            jdbc_driver_class: Some("oracle.jdbc.OracleDriver".to_string()),
            url_template: Some("jdbc:oracle:thin:@//{host}:{port}/{database}".to_string()),
            driver_artifact: Some("ojdbc11.jar".to_string()),
            driver_artifacts: vec![],
            odbc_driver_name: None,
            user_driver_required: true,
            built_in: true,
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
        DriverDefinition {
            id: DriverType::Jdbc.to_string(),
            driver_type: DriverType::Jdbc,
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
            odbc_driver_name: None,
            user_driver_required: true,
            built_in: false,
            notes: Some("用于用户自行导入厂商 JDBC 驱动，JDBC bridge 接入后执行。".to_string()),
            connection_variants: vec![variant("urlOnly", "URL only", &["connectionUrl"])],
            metadata_dialect_sql: None,
            capabilities: jdbc_basic_capabilities(),
        },
        DriverDefinition {
            id: DriverType::Odbc.to_string(),
            driver_type: DriverType::Odbc,
            name: "自定义 ODBC".to_string(),
            backend: DriverBackend::Odbc,
            status: DriverStatus::Configurable,
            default_port: None,
            default_username: None,
            default_database: None,
            jdbc_driver_class: None,
            url_template: Some(
                "Driver={name};Server={host};Port={port};Database={database};".to_string(),
            ),
            driver_artifact: Some("系统 ODBC 驱动".to_string()),
            driver_artifacts: vec![],
            odbc_driver_name: None,
            user_driver_required: true,
            built_in: false,
            notes: Some("用于系统已安装 ODBC 驱动的数据库，ODBC bridge 接入后执行。".to_string()),
            connection_variants: vec![variant("urlOnly", "URL only", &["connectionUrl"])],
            metadata_dialect_sql: None,
            capabilities: external_pending_capabilities(),
        },
        planned_definition(
            DriverType::Sqlite,
            "SQLite",
            Some("本地文件数据库，后续用 rusqlite 接入。"),
        ),
        planned_definition(
            DriverType::Mssql,
            "SQL Server",
            Some("后续用 tiberius 原生驱动接入。"),
        ),
        planned_definition(
            DriverType::Mongo,
            "MongoDB",
            Some("后续用官方 mongodb Rust driver 接入。"),
        ),
        planned_definition(DriverType::Redis, "Redis", Some("后续用 redis-rs 接入。")),
    ]
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

fn external_pending_capabilities() -> DriverDefinitionCapabilities {
    DriverDefinitionCapabilities {
        can_connect: false,
        can_query: false,
        can_stream: false,
        can_read_metadata: false,
        can_cancel: false,
        can_generate_ddl: false,
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

fn planned_definition(id: DriverType, name: &str, notes: Option<&str>) -> DriverDefinition {
    DriverDefinition {
        id: id.to_string(),
        driver_type: id,
        name: name.to_string(),
        backend: DriverBackend::Planned,
        status: DriverStatus::Planned,
        default_port: None,
        default_username: None,
        default_database: None,
        jdbc_driver_class: None,
        url_template: None,
        driver_artifact: None,
        driver_artifacts: vec![],
        odbc_driver_name: None,
        user_driver_required: false,
        built_in: true,
        notes: notes.map(str::to_string),
        connection_variants: match id {
            DriverType::Sqlite => vec![variant("file", "File", &["connectionUrl"])],
            _ => host_port_variants(),
        },
        metadata_dialect_sql: None,
        capabilities: DriverDefinitionCapabilities {
            can_connect: false,
            can_query: false,
            can_stream: false,
            can_read_metadata: false,
            can_cancel: false,
            can_generate_ddl: false,
        },
    }
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
    use super::{driver_definitions, oracle_metadata_sql};
    use crate::models::connection::DriverType;

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

        assert!(definition.user_driver_required);
        assert!(definition.capabilities.can_read_metadata);
        assert!(definition.capabilities.can_generate_ddl);
        assert!(definition.metadata_dialect_sql.is_some());
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
}
