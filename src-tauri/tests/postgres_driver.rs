// Requires a real PostgreSQL database.
// Run with:
// TEST_PG_URL='host=localhost port=5432 dbname=penguin_farm user=postgres password=postgres123' cargo test --test postgres_driver -- --ignored
// TEST_PG_JDBC_URL='jdbc:postgresql://localhost:5432/penguin_farm' TEST_PG_USER=postgres TEST_PG_PASSWORD=postgres123 cargo test --test postgres_driver -- --ignored

use std::{sync::Arc, time::Duration};

use tokio::sync::mpsc;
use vapor_lens_db_lib::drivers::{postgres::PostgresDriver, trait_def::DatabaseDriver};

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
