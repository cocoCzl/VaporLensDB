// Requires a real MySQL database.
// Run with:
// TEST_MYSQL_JDBC_URL='jdbc:mysql://localhost:3306/mysql' TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD=password cargo test --test mysql_driver -- --ignored

use tokio::sync::mpsc;
use uuid::Uuid;
use vapor_lens_db_lib::drivers::{mysql::MysqlDriver, trait_def::DatabaseDriver};

#[derive(Debug)]
struct MysqlTestConfig {
    host: String,
    port: u16,
    database: String,
    user: String,
    password: String,
}

fn test_mysql_config() -> Option<MysqlTestConfig> {
    let jdbc_url = std::env::var("TEST_MYSQL_JDBC_URL").ok()?;
    let target = jdbc_url.strip_prefix("jdbc:mysql://")?;
    let (host_port, database) = target.split_once('/').unwrap_or((target, ""));
    let (host, port) = host_port.split_once(':').unwrap_or((host_port, "3306"));
    let user = std::env::var("TEST_MYSQL_USER").unwrap_or_else(|_| "root".to_string());
    let database = std::env::var("TEST_MYSQL_DATABASE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            database
                .split('?')
                .next()
                .filter(|value| !value.is_empty())
                .unwrap_or("mysql")
                .to_string()
        });

    Some(MysqlTestConfig {
        host: host.to_string(),
        port: port.parse().ok()?,
        database,
        user,
        password: std::env::var("TEST_MYSQL_PASSWORD").unwrap_or_default(),
    })
}

async fn connect_mysql() -> MysqlDriver {
    let config = test_mysql_config().expect("TEST_MYSQL_JDBC_URL must be set");
    MysqlDriver::connect_with_params(
        &config.host,
        config.port,
        &config.database,
        &config.user,
        &config.password,
    )
    .await
    .expect("connect mysql")
}

#[tokio::test]
#[ignore = "requires TEST_MYSQL_JDBC_URL"]
async fn connects_and_reads_mysql_metadata() {
    let driver = connect_mysql().await;

    driver.ping().await.expect("ping mysql");

    let databases = driver.get_databases().await.expect("get databases");
    assert!(!databases.is_empty());

    let result = driver
        .execute_query("SELECT 1 AS value", None)
        .await
        .expect("execute query");
    assert_eq!(result.row_count, 1);
    assert_one(&result.rows[0][0]);
}

#[tokio::test]
#[ignore = "requires TEST_MYSQL_JDBC_URL"]
async fn streams_mysql_query_in_chunks() {
    let driver = connect_mysql().await;
    let (chunk_tx, mut chunk_rx) = mpsc::channel(8);

    let summary = driver
        .execute_query_stream(
            "SELECT 1 AS value UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5",
            "mysql-stream-integration-test",
            2,
            Some(3),
            chunk_tx,
        )
        .await
        .expect("stream query");

    let mut row_count = 0;
    while let Some(chunk) = chunk_rx.recv().await {
        row_count += chunk.expect("stream chunk").rows.len();
    }

    assert_eq!(summary.row_count, 3);
    assert!(summary.truncated);
    assert_eq!(summary.max_rows, Some(3));
    assert_eq!(row_count, 3);
}

#[tokio::test]
#[ignore = "requires TEST_MYSQL_JDBC_URL"]
async fn reads_mysql_schema_objects_and_ddl() {
    let admin = connect_mysql().await;
    let schema = format!("vaporlensdb_it_{}", Uuid::new_v4().simple());
    let parent = "parent_items";
    let child = "child_items";
    let view = "child_item_view";
    let function = "child_count";

    admin
        .execute_query(&format!("CREATE DATABASE `{schema}`"), None)
        .await
        .expect("create mysql integration schema");

    let driver = connect_mysql_database(&schema).await;
    driver
        .execute_query(
            r#"
            CREATE TABLE parent_items (
                id INT NOT NULL PRIMARY KEY,
                name VARCHAR(64) NOT NULL
            )
            "#,
            None,
        )
        .await
        .expect("create mysql parent table");
    driver
        .execute_query(
            r#"
            CREATE TABLE child_items (
                id INT NOT NULL PRIMARY KEY,
                parent_id INT NOT NULL,
                note VARCHAR(128),
                INDEX idx_child_parent (parent_id),
                CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES parent_items(id)
            )
            "#,
            None,
        )
        .await
        .expect("create mysql child table");
    driver
        .execute_query(
            "CREATE VIEW child_item_view AS SELECT id, parent_id, note FROM child_items",
            None,
        )
        .await
        .expect("create mysql view");
    driver
        .execute_query(
            "CREATE FUNCTION child_count() RETURNS INT DETERMINISTIC RETURN (SELECT COUNT(*) FROM child_items)",
            None,
        )
        .await
        .expect("create mysql function");

    let schemas = driver.get_schemas(None).await.expect("get mysql schemas");
    assert!(schemas.iter().any(|item| item.name == schema));

    let tables = driver.get_tables(&schema).await.expect("get mysql tables");
    assert!(tables.iter().any(|item| item.name == child));

    let columns = driver
        .get_columns(&schema, child)
        .await
        .expect("get mysql columns");
    assert!(columns
        .iter()
        .any(|item| item.name == "id" && item.is_primary_key));
    assert!(columns.iter().any(|item| item.name == "parent_id"));

    let indexes = driver
        .get_indexes(&schema, child)
        .await
        .expect("get mysql indexes");
    assert!(indexes
        .iter()
        .any(|item| item.name == "PRIMARY" && item.unique));
    assert!(indexes.iter().any(|item| item.name == "idx_child_parent"));

    let foreign_keys = driver
        .get_foreign_keys(&schema, child)
        .await
        .expect("get mysql foreign keys");
    assert!(foreign_keys.iter().any(|item| {
        item.name == "fk_child_parent"
            && item.columns == vec!["parent_id"]
            && item.referenced_table == parent
            && item.referenced_columns == vec!["id"]
    }));

    let views = driver.get_views(&schema).await.expect("get mysql views");
    assert!(views.iter().any(|item| item.name == view));

    let functions = driver
        .get_functions(&schema)
        .await
        .expect("get mysql functions");
    assert!(functions.iter().any(|item| item == function));

    let table_ddl = driver
        .get_table_ddl(&schema, child)
        .await
        .expect("get mysql table ddl");
    assert!(table_ddl.contains("CREATE TABLE"));
    assert!(table_ddl.contains(child));
    assert!(table_ddl.contains("fk_child_parent"));

    admin
        .execute_query(&format!("DROP DATABASE `{schema}`"), None)
        .await
        .expect("drop mysql integration schema");
}

async fn connect_mysql_database(database: &str) -> MysqlDriver {
    let mut config = test_mysql_config().expect("TEST_MYSQL_JDBC_URL must be set");
    config.database = database.to_string();
    MysqlDriver::connect_with_params(
        &config.host,
        config.port,
        &config.database,
        &config.user,
        &config.password,
    )
    .await
    .expect("connect mysql database")
}

fn assert_one(value: &serde_json::Value) {
    let is_one = value.as_i64() == Some(1) || value.as_str() == Some("1");
    assert!(is_one, "expected 1 or \"1\", got {value}");
}
