use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;
use vapor_lens_db_lib::{
    drivers::{jdbc::JdbcDriver, trait_def::DatabaseDriver},
    models::{
        connection::{ConnectionConfig, DriverType},
        driver_catalog::{
            DriverBackend, DriverConnectionVariant, DriverDefinition, DriverDefinitionCapabilities,
            DriverStatus,
        },
    },
};

#[tokio::test]
async fn custom_jdbc_definition_connects_queries_and_reads_metadata() {
    let Some(h2_jar) = h2_driver_path() else {
        eprintln!(
            "skipping custom JDBC integration test; set TEST_CUSTOM_JDBC_DRIVER_PATH to an H2 jar"
        );
        return;
    };

    let now = Utc::now();
    let connection_url = format!(
        "jdbc:h2:mem:vaporlensdb_custom_jdbc_{};DB_CLOSE_DELAY=-1;DATABASE_TO_UPPER=TRUE",
        Uuid::new_v4().simple()
    );
    let config = ConnectionConfig {
        id: Uuid::new_v4(),
        name: "H2 custom JDBC integration".to_string(),
        driver_definition_id: Some("custom-h2".to_string()),
        driver_type: DriverType::Jdbc,
        driver_dialect: Some("genericJdbc".to_string()),
        host: None,
        port: None,
        database: None,
        connection_url: Some(connection_url),
        username: None,
        password_encrypted: None,
        driver_class: Some("org.h2.Driver".to_string()),
        driver_paths: vec![h2_jar.display().to_string()],
        ssl_mode: None,
        group_id: None,
        group: None,
        color_tag: None,
        ssh_tunnel: None,
        created_at: now,
        updated_at: now,
    };
    let definition = h2_definition();
    let driver = JdbcDriver::connect(&config, None, Some(&definition))
        .await
        .expect("connect custom JDBC H2");

    driver.ping().await.expect("ping custom JDBC");

    driver
        .execute_query(
            "CREATE TABLE accounts (id INTEGER PRIMARY KEY, code VARCHAR(32) NOT NULL)",
            None,
        )
        .await
        .expect("create H2 table");
    driver
        .execute_query("INSERT INTO accounts (id, code) VALUES (1, 'A-001')", None)
        .await
        .expect("insert H2 row");

    let result = driver
        .execute_query("SELECT code FROM accounts WHERE id = 1", None)
        .await
        .expect("query H2 row");
    assert_eq!(result.row_count, 1);
    assert_eq!(result.rows[0][0], serde_json::json!("A-001"));

    let schemas = driver.get_schemas(None).await.expect("get H2 schemas");
    assert!(schemas.iter().any(|schema| schema.name == "PUBLIC"));

    let tables = driver.get_tables("PUBLIC").await.expect("get H2 tables");
    assert!(tables.iter().any(|table| table.name == "ACCOUNTS"));

    let columns = driver
        .get_columns("PUBLIC", "ACCOUNTS")
        .await
        .expect("get H2 columns");
    assert!(columns.iter().any(|column| column.name == "ID"));
    assert!(columns.iter().any(|column| column.name == "CODE"));
}

fn h2_driver_path() -> Option<PathBuf> {
    std::env::var("TEST_CUSTOM_JDBC_DRIVER_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            let home = std::env::var("HOME").ok()?;
            [
                ".m2/repository/com/h2database/h2/2.3.232/h2-2.3.232.jar",
                ".m2/repository/com/h2database/h2/2.2.224/h2-2.2.224.jar",
                ".m2/repository/com/h2database/h2/2.0.204/h2-2.0.204.jar",
            ]
            .into_iter()
            .map(|relative| PathBuf::from(&home).join(relative))
            .find(|path| path.is_file())
        })
}

fn h2_definition() -> DriverDefinition {
    DriverDefinition {
        id: "custom-h2".to_string(),
        driver_type: DriverType::Jdbc,
        driver_dialect: "genericJdbc".to_string(),
        name: "Custom H2".to_string(),
        backend: DriverBackend::Jdbc,
        status: DriverStatus::Configurable,
        default_port: None,
        default_username: None,
        default_database: None,
        jdbc_driver_class: Some("org.h2.Driver".to_string()),
        url_template: Some("jdbc:h2:mem:{database}".to_string()),
        driver_artifact: Some("h2.jar".to_string()),
        driver_artifacts: vec![],
        user_driver_required: true,
        built_in: false,
        download_url: None,
        notes: Some("Custom JDBC integration test driver".to_string()),
        connection_variants: vec![DriverConnectionVariant {
            id: "urlOnly".to_string(),
            label: "URL only".to_string(),
            required_fields: vec!["connectionUrl".to_string()],
        }],
        metadata_dialect_sql: None,
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

#[allow(dead_code)]
fn h2_metadata_sql() -> String {
    serde_json::json!({
        "schemas": "SELECT SCHEMA_NAME AS name, CATALOG_NAME AS database_name FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME",
        "tables": "SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS name, TABLE_TYPE AS table_type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = UPPER('{schema}') AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        "columns": "SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal_position, DATA_TYPE AS data_type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS default_value, CHARACTER_MAXIMUM_LENGTH AS character_maximum_length, NUMERIC_PRECISION AS numeric_precision, NUMERIC_SCALE AS numeric_scale, FALSE AS is_primary_key FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = UPPER('{schema}') AND TABLE_NAME = UPPER('{table}') ORDER BY ORDINAL_POSITION"
    })
    .to_string()
}
