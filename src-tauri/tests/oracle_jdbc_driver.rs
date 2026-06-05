// Requires a real Oracle database and a local ojdbc jar.
// Run with:
// TEST_ORACLE_JDBC_URL='jdbc:oracle:thin:@//localhost:1521/ORCLPDB1' TEST_ORACLE_USER=system TEST_ORACLE_PASSWORD=password TEST_ORACLE_JDBC_DRIVER_PATH=/path/to/ojdbc11.jar cargo test --test oracle_jdbc_driver -- --ignored

use chrono::Utc;
use uuid::Uuid;
use vapor_lens_db_lib::{
    drivers::{jdbc::JdbcDriver, trait_def::DatabaseDriver},
    models::{
        connection::{ConnectionConfig, DriverType},
        metadata::DbObjectKind,
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

    let packages = driver
        .get_schema_objects(&schema, DbObjectKind::Package)
        .await
        .expect("get oracle packages");
    if let Some(package) = packages.first() {
        let source = driver
            .get_object_ddl(&schema, &package.name, DbObjectKind::Package)
            .await
            .expect("get oracle package source");
        assert!(source.contains(&package.name));
    }
}
