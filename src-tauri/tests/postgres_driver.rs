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

const WRONG_PASSWORD: &str = "postgres-runtime-redaction-regression-value";

#[tokio::test]
#[ignore = "requires the repository disposable PostgreSQL QA environment"]
async fn non_owner_reads_fixture_foreign_key_and_table_ddl() {
    assert_eq!(
        std::env::var("VAPORLENSDB_QA_ENVIRONMENT").as_deref(),
        Ok("1")
    );
    let driver = PostgresDriver::connect(&test_pg_url().expect("PostgreSQL QA URL"))
        .await
        .unwrap();
    let environment = driver
        .execute_query("SELECT environment FROM public.vaporlensdb_qa_marker", None)
        .await
        .unwrap();
    assert_eq!(environment.rows[0][0], serde_json::json!("disposable_qa"));
    let ownership = driver
        .execute_query(
            "SELECT current_user = 'vaporlensdb_qa' AS qa_user,
                    pg_catalog.pg_get_userbyid(relowner) = current_user AS owns_table
             FROM pg_catalog.pg_class
             WHERE oid IN ('public.child_items'::regclass, 'public.parent_items'::regclass)",
            None,
        )
        .await
        .unwrap();
    assert_eq!(ownership.rows.len(), 2);
    for row in ownership.rows {
        assert_eq!(row, vec![serde_json::json!(true), serde_json::json!(false)]);
    }
    let foreign_keys = driver
        .get_foreign_keys("public", "child_items")
        .await
        .unwrap();
    let ddl = driver.get_table_ddl("public", "child_items").await.unwrap();
    let expected_ddl =
        "FOREIGN KEY (\"parent_id\") REFERENCES \"public\".\"parent_items\" (\"id\")";
    assert!(
        foreign_keys.len() == 1 && ddl.contains(expected_ddl),
        "non-owner FK count={}, DDL FK present={}",
        foreign_keys.len(),
        ddl.contains(expected_ddl)
    );
    let foreign_key = &foreign_keys[0];
    assert_eq!(foreign_key.schema.as_deref(), Some("public"));
    assert_eq!(foreign_key.table, "child_items");
    assert_eq!(foreign_key.name, "child_items_parent_id_fkey");
    assert_eq!(foreign_key.columns, vec!["parent_id"]);
    assert_eq!(foreign_key.referenced_schema.as_deref(), Some("public"));
    assert_eq!(foreign_key.referenced_table, "parent_items");
    assert_eq!(foreign_key.referenced_columns, vec!["id"]);
    assert!(driver
        .get_columns("public", "child_items")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "parent_id"));
    assert!(driver
        .get_indexes("public", "child_items")
        .await
        .unwrap()
        .iter()
        .any(|index| index.name == "idx_child_parent"));
    assert!(driver
        .get_tables("public")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "child_items"));
    assert!(driver
        .get_views("public")
        .await
        .unwrap()
        .iter()
        .any(|view| view.name == "child_item_view"));
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn manual_budget_and_max_rows_drain_without_aborting_the_transaction() {
    use vapor_lens_db_lib::{
        drivers::trait_def::StreamTransactionMode, services::query_engine::QueryEngine,
    };
    let driver = Arc::new(
        PostgresDriver::connect(&test_pg_url().expect("PostgreSQL test URL"))
            .await
            .unwrap(),
    );
    driver.begin_transaction().await.unwrap();
    driver
        .execute_query("CREATE TEMP TABLE phase4a_kept(value INTEGER)", None)
        .await
        .unwrap();
    driver
        .execute_query("INSERT INTO phase4a_kept VALUES(7)", None)
        .await
        .unwrap();
    let limited = QueryEngine::new()
        .execute_query_in_mode(
            driver.clone(),
            "SELECT n FROM generate_series(1,1000) AS n",
            Some("manual-maxrows".into()),
            Some(2),
            StreamTransactionMode::Manual,
        )
        .await
        .unwrap();
    assert_eq!(limited.results[0].row_count, 2);
    assert!(limited.results[0].truncated);
    let error = QueryEngine::new()
        .execute_query_in_mode(
            driver.clone(),
            "SELECT repeat('x',1048576) FROM generate_series(1,3)",
            Some("manual-bytes".into()),
            None,
            StreamTransactionMode::Manual,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "RESULT_LIMIT_EXCEEDED");
    assert!(!error.affects_transaction());
    driver
        .execute_query("INSERT INTO phase4a_kept VALUES(8)", None)
        .await
        .unwrap();
    driver.commit_transaction().await.unwrap();
    assert_eq!(
        driver
            .execute_query("SELECT COUNT(*) FROM phase4a_kept", None)
            .await
            .unwrap()
            .rows[0][0],
        serde_json::json!(2)
    );
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn auto_max_rows_preserves_side_effecting_select_completion_and_session_reuse() {
    let driver = Arc::new(
        PostgresDriver::connect(&test_pg_url().expect("PostgreSQL test URL"))
            .await
            .unwrap(),
    );
    driver
        .execute_query("CREATE TEMP TABLE phase4a1_effects(value INTEGER)", None)
        .await
        .unwrap();
    driver
        .execute_query(
            "CREATE FUNCTION pg_temp.phase4a1_effect(value INTEGER) RETURNS INTEGER
             LANGUAGE plpgsql VOLATILE AS $$
             BEGIN
                 INSERT INTO phase4a1_effects VALUES(value);
                 RETURN value;
             END $$",
            None,
        )
        .await
        .unwrap();
    let response = tokio::time::timeout(
        Duration::from_secs(10),
        vapor_lens_db_lib::services::query_engine::QueryEngine::new().execute_query(
            driver.clone(),
            "SELECT pg_temp.phase4a1_effect(n) AS value FROM generate_series(1,10) AS series(n)",
            Some("auto-maxrows".into()),
            Some(2),
        ),
    )
    .await
    .expect("successful truncation must wait for normal statement completion")
    .unwrap();
    assert_eq!(response.results[0].row_count, 2);
    assert!(response.results[0].truncated);
    assert_eq!(
        driver
            .execute_query("SELECT COUNT(*) FROM phase4a1_effects", None)
            .await
            .unwrap()
            .rows[0][0],
        serde_json::json!(10)
    );
    assert_eq!(
        driver.execute_query("SELECT 7", None).await.unwrap().rows[0][0],
        serde_json::json!(7)
    );
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn empty_select_and_parameterized_select_keep_aliases_and_types() {
    use vapor_lens_db_lib::drivers::trait_def::DbParameter;
    let driver = PostgresDriver::connect(&test_pg_url().expect("PostgreSQL test URL"))
        .await
        .unwrap();
    for (sql, expected) in [
        ("SELECT 1 AS id WHERE false", vec![("id", "int4")]),
        (
            "SELECT CAST(NULL AS bigint) AS id, CAST(NULL AS text) AS name WHERE false",
            vec![("id", "int8"), ("name", "text")],
        ),
    ] {
        let result = driver.execute_query(sql, None).await.unwrap();
        assert!(result.rows.is_empty());
        assert_eq!(result.row_count, 0);
        assert_eq!(
            result
                .columns
                .iter()
                .map(|column| (column.name.as_str(), column.data_type.as_str()))
                .collect::<Vec<_>>(),
            expected
        );
    }
    let result = driver
        .execute_parameterized(
            "SELECT $1::bigint AS id WHERE false",
            &[DbParameter::Text("7".into())],
            None,
        )
        .await
        .unwrap();
    assert_eq!(result.row_count, 0);
    assert!(result.rows.is_empty());
    assert_eq!(result.columns[0].name, "id");
    assert_eq!(result.columns[0].data_type, "int8");
    let result = driver.execute_query("SELECT 7 AS id", None).await.unwrap();
    assert_eq!(result.row_count, 1);
    assert_eq!(result.rows[0][0], serde_json::json!(7));
    driver.begin_transaction().await.unwrap();
    driver
        .execute_query(
            "CREATE TEMP TABLE phase3_metadata_fixture(id INTEGER)",
            None,
        )
        .await
        .unwrap();
    let result = driver
        .execute_parameterized(
            "INSERT INTO phase3_metadata_fixture VALUES ($1)",
            &[DbParameter::Text("7".into())],
            None,
        )
        .await
        .unwrap();
    assert!(result.columns.is_empty());
    assert_eq!(result.affected_rows, 1);
    driver.rollback_transaction().await.unwrap();
    assert_eq!(
        driver
            .execute_query("SELECT phase3_missing_column", None)
            .await
            .unwrap_err()
            .code(),
        "QUERY_FAILED"
    );
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn preserves_result_types_and_precision_in_queries_and_streams() {
    let driver = PostgresDriver::connect(&test_pg_url().expect("PostgreSQL test URL"))
        .await
        .unwrap();
    let sql = "SELECT 7::smallint, 9007199254740993::bigint, 123.4500::numeric(10,4), DATE '2026-09-22', TIMESTAMP '2026-09-22 12:34:56', '00000000-0000-0000-0000-000000000001'::uuid, decode('00ff','hex'), NULL::numeric, ARRAY[7,NULL]::smallint[], '{\"id\":9007199254740993}'::json";
    let expected = vec![
        serde_json::json!(7),
        serde_json::json!("9007199254740993"),
        serde_json::json!("123.4500"),
        serde_json::json!("2026-09-22"),
        serde_json::json!("2026-09-22 12:34:56"),
        serde_json::json!("00000000-0000-0000-0000-000000000001"),
        serde_json::json!("0x00ff"),
        serde_json::Value::Null,
        serde_json::json!([7, null]),
        serde_json::json!("{\"id\":9007199254740993}"),
    ];
    let result = driver.execute_query(sql, None).await.unwrap();
    assert_eq!(result.rows, vec![expected.clone()]);
    let (tx, mut rx) = mpsc::channel(4);
    let summary = driver
        .execute_query_stream(sql, "typed-result", 10, Some(10), tx)
        .await
        .unwrap();
    assert_eq!(summary.row_count, 1);
    assert_eq!(rx.recv().await.unwrap().unwrap().rows, vec![expected]);
    let error = driver
        .execute_query("SELECT point(1,2)", None)
        .await
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("Cannot decode PostgreSQL result column"));
}

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
    assert!(
        !driver.supports_concurrent_queries(),
        "a physical PostgreSQL session must serialize context and execution"
    );

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
async fn wrong_password_is_actionable_and_redacted() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let error = match PostgresDriver::connect_with_url_credentials(&url, None, Some(WRONG_PASSWORD))
        .await
    {
        Ok(_) => panic!("wrong PostgreSQL password unexpectedly connected"),
        Err(error) => error,
    };

    let message = error.safe_message();
    assert!(
        message.contains("password authentication failed"),
        "{message}"
    );
    assert!(message.contains("SQLSTATE 28P01"));
    assert!(!message.contains(WRONG_PASSWORD));
    assert_eq!(
        error.detail().as_deref(),
        Some("driver=postgres\nphase=authentication\ncause=authentication_failed")
    );
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
async fn cancelling_one_query_does_not_cancel_the_next_query_on_the_shared_session() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = Arc::new(
        PostgresDriver::connect(&url)
            .await
            .expect("connect postgres"),
    );

    let sleeping = {
        let driver = Arc::clone(&driver);
        tokio::spawn(async move {
            driver
                .execute_query("SELECT pg_sleep(10)", Some("cancel-isolation-sleep"))
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(250)).await;

    let queued = {
        let driver = Arc::clone(&driver);
        tokio::spawn(async move {
            driver
                .execute_query("SELECT 42::int4 AS value", Some("cancel-isolation-next"))
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(250)).await;
    driver
        .cancel_query("cancel-isolation-sleep")
        .await
        .expect("cancel only the sleeping query");

    assert!(
        sleeping.await.expect("join sleeping query").is_err(),
        "the selected query should be cancelled"
    );
    let queued = queued
        .await
        .expect("join next query")
        .expect("the next query must not be cancelled");
    assert_eq!(queued.rows[0][0], serde_json::json!(42));

    let follow_up = driver
        .execute_query(
            "SELECT 7::int4 AS value",
            Some("cancel-isolation-follow-up"),
        )
        .await
        .expect("the shared session remains usable after cancellation");
    assert_eq!(follow_up.rows[0][0], serde_json::json!(7));
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn cancellation_stops_the_query_on_the_postgres_backend() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = Arc::new(
        PostgresDriver::connect(&url)
            .await
            .expect("connect postgres query session"),
    );
    let observer = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres observer session");
    let backend = driver
        .execute_query("SELECT pg_backend_pid()::int4", None)
        .await
        .expect("read query backend pid");
    let backend_pid = backend.rows[0][0]
        .as_i64()
        .expect("backend pid is an integer");

    let sleeping = {
        let driver = Arc::clone(&driver);
        tokio::spawn(async move {
            driver
                .execute_query(
                    "SELECT pg_sleep(10) /* vaporlensdb-cancel-confirmation */",
                    Some("cancel-confirmation"),
                )
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(250)).await;
    driver
        .cancel_query("cancel-confirmation")
        .await
        .expect("send cancellation to postgres");
    assert!(
        sleeping.await.expect("join cancelled query").is_err(),
        "cancelled query should return an error"
    );

    let activity = observer
        .execute_query(
            &format!("SELECT state FROM pg_stat_activity WHERE pid = {backend_pid}"),
            None,
        )
        .await
        .expect("observe cancelled backend");
    assert_eq!(
        activity.row_count, 1,
        "query session should remain connected"
    );
    assert_eq!(activity.rows[0][0], serde_json::json!("idle"));
}

#[tokio::test]
#[ignore = "requires TEST_PG_URL or TEST_PG_JDBC_URL"]
async fn transaction_session_keeps_temp_and_uncommitted_data_for_query_explain_and_stream() {
    let url = test_pg_url().expect("TEST_PG_URL or TEST_PG_JDBC_URL must be set");
    let driver = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres transaction session");
    let observer = PostgresDriver::connect(&url)
        .await
        .expect("connect postgres observer session");

    driver.begin_transaction().await.expect("begin transaction");
    driver
        .execute_query(
            "CREATE TEMP TABLE vaporlensdb_transaction_scope(value INTEGER) ON COMMIT DROP",
            None,
        )
        .await
        .expect("create transaction-scoped temporary table");
    driver
        .execute_query(
            "INSERT INTO vaporlensdb_transaction_scope VALUES (900719)",
            None,
        )
        .await
        .expect("insert uncommitted value");

    let query = driver
        .execute_query("SELECT value FROM vaporlensdb_transaction_scope", None)
        .await
        .expect("query sees transaction-scoped value");
    assert_eq!(query.rows[0][0], serde_json::json!(900719));

    let explain = driver
        .explain_query("SELECT value FROM vaporlensdb_transaction_scope", None)
        .await
        .expect("explain resolves the transaction-scoped table");
    assert!(explain.plan.as_array().is_some_and(|plan| !plan.is_empty()));

    let (chunk_tx, mut chunk_rx) = mpsc::channel(4);
    let summary = driver
        .execute_query_stream(
            "SELECT value FROM vaporlensdb_transaction_scope",
            "transaction-scope-stream",
            100,
            Some(100),
            chunk_tx,
        )
        .await
        .expect("stream sees transaction-scoped value");
    let chunk = chunk_rx
        .recv()
        .await
        .expect("stream emits a chunk")
        .expect("stream chunk succeeds");
    assert_eq!(summary.row_count, 1);
    assert_eq!(chunk.rows[0][0], serde_json::json!(900719));

    assert!(
        observer
            .execute_query("SELECT value FROM vaporlensdb_transaction_scope", None)
            .await
            .is_err(),
        "another physical session must not see the temporary table"
    );
    driver
        .rollback_transaction()
        .await
        .expect("rollback transaction and drop temporary table");
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
    let composite_parent = "composite_parent";
    let composite_child = "composite_child";
    let cross_schema = format!("{schema}_ref");
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
        .execute_query(&format!(r#"CREATE SCHEMA "{cross_schema}""#), None)
        .await
        .expect("create postgres referenced schema");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE "{schema}"."{composite_parent}" (
                    a INTEGER NOT NULL,
                    b INTEGER NOT NULL,
                    PRIMARY KEY (a, b)
                )
                "#
            ),
            None,
        )
        .await
        .expect("create postgres composite parent table");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE "{schema}"."{composite_child}" (
                    a INTEGER NOT NULL,
                    b INTEGER NOT NULL,
                    FOREIGN KEY (a, b) REFERENCES "{schema}"."{composite_parent}" (a, b)
                )
                "#
            ),
            None,
        )
        .await
        .expect("create postgres composite child table");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE "{cross_schema}".cross_parent (
                    id INTEGER PRIMARY KEY
                )
                "#
            ),
            None,
        )
        .await
        .expect("create postgres cross-schema parent table");
    driver
        .execute_query(
            &format!(
                r#"
                CREATE TABLE "{schema}".cross_child (
                    parent_id INTEGER REFERENCES "{cross_schema}".cross_parent(id)
                )
                "#
            ),
            None,
        )
        .await
        .expect("create postgres cross-schema child table");
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

    let composite_foreign_keys = driver
        .get_foreign_keys(&schema, composite_child)
        .await
        .expect("get postgres composite foreign keys");
    assert!(composite_foreign_keys.iter().any(|item| {
        item.columns == vec!["a", "b"]
            && item.referenced_schema.as_deref() == Some(schema.as_str())
            && item.referenced_table == composite_parent
            && item.referenced_columns == vec!["a", "b"]
    }));

    let cross_schema_foreign_keys = driver
        .get_foreign_keys(&schema, "cross_child")
        .await
        .expect("get postgres cross-schema foreign keys");
    assert!(cross_schema_foreign_keys.iter().any(|item| {
        item.columns == vec!["parent_id"]
            && item.referenced_schema.as_deref() == Some(cross_schema.as_str())
            && item.referenced_table == "cross_parent"
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
    driver
        .execute_query(&format!("DROP SCHEMA \"{cross_schema}\" CASCADE"), None)
        .await
        .expect("drop postgres referenced schema");
}
