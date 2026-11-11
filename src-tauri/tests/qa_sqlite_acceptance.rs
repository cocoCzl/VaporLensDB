//! Local, bounded acceptance fixtures. No external environment or credentials.
use std::{path::PathBuf, sync::Arc};
use vapor_lens_db_lib::{
    drivers::{sqlite::SqliteDriver, trait_def::DatabaseDriver},
    services::query_engine::QueryEngine,
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("vapor-qa-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("中文 path")).unwrap();
        Self(root)
    }
    fn file(&self, name: &str) -> String {
        self.0.join("中文 path").join(name).to_str().unwrap().into()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[tokio::test]
async fn independent_observer_proves_commit_rollback_and_failed_statement_semantics() {
    let f = Fixture::new();
    let writer = SqliteDriver::connect(&f.file("transaction.sqlite"))
        .await
        .unwrap();
    println!(
        "QA_SQLITE_VERSION {}",
        writer
            .execute_query("SELECT sqlite_version()", None)
            .await
            .unwrap()
            .rows[0][0]
    );
    let observer = SqliteDriver::connect(&f.file("transaction.sqlite"))
        .await
        .unwrap();
    writer
        .execute_query(
            "CREATE TABLE qa_values(id INTEGER PRIMARY KEY, value TEXT)",
            None,
        )
        .await
        .unwrap();
    writer.begin_transaction().await.unwrap();
    writer
        .execute_query("INSERT INTO qa_values VALUES(1, '中文😀')", None)
        .await
        .unwrap();
    assert_eq!(
        observer
            .execute_query("SELECT * FROM qa_values", None)
            .await
            .unwrap()
            .row_count,
        0
    );
    assert!(writer
        .execute_query("INSERT INTO missing VALUES(1)", None)
        .await
        .is_err());
    writer.rollback_transaction().await.unwrap();
    assert_eq!(
        observer
            .execute_query("SELECT * FROM qa_values", None)
            .await
            .unwrap()
            .row_count,
        0
    );
    writer.begin_transaction().await.unwrap();
    writer
        .execute_query("INSERT INTO qa_values VALUES(2, 'committed')", None)
        .await
        .unwrap();
    writer.commit_transaction().await.unwrap();
    assert_eq!(
        observer
            .execute_query("SELECT value FROM qa_values", None)
            .await
            .unwrap()
            .rows[0][0],
        "committed"
    );
}

#[tokio::test]
async fn thirty_reconnect_rounds_do_not_mix_same_named_tables_or_results() {
    let f = Fixture::new();
    for (file, marker) in [("a.sqlite", "A"), ("b.sqlite", "B")] {
        let d = SqliteDriver::connect(&f.file(file)).await.unwrap();
        d.execute_query("CREATE TABLE qa_same(value TEXT);", None)
            .await
            .unwrap();
        d.execute_query(&format!("INSERT INTO qa_same VALUES('{marker}')"), None)
            .await
            .unwrap();
    }
    for _ in 0..30 {
        let a = SqliteDriver::connect(&f.file("a.sqlite")).await.unwrap();
        let b = SqliteDriver::connect(&f.file("b.sqlite")).await.unwrap();
        let (a, b) = tokio::join!(
            a.execute_query("SELECT * FROM qa_same", None),
            b.execute_query("SELECT * FROM qa_same", None)
        );
        assert_eq!(a.unwrap().rows[0][0], "A");
        assert_eq!(b.unwrap().rows[0][0], "B");
    }
}

#[tokio::test]
async fn query_engine_reports_partial_failure_and_rejects_oversized_batch_before_writes() {
    let d: Arc<dyn DatabaseDriver> = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
    let engine = QueryEngine::new();
    d.execute_query("CREATE TABLE qa_keep(id INTEGER)", None)
        .await
        .unwrap();
    let r = engine
        .execute_query(
            d.clone(),
            "INSERT INTO qa_keep VALUES(1); SELECT * FROM missing; INSERT INTO qa_keep VALUES(2)",
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(r.outcome, "failed");
    assert_eq!(
        r.statements.iter().map(|x| x.status).collect::<Vec<_>>(),
        ["succeeded", "failed", "notExecuted"]
    );
    assert_eq!(
        d.execute_query("SELECT * FROM qa_keep", None)
            .await
            .unwrap()
            .row_count,
        1
    );
    for count in [31, 32] {
        let r = engine
            .execute_query(
                d.clone(),
                &"SELECT 'semi;中文😀';".repeat(count),
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.statements.len(), count);
        assert_eq!(r.outcome, "completed");
    }
    assert!(engine
        .execute_query(
            d.clone(),
            &"INSERT INTO qa_keep VALUES(9);".repeat(33),
            None,
            None
        )
        .await
        .is_err());
    assert_eq!(
        d.execute_query("SELECT * FROM qa_keep", None)
            .await
            .unwrap()
            .row_count,
        1
    );
}

#[tokio::test]
async fn real_sqlite_query_engine_enforces_row_and_cell_boundaries() {
    let d: Arc<dyn DatabaseDriver> = Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
    let engine = QueryEngine::new();
    for count in [49_999, 50_000, 50_001] {
        let sql = format!("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<{count}) SELECT x FROM n");
        let r = engine
            .execute_query(d.clone(), &sql, None, None)
            .await
            .unwrap();
        assert_eq!(r.results[0].row_count, count.min(50_000));
        assert_eq!(r.results[0].truncated, count > 50_000);
    }
    // JSON quotes count toward the one-MiB cell budget.
    for bytes in [1_048_573, 1_048_574, 1_048_575] {
        let sql = format!("SELECT replace(hex(zeroblob({bytes})), '00', 'x') AS value");
        let r = engine.execute_query(d.clone(), &sql, None, None).await;
        assert_eq!(r.is_ok(), bytes <= 1_048_574, "cell payload {bytes}");
    }
}

#[test]
fn trailing_comment_is_not_an_executable_statement_or_batch_budget_entry() {
    let statements = vapor_lens_db_lib::utils::sql_parser::split_sql_statements(
        "SELECT 'semi;中文😀'; /* comment only ; */",
    );
    assert_eq!(statements.len(), 1, "comment-only suffix must not execute");
}

#[tokio::test]
async fn thirty_two_queries_with_a_trailing_comment_fit_the_batch_limit() {
    let driver: Arc<dyn DatabaseDriver> =
        Arc::new(SqliteDriver::connect(":memory:").await.unwrap());
    let response = QueryEngine::new()
        .execute_query(
            driver,
            &("SELECT 1;".repeat(32) + " -- comment only"),
            None,
            None,
        )
        .await
        .expect("32 executable statements must fit the documented batch limit");
    assert_eq!(response.outcome, "completed");
    assert_eq!(response.results.len(), 32);
}
