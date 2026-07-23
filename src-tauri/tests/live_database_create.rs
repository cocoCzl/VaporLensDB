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
