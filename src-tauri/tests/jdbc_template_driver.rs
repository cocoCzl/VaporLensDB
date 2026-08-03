// Requires real databases and local JDBC driver jars.
// Run with:
// TEST_PG_JDBC_URL='jdbc:postgresql://<host>:5432/<database>' TEST_PG_USER=<user> TEST_PG_PASSWORD=<password> TEST_PG_JDBC_DRIVER_PATH=/path/to/postgresql.jar cargo test --test jdbc_template_driver -- --ignored
// TEST_MYSQL_JDBC_URL='jdbc:mysql://<host>:3306/<database>' TEST_MYSQL_USER=<user> TEST_MYSQL_PASSWORD=<password> TEST_MYSQL_JDBC_DRIVER_PATH=/path/to/mysql-connector-j.jar cargo test --test jdbc_template_driver -- --ignored

use chrono::Utc;
use uuid::Uuid;
use vapor_lens_db_lib::{
    drivers::{jdbc::JdbcDriver, trait_def::DatabaseDriver},
    models::connection::{ConnectionConfig, DriverType},
    services::driver_catalog::driver_definitions,
};

#[tokio::test]
#[ignore = "requires TEST_PG_JDBC_URL and TEST_PG_JDBC_DRIVER_PATH"]
async fn postgres_jdbc_template_queries_and_reads_metadata() {
    let (config, password) = jdbc_config(JdbcLiveConfig {
        definition_id: "jdbc-postgresql",
        driver_type: DriverType::Postgres,
        dialect: "postgresql",
        url_env: "TEST_PG_JDBC_URL",
        user_env: "TEST_PG_USER",
        password_env: "TEST_PG_PASSWORD",
        path_env: "TEST_PG_JDBC_DRIVER_PATH",
        driver_class: "org.postgresql.Driver",
    })
    .expect("TEST_PG_JDBC_URL and TEST_PG_JDBC_DRIVER_PATH must be set");
    let definition = driver_definition("jdbc-postgresql");
    let driver = JdbcDriver::connect(&config, Some(&password), Some(&definition))
        .await
        .expect("connect postgres JDBC template");

    driver.ping().await.expect("ping postgres JDBC template");

    let result = driver
        .execute_query("SELECT 1 AS value", None)
        .await
        .expect("query postgres JDBC template");
    assert_eq!(result.row_count, 1);
    assert_one(&result.rows[0][0]);

    let schema = format!("vaporlensdb_jdbc_{}", Uuid::new_v4().simple());
    driver
        .execute_query(&format!(r#"CREATE SCHEMA "{schema}""#), None)
        .await
        .expect("create postgres JDBC schema");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE "{schema}".parent_items (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR(64) NOT NULL
                )
                "#
            ),
            None,
        )
        .await
        .expect("create postgres JDBC parent table");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE "{schema}".child_items (
                    id INTEGER PRIMARY KEY,
                    parent_id INTEGER NOT NULL REFERENCES "{schema}".parent_items(id),
                    note VARCHAR(128)
                )
                "#
            ),
            None,
        )
        .await
        .expect("create postgres JDBC child table");
    driver
        .execute_query(
            &format!(r#"CREATE INDEX idx_child_parent ON "{schema}".child_items(parent_id)"#),
            None,
        )
        .await
        .expect("create postgres JDBC index");
    driver
        .execute_query(
            &format!(
                r#"CREATE VIEW "{schema}".child_item_view AS SELECT id, parent_id, note FROM "{schema}".child_items"#
            ),
            None,
        )
        .await
        .expect("create postgres JDBC view");

    assert_template_metadata(
        &driver,
        &schema,
        "child_items",
        "parent_items",
        "child_item_view",
    )
    .await;

    driver
        .execute_query(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#), None)
        .await
        .expect("drop postgres JDBC schema");
}

#[tokio::test]
#[ignore = "requires TEST_MYSQL_JDBC_URL and TEST_MYSQL_JDBC_DRIVER_PATH"]
async fn mysql_jdbc_template_queries_and_reads_metadata() {
    let (config, password) = jdbc_config(JdbcLiveConfig {
        definition_id: "jdbc-mysql",
        driver_type: DriverType::Mysql,
        dialect: "mysql",
        url_env: "TEST_MYSQL_JDBC_URL",
        user_env: "TEST_MYSQL_USER",
        password_env: "TEST_MYSQL_PASSWORD",
        path_env: "TEST_MYSQL_JDBC_DRIVER_PATH",
        driver_class: "com.mysql.cj.jdbc.Driver",
    })
    .expect("TEST_MYSQL_JDBC_URL and TEST_MYSQL_JDBC_DRIVER_PATH must be set");
    let definition = driver_definition("jdbc-mysql");
    let driver = JdbcDriver::connect(&config, Some(&password), Some(&definition))
        .await
        .expect("connect mysql JDBC template");

    driver.ping().await.expect("ping mysql JDBC template");

    let result = driver
        .execute_query("SELECT 1 AS value", None)
        .await
        .expect("query mysql JDBC template");
    assert_eq!(result.row_count, 1);
    assert_one(&result.rows[0][0]);

    let schema = format!("vaporlensdb_jdbc_{}", Uuid::new_v4().simple());
    driver
        .execute_query(&format!("CREATE DATABASE `{schema}`"), None)
        .await
        .expect("create mysql JDBC schema");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE `{schema}`.parent_items (
                    id INT NOT NULL PRIMARY KEY,
                    name VARCHAR(64) NOT NULL
                )
                "#
            ),
            None,
        )
        .await
        .expect("create mysql JDBC parent table");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE `{schema}`.child_items (
                    id INT NOT NULL PRIMARY KEY,
                    parent_id INT NOT NULL,
                    note VARCHAR(128),
                    INDEX idx_child_parent (parent_id),
                    CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES parent_items(id)
                )
                "#
            ),
            None,
        )
        .await
        .expect("create mysql JDBC child table");
    driver
        .execute_query(
            &format!(
                "CREATE VIEW `{schema}`.child_item_view AS SELECT id, parent_id, note FROM `{schema}`.child_items"
            ),
            None,
        )
        .await
        .expect("create mysql JDBC view");

    assert_template_metadata(
        &driver,
        &schema,
        "child_items",
        "parent_items",
        "child_item_view",
    )
    .await;

    driver
        .execute_query(&format!("DROP DATABASE `{schema}`"), None)
        .await
        .expect("drop mysql JDBC schema");
}

async fn assert_template_metadata(
    driver: &JdbcDriver,
    schema: &str,
    child: &str,
    parent: &str,
    view: &str,
) {
    let schemas = driver.get_schemas(None).await.expect("get JDBC schemas");
    assert!(schemas.iter().any(|item| item.name == schema));

    let tables = driver.get_tables(schema).await.expect("get JDBC tables");
    assert!(tables.iter().any(|item| item.name == child));

    let columns = driver
        .get_columns(schema, child)
        .await
        .expect("get JDBC columns");
    assert!(columns
        .iter()
        .any(|item| item.name == "id" && item.is_primary_key));
    assert!(columns.iter().any(|item| item.name == "parent_id"));

    let indexes = driver
        .get_indexes(schema, child)
        .await
        .expect("get JDBC indexes");
    assert!(!indexes.is_empty());

    let foreign_keys = driver
        .get_foreign_keys(schema, child)
        .await
        .expect("get JDBC foreign keys");
    assert!(foreign_keys
        .iter()
        .any(|item| item.referenced_table == parent && item.referenced_columns == vec!["id"]));

    let views = driver.get_views(schema).await.expect("get JDBC views");
    assert!(views.iter().any(|item| item.name == view));
}

struct JdbcLiveConfig {
    definition_id: &'static str,
    driver_type: DriverType,
    dialect: &'static str,
    url_env: &'static str,
    user_env: &'static str,
    password_env: &'static str,
    path_env: &'static str,
    driver_class: &'static str,
}

fn jdbc_config(live: JdbcLiveConfig) -> Option<(ConnectionConfig, String)> {
    let now = Utc::now();
    Some((
        ConnectionConfig {
            id: Uuid::new_v4(),
            name: format!("{} live integration", live.definition_id),
            driver_definition_id: Some(live.definition_id.to_string()),
            driver_type: live.driver_type,
            driver_dialect: Some(live.dialect.to_string()),
            host: None,
            port: None,
            database: None,
            connection_url: Some(std::env::var(live.url_env).ok()?),
            username: Some(std::env::var(live.user_env).unwrap_or_default()),
            password_encrypted: None,
            has_saved_password: false,
            driver_class: Some(live.driver_class.to_string()),
            driver_paths: vec![std::env::var(live.path_env).ok()?],
            ssl_mode: None,
            group_id: None,
            group: None,
            color_tag: None,
            ssh_tunnel: None,
            created_at: now,
            updated_at: now,
        },
        std::env::var(live.password_env).unwrap_or_default(),
    ))
}

fn driver_definition(id: &str) -> vapor_lens_db_lib::models::driver_catalog::DriverDefinition {
    driver_definitions()
        .into_iter()
        .find(|definition| definition.id == id)
        .unwrap_or_else(|| panic!("{id} driver definition"))
}

fn assert_one(value: &serde_json::Value) {
    let is_one = value.as_i64() == Some(1) || value.as_str() == Some("1");
    assert!(is_one, "expected 1 or \"1\", got {value}");
}
