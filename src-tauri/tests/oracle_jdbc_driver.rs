// Requires a real Oracle database and a local ojdbc jar.
// Run with:
// TEST_ORACLE_JDBC_URL='jdbc:oracle:thin:@//<oracle-host>:1521/<oracle-service>' TEST_ORACLE_USER=<oracle-user> TEST_ORACLE_PASSWORD=<oracle-password> TEST_ORACLE_JDBC_DRIVER_PATH=/path/to/ojdbc11.jar cargo test --test oracle_jdbc_driver -- --ignored

use chrono::Utc;
use uuid::Uuid;
use vapor_lens_db_lib::{
    drivers::{jdbc::JdbcDriver, trait_def::DatabaseDriver},
    models::{
        connection::{ConnectionConfig, DriverType},
        metadata::{DbObjectInfo, DbObjectKind, TableInfo},
        query_result::ExplainFormat,
    },
    services::driver_catalog::driver_definitions,
};

fn test_oracle_config() -> Option<(ConnectionConfig, String)> {
    let connection_url = std::env::var("TEST_ORACLE_JDBC_URL").ok()?;
    let driver_path = std::env::var("TEST_ORACLE_JDBC_DRIVER_PATH").ok()?;
    let now = Utc::now();

    Some((
        ConnectionConfig {
            id: Uuid::new_v4(),
            name: "Oracle JDBC integration test".to_string(),
            driver_definition_id: Some("oracle".to_string()),
            driver_type: DriverType::Oracle,
            driver_dialect: Some("oracle".to_string()),
            host: None,
            port: None,
            database: None,
            connection_url: Some(connection_url),
            username: Some(std::env::var("TEST_ORACLE_USER").unwrap_or_default()),
            password_encrypted: None,
            driver_class: Some(
                std::env::var("TEST_ORACLE_JDBC_DRIVER_CLASS")
                    .unwrap_or_else(|_| "oracle.jdbc.OracleDriver".to_string()),
            ),
            driver_paths: vec![driver_path],
            ssl_mode: None,
            group: None,
            color_tag: None,
            ssh_tunnel: None,
            created_at: now,
            updated_at: now,
        },
        std::env::var("TEST_ORACLE_PASSWORD").unwrap_or_default(),
    ))
}

#[tokio::test]
#[ignore = "requires TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH"]
async fn connects_and_queries_oracle_with_jdbc_bridge() {
    let (config, password) = test_oracle_config()
        .expect("TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH must be set");
    let definition = driver_definitions()
        .into_iter()
        .find(|definition| definition.id == "oracle")
        .expect("oracle driver definition");
    let driver = JdbcDriver::connect(&config, Some(&password), Some(&definition))
        .await
        .expect("connect oracle jdbc");

    driver.ping().await.expect("ping oracle jdbc");

    let result = driver
        .execute_query("SELECT 1 AS value FROM dual", None)
        .await
        .expect("execute oracle query");
    assert_eq!(result.row_count, 1);
    assert_eq!(result.rows[0][0], serde_json::json!(1));
}

#[tokio::test]
#[ignore = "requires TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH"]
async fn explains_oracle_query_with_tabular_plan() {
    let (config, password) = test_oracle_config()
        .expect("TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH must be set");
    let definition = driver_definitions()
        .into_iter()
        .find(|definition| definition.id == "oracle")
        .expect("oracle driver definition");
    let driver = JdbcDriver::connect(&config, Some(&password), Some(&definition))
        .await
        .expect("connect oracle jdbc");

    let explain = driver
        .explain_query("SELECT 1 AS value FROM dual")
        .await
        .expect("explain oracle query");

    assert!(matches!(explain.format, ExplainFormat::Table));
    let result = explain
        .result
        .expect("Oracle explain should return a result table");
    assert!(result.rows.len() > 0);
    assert!(result
        .columns
        .iter()
        .any(|column| column.name.eq_ignore_ascii_case("PLAN_TABLE_OUTPUT")));
}

#[tokio::test]
#[ignore = "requires TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH"]
async fn reads_oracle_metadata_with_jdbc_bridge() {
    let (config, password) = test_oracle_config()
        .expect("TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH must be set");
    let definition = driver_definitions()
        .into_iter()
        .find(|definition| definition.id == "oracle")
        .expect("oracle driver definition");
    let driver = JdbcDriver::connect(&config, Some(&password), Some(&definition))
        .await
        .expect("connect oracle jdbc");
    let schema = config
        .username
        .as_deref()
        .unwrap_or("")
        .to_ascii_uppercase();

    let databases = driver.get_databases().await.expect("get oracle databases");
    assert!(!databases.is_empty());

    let schemas = driver.get_schemas(None).await.expect("get oracle schemas");
    assert!(schemas.iter().any(|item| item.name == schema));

    let tables = driver.get_tables(&schema).await.expect("get oracle tables");
    if let Some(table) = tables.first() {
        let columns = driver
            .get_columns(&schema, &table.name)
            .await
            .expect("get oracle columns");
        assert!(!columns.is_empty());

        let _indexes = driver
            .get_indexes(&schema, &table.name)
            .await
            .expect("get oracle indexes");

        let ddl = driver
            .get_object_ddl(&schema, &table.name, DbObjectKind::Table)
            .await
            .expect("get oracle table DDL");
        assert!(ddl.contains(&table.name));
    }

    let views = driver.get_views(&schema).await.expect("get oracle views");
    if let Some(view) = views.first() {
        assert_object_ddl_contains_name(&driver, &schema, view, DbObjectKind::View).await;
    }

    let mut source_candidates: Vec<(DbObjectKind, DbObjectInfo)> = Vec::new();
    for kind in [
        DbObjectKind::Table,
        DbObjectKind::View,
        DbObjectKind::MaterializedView,
        DbObjectKind::Index,
        DbObjectKind::Procedure,
        DbObjectKind::Function,
        DbObjectKind::Package,
        DbObjectKind::Sequence,
        DbObjectKind::Trigger,
        DbObjectKind::Synonym,
    ] {
        let objects = driver
            .get_schema_objects(&schema, kind.clone())
            .await
            .unwrap_or_else(|error| panic!("get oracle {kind:?} objects: {error}"));
        assert!(
            objects
                .iter()
                .all(|object| object.schema.as_deref() == Some(schema.as_str())),
            "oracle {kind:?} metadata should stay within requested schema"
        );

        if matches!(
            kind,
            DbObjectKind::Procedure
                | DbObjectKind::Function
                | DbObjectKind::Package
                | DbObjectKind::Trigger
        ) {
            if let Some(object) = objects.first() {
                source_candidates.push((kind.clone(), object.clone()));
            }
        }

        if matches!(kind, DbObjectKind::MaterializedView) {
            if let Some(object) = objects.first() {
                let ddl = driver
                    .get_object_ddl(&schema, &object.name, DbObjectKind::MaterializedView)
                    .await
                    .expect("get oracle materialized view DDL");
                assert!(ddl
                    .to_ascii_uppercase()
                    .contains(&object.name.to_ascii_uppercase()));
            }
        }
    }

    for (kind, object) in source_candidates {
        let source = driver
            .get_object_ddl(&schema, &object.name, kind.clone())
            .await
            .unwrap_or_else(|error| panic!("get oracle {kind:?} source: {error}"));
        assert!(source
            .to_ascii_uppercase()
            .contains(&object.name.to_ascii_uppercase()));
    }
}

async fn assert_object_ddl_contains_name(
    driver: &JdbcDriver,
    schema: &str,
    object: &TableInfo,
    kind: DbObjectKind,
) {
    let ddl = driver
        .get_object_ddl(schema, &object.name, kind)
        .await
        .expect("get oracle object DDL");
    assert!(ddl
        .to_ascii_uppercase()
        .contains(&object.name.to_ascii_uppercase()));
}
