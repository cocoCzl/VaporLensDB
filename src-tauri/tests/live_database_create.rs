//! Opt-in verification against disposable MySQL and PostgreSQL test databases.
//!
//! Run with URLs supplied through `VAPORLENSDB_TEST_MYSQL_URL` and
//! `VAPORLENSDB_TEST_POSTGRES_URL`; credentials never belong in this file.

use std::env;

use vapor_lens_db_lib::drivers::{
    mysql::MysqlDriver, postgres::PostgresDriver, trait_def::DatabaseDriver,
};

#[tokio::test]
#[ignore = "requires VAPORLENSDB_TEST_MYSQL_URL and CREATE/DROP DATABASE permission"]
async fn mysql_create_database_is_visible_and_duplicate_is_rejected() {
    let url = required_env("VAPORLENSDB_TEST_MYSQL_URL");
    let driver = MysqlDriver::connect(&url).await.expect("connect to MySQL");
    assert_mysql_disposable_qa_marker(&driver).await;
    let name = unique_name("vaporlensdb_smoke");
    let create =
        format!("CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    driver
        .execute_query(&create, Some("create"))
        .await
        .expect("create database");
    let visible = driver
        .get_databases()
        .await
        .expect("list databases")
        .iter()
        .any(|item| item.name == name);
    let duplicate_rejected = driver
        .execute_query(&create, Some("duplicate"))
        .await
        .is_err();
    let cleanup = driver
        .execute_query(
            &format!("DROP DATABASE IF EXISTS `{name}`"),
            Some("cleanup"),
        )
        .await;
    cleanup.expect("drop test database");
    assert!(visible, "created database must be visible");
    assert!(duplicate_rejected, "duplicate CREATE DATABASE must fail");
}

#[tokio::test]
#[ignore = "requires VAPORLENSDB_TEST_POSTGRES_URL and CREATEDB permission"]
async fn postgres_create_database_is_visible_and_duplicate_is_rejected() {
    let url = required_env("VAPORLENSDB_TEST_POSTGRES_URL");
    let driver = PostgresDriver::connect(&url)
        .await
        .expect("connect to PostgreSQL");
    assert_postgres_disposable_qa_marker(&driver).await;
    let name = unique_name("vaporlensdb_smoke");
    let create = format!("CREATE DATABASE \"{name}\" ENCODING 'UTF8' TEMPLATE \"template0\" TABLESPACE \"pg_default\"");

    driver
        .execute_query(&create, Some("create"))
        .await
        .expect("create database");
    let visible = driver
        .get_databases()
        .await
        .expect("list databases")
        .iter()
        .any(|item| item.name == name);
    let duplicate_rejected = driver
        .execute_query(&create, Some("duplicate"))
        .await
        .is_err();
    let cleanup = driver
        .execute_query(
            &format!("DROP DATABASE IF EXISTS \"{name}\""),
            Some("cleanup"),
        )
        .await;
    cleanup.expect("drop test database");
    assert!(visible, "created database must be visible");
    assert!(duplicate_rejected, "duplicate CREATE DATABASE must fail");
}

fn required_env(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("{name} must be set"))
}

fn unique_name(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}

async fn assert_mysql_disposable_qa_marker(driver: &MysqlDriver) {
    require_qa_environment();
    let result = driver
        .execute_query(
            "SELECT DATABASE(), environment FROM vaporlensdb_qa_marker WHERE environment = 'disposable_qa'",
            None,
        )
        .await
        .expect("verify MySQL disposable QA marker");
    assert_eq!(result.row_count, 1, "MySQL QA marker must exist");
    assert_eq!(result.rows[0][0], serde_json::json!("vaporlensdb_qa"));
    assert_eq!(result.rows[0][1], serde_json::json!("disposable_qa"));
}

async fn assert_postgres_disposable_qa_marker(driver: &PostgresDriver) {
    require_qa_environment();
    let result = driver
        .execute_query(
            "SELECT current_database(), environment FROM vaporlensdb_qa_marker WHERE environment = 'disposable_qa'",
            None,
        )
        .await
        .expect("verify PostgreSQL disposable QA marker");
    assert_eq!(result.row_count, 1, "PostgreSQL QA marker must exist");
    assert_eq!(result.rows[0][0], serde_json::json!("vaporlensdb_qa"));
    assert_eq!(result.rows[0][1], serde_json::json!("disposable_qa"));
}

fn require_qa_environment() {
    assert_eq!(
        env::var("VAPORLENSDB_QA_ENVIRONMENT").as_deref(),
        Ok("1"),
        "refusing destructive QA test without VAPORLENSDB_QA_ENVIRONMENT=1"
    );
}
