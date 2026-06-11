use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::sync::mpsc;
use vapor_lens_db_lib::drivers::{sqlite::SqliteDriver, trait_def::DatabaseDriver};

static SQLITE_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn sqlite_test_path(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let sequence = SQLITE_TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "vaporlensdb-{name}-{}-{suffix}-{sequence}.sqlite",
        std::process::id()
    ))
}

struct TempSqliteDb {
    path: PathBuf,
}

impl TempSqliteDb {
    fn new() -> Self {
        let path = sqlite_test_path("driver");
        let connection = rusqlite::Connection::open(&path).expect("open temp sqlite db");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE
                );
                CREATE TABLE customers (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    FOREIGN KEY (account_id) REFERENCES accounts(id)
                );
                CREATE INDEX idx_customers_account_id ON customers(account_id);
                CREATE VIEW active_customers AS
                    SELECT id, account_id, name
                    FROM customers
                    WHERE active = 1;
                INSERT INTO accounts (id, code) VALUES (1, 'A-001');
                INSERT INTO customers (id, account_id, name, active) VALUES
                    (1, 1, 'Ada', 1),
                    (2, 1, 'Grace', 1),
                    (3, 1, 'Linus', 0);
                "#,
            )
            .expect("seed temp sqlite db");
        drop(connection);
        Self { path }
    }

    fn path_str(&self) -> &str {
        self.path.to_str().expect("utf-8 sqlite path")
    }
}

impl Drop for TempSqliteDb {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[tokio::test]
async fn connects_queries_and_streams_sqlite() {
    let db = TempSqliteDb::new();
    let driver = SqliteDriver::connect(db.path_str())
        .await
        .expect("connect sqlite");

    driver.ping().await.expect("ping sqlite");

    let result = driver
        .execute_query("SELECT name FROM customers ORDER BY id", None)
        .await
        .expect("query sqlite");
    assert_eq!(result.row_count, 3);
    assert_eq!(result.rows[0][0], serde_json::json!("Ada"));

    let (chunk_tx, mut chunk_rx) = mpsc::channel(8);
    let summary = driver
        .execute_query_stream(
            "SELECT id FROM customers ORDER BY id",
            "sqlite-stream-test",
            2,
            Some(2),
            chunk_tx,
        )
        .await
        .expect("stream sqlite query");

    let mut row_count = 0;
    while let Some(chunk) = chunk_rx.recv().await {
        row_count += chunk.expect("sqlite chunk").rows.len();
    }

    assert_eq!(summary.row_count, 2);
    assert!(summary.truncated);
    assert_eq!(row_count, 2);

    let explain = driver
        .explain_query("SELECT * FROM customers WHERE account_id = 1")
        .await
        .expect("explain sqlite query");
    assert!(matches!(
        explain.format,
        vapor_lens_db_lib::models::query_result::ExplainFormat::Json
    ));
}

#[tokio::test]
async fn reads_sqlite_metadata_and_ddl() {
    let db = TempSqliteDb::new();
    let driver = SqliteDriver::connect(db.path_str())
        .await
        .expect("connect sqlite");

    let databases = driver.get_databases().await.expect("get sqlite databases");
    assert_eq!(databases.len(), 1);
    assert!(databases[0].name.ends_with(".sqlite"));

    let schemas = driver.get_schemas(None).await.expect("get sqlite schemas");
    assert_eq!(schemas[0].name, "main");

    let tables = driver.get_tables("main").await.expect("get sqlite tables");
    assert!(tables.iter().any(|table| table.name == "customers"));

    let views = driver.get_views("main").await.expect("get sqlite views");
    assert!(views.iter().any(|view| view.name == "active_customers"));

    let columns = driver
        .get_columns("main", "customers")
        .await
        .expect("get sqlite columns");
    assert!(columns.iter().any(|column| column.name == "account_id"));
    assert!(columns.iter().any(|column| column.is_primary_key));

    let indexes = driver
        .get_indexes("main", "customers")
        .await
        .expect("get sqlite indexes");
    assert!(indexes
        .iter()
        .any(|index| index.name == "idx_customers_account_id"));

    let foreign_keys = driver
        .get_foreign_keys("main", "customers")
        .await
        .expect("get sqlite foreign keys");
    assert_eq!(foreign_keys.len(), 1);
    assert_eq!(foreign_keys[0].referenced_table, "accounts");

    let ddl = driver
        .get_table_ddl("main", "customers")
        .await
        .expect("get sqlite table ddl");
    assert!(ddl.contains("CREATE TABLE customers"));

    let index_objects = driver
        .get_schema_objects(
            "main",
            vapor_lens_db_lib::models::metadata::DbObjectKind::Index,
        )
        .await
        .expect("get sqlite index objects");
    assert!(index_objects
        .iter()
        .any(|object| object.name == "idx_customers_account_id"));

    let view_ddl = driver
        .get_object_ddl(
            "main",
            "active_customers",
            vapor_lens_db_lib::models::metadata::DbObjectKind::View,
        )
        .await
        .expect("get sqlite view ddl");
    assert!(view_ddl.contains("CREATE VIEW active_customers"));
}
