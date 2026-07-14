// Requires a real PostgreSQL database.
// Run with:
// TEST_PG_URL='host=<postgres-host> port=5432 dbname=<postgres-database> user=<postgres-user> password=<postgres-password>' cargo test --test postgres_driver -- --ignored
// TEST_PG_JDBC_URL='jdbc:postgresql://<postgres-host>:5432/<postgres-database>' TEST_PG_USER=<postgres-user> TEST_PG_PASSWORD=<postgres-password> cargo test --test postgres_driver -- --ignored

use std::{sync::Arc, time::Duration};

use tokio::sync::mpsc;
use uuid::Uuid;
use vapor_lens_db_lib::{
    drivers::{postgres::PostgresDriver, trait_def::DatabaseDriver},
    models::metadata::DbObjectKind,
};

fn test_pg_url() -> Option<String> {
    std::env::var("TEST_PG_URL").ok().or_else(|| {
        let jdbc_url = std::env::var("TEST_PG_JDBC_URL").ok()?;
        let target = jdbc_url.strip_prefix("jdbc:postgresql://")?;
        let (host_port, database) = target.split_once('/').unwrap_or((target, ""));
        let (host, port) = host_port.split_once(':').unwrap_or((host_port, "5432"));
        let user = std::env::var("TEST_PG_USER").unwrap_or_else(|_| "postgres".to_string());
        let password =
            std::env::var("TEST_PG_PASSWORD").unwrap_or_else(|_| "postgres123".to_string());
        let database = std::env::var("TEST_PG_DATABASE")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                database
                    .split('?')
                    .next()
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&user)
                    .to_string()
            });
        Some(format!(
            "host={} port={} dbname={} user={} password={}",
            host, port, database, user, password
        ))
    })
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn connects_and_reads_postgres_metadata() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres");

    driver.ping().await.expect("ping postgres");

    let databases = driver.get_databases().await.expect("get databases");
    assert!(!databases.is_empty());

    let schemas = driver.get_schemas(None).await.expect("get schemas");
    assert!(schemas.iter().any(|schema| schema.name == "public"));

    let result = driver
        .execute_query("SELECT 1::int4 AS value", None)
        .await
        .expect("execute query");
    assert_eq!(result.row_count, 1);
    assert_eq!(result.rows[0][0], serde_json::json!(1));
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn cancels_running_postgres_query() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = Arc::new(
        PostgresDriver::connect(&url)
            .await
            .expect("connect postgres"),
    );
    let query_id = "cancel-integration-test";

    let running_query = {
        let driver = Arc::clone(&driver);
        tokio::spawn(async move {
            driver
                .execute_query("SELECT pg_sleep(10)", Some(query_id))
                .await
        })
    };

    tokio::time::sleep(Duration::from_millis(250)).await;
    driver
        .cancel_query(query_id)
        .await
        .expect("cancel running postgres query");

    let result = running_query.await.expect("join running query");
    assert!(result.is_err(), "cancelled query should return an error");
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn streams_postgres_query_in_chunks() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres");
    let (chunk_tx, mut chunk_rx) = mpsc::channel(8);

    let summary = driver
        .execute_query_stream(
            "SELECT generate_series(1, 5)::int4 AS value",
            "stream-integration-test",
            2,
            None,
            chunk_tx,
        )
        .await
        .expect("stream query");

    let mut chunk_sizes = Vec::new();
    while let Some(chunk) = chunk_rx.recv().await {
        chunk_sizes.push(chunk.expect("stream chunk").rows.len());
    }

    assert_eq!(summary.row_count, 5);
    assert!(!summary.truncated);
    assert_eq!(chunk_sizes, vec![2, 2, 1]);
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn stream_respects_max_rows() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres");
    let (chunk_tx, mut chunk_rx) = mpsc::channel(8);

    let summary = driver
        .execute_query_stream(
            "SELECT generate_series(1, 5)::int4 AS value",
            "stream-limit-integration-test",
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
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn reads_postgres_schema_objects_and_ddl() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres");
    let schema = format!("vaporlensdb_it_{}", Uuid::new_v4().simple());
    let parent = "parent_items";
    let child = "child_items";
    let view = "child_item_view";
    let function = "child_count";
    let trigger_function = "child_items_default_note";
    let trigger = "child_items_before_insert";

    driver
        .execute_query(&format!("CREATE SCHEMA \"{schema}\""), None)
        .await
        .expect("create postgres integration schema");
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
        .expect("create postgres parent table");
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
        .expect("create postgres child table");
    driver
        .execute_query(
            &format!(r#"CREATE INDEX idx_child_parent ON "{schema}".child_items(parent_id)"#),
            None,
        )
        .await
        .expect("create postgres index");
    driver
        .execute_query(
            &format!(
                r#"CREATE VIEW "{schema}".child_item_view AS SELECT id, parent_id, note FROM "{schema}".child_items"#
            ),
            None,
        )
        .await
        .expect("create postgres view");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE FUNCTION "{schema}".child_count() RETURNS integer
                LANGUAGE sql
                AS $$ SELECT count(*)::integer FROM "{schema}".child_items $$
                "#
            ),
            None,
        )
        .await
        .expect("create postgres function");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE FUNCTION "{schema}".child_items_default_note() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    NEW.note := COALESCE(NEW.note, '');
                    RETURN NEW;
                END;
                $$
                "#
            ),
            None,
        )
        .await
        .expect("create postgres trigger function");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TRIGGER child_items_before_insert
                BEFORE INSERT ON "{schema}".child_items
                FOR EACH ROW EXECUTE FUNCTION "{schema}".child_items_default_note()
                "#
            ),
            None,
        )
        .await
        .expect("create postgres trigger");

    let schemas = driver
        .get_schemas(None)
        .await
        .expect("get postgres schemas");
    assert!(schemas.iter().any(|item| item.name == schema));

    let tables = driver
        .get_tables(&schema)
        .await
        .expect("get postgres tables");
    assert!(tables.iter().any(|item| item.name == child));

    let columns = driver
        .get_columns(&schema, child)
        .await
        .expect("get postgres columns");
    assert!(columns
        .iter()
        .any(|item| item.name == "id" && item.is_primary_key));
    assert!(columns.iter().any(|item| item.name == "parent_id"));

    let indexes = driver
        .get_indexes(&schema, child)
        .await
        .expect("get postgres indexes");
    assert!(indexes.iter().any(|item| item.name == "idx_child_parent"));

    let foreign_keys = driver
        .get_foreign_keys(&schema, child)
        .await
        .expect("get postgres foreign keys");
    assert!(foreign_keys.iter().any(|item| {
        item.columns == vec!["parent_id"]
            && item.referenced_schema.as_deref() == Some(schema.as_str())
            && item.referenced_table == parent
            && item.referenced_columns == vec!["id"]
    }));

    let views = driver.get_views(&schema).await.expect("get postgres views");
    assert!(views.iter().any(|item| item.name == view));

    let functions = driver
        .get_functions(&schema)
        .await
        .expect("get postgres functions");
    assert!(functions.iter().any(|item| item == function));
    assert!(functions.iter().any(|item| item == trigger_function));

    let triggers = driver
        .get_schema_objects(&schema, DbObjectKind::Trigger)
        .await
        .expect("get postgres triggers");
    assert!(triggers.iter().any(|item| item.name == trigger));

    let trigger_ddl = driver
        .get_object_ddl(&schema, trigger, DbObjectKind::Trigger)
        .await
        .expect("get postgres trigger ddl");
    assert!(trigger_ddl.contains("CREATE TRIGGER"));
    assert!(trigger_ddl.contains(trigger));

    let table_ddl = driver
        .get_table_ddl(&schema, child)
        .await
        .expect("get postgres table ddl");
    assert!(table_ddl.contains("CREATE TABLE"));
    assert!(table_ddl.contains(child));
    assert!(table_ddl.contains("idx_child_parent"));

    driver
        .execute_query(&format!("DROP SCHEMA \"{schema}\" CASCADE"), None)
        .await
        .expect("drop postgres integration schema");
}
