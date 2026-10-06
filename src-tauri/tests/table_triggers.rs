use vapor_lens_db_lib::{
    drivers::{
        mysql::MysqlDriver, postgres::PostgresDriver, sqlite::SqliteDriver,
        trait_def::DatabaseDriver,
    },
    models::error::AppError,
};

async fn names(driver: &dyn DatabaseDriver, schema: &str, table: &str) -> Vec<String> {
    driver
        .get_table_triggers(schema, table)
        .await
        .unwrap()
        .into_iter()
        .map(|trigger| {
            assert_eq!(trigger.schema.as_deref(), Some(schema));
            trigger.name
        })
        .collect()
}

#[tokio::test]
async fn sqlite_table_triggers_are_exact_and_schema_safe() {
    let driver = SqliteDriver::connect(":memory:").await.unwrap();
    for sql in [
        "ATTACH DATABASE ':memory:' AS public",
        "ATTACH DATABASE ':memory:' AS audit",
        "CREATE TABLE public.table_a(id INTEGER)",
        "CREATE TABLE public.table_b(id INTEGER)",
        "CREATE TABLE audit.table_a(id INTEGER)",
        "CREATE TABLE public.empty_table(id INTEGER)",
        "CREATE TRIGGER public.trigger_a AFTER INSERT ON table_a BEGIN SELECT 1; END",
        "CREATE TRIGGER public.trigger_b AFTER INSERT ON table_b BEGIN SELECT 1; END",
        "CREATE TRIGGER audit.trigger_audit AFTER INSERT ON table_a BEGIN SELECT 1; END",
    ] {
        driver.execute_query(sql, None).await.unwrap();
    }
    assert_eq!(names(&driver, "public", "table_a").await, ["trigger_a"]);
    assert_eq!(names(&driver, "public", "table_b").await, ["trigger_b"]);
    assert_eq!(names(&driver, "audit", "table_a").await, ["trigger_audit"]);
    assert!(names(&driver, "public", "empty_table").await.is_empty());
    assert!(names(&driver, "public", "table_a' OR 1=1 --")
        .await
        .is_empty());
    assert!(driver
        .get_table_triggers("missing", "table_a")
        .await
        .is_err());
    assert!(driver
        .get_table_triggers("public\"; DROP TABLE table_a; --", "table_a")
        .await
        .is_err());
    assert_eq!(names(&driver, "public", "table_a").await, ["trigger_a"]);
}

// Existing native QA credentials are used only after the opt-in environment gate;
// mutations additionally require the in-database disposable marker.
async fn live_trigger_scope(postgres: bool) -> Result<(), AppError> {
    assert_eq!(
        std::env::var("VAPORLENSDB_QA_ENVIRONMENT").as_deref(),
        Ok("1")
    );
    let prefix = if postgres { "TEST_PG" } else { "TEST_MYSQL" };
    let url = std::env::var(format!("{prefix}_JDBC_URL")).expect("QA JDBC URL required");
    let (_, target) = url
        .split_once("://")
        .expect("QA URL must include authority");
    let (authority, database) = target.split_once('/').expect("QA database required");
    let (host, port) = authority.rsplit_once(':').expect("QA port required");
    let database = database.split('?').next().unwrap();
    let user = std::env::var(format!("{prefix}_USER")).expect("QA user required");
    let password = std::env::var(format!("{prefix}_PASSWORD")).expect("QA password required");
    let driver: Box<dyn DatabaseDriver> = if postgres {
        Box::new(
            PostgresDriver::connect_with_params(
                host,
                port.parse().unwrap(),
                database,
                &user,
                &password,
            )
            .await?,
        )
    } else {
        Box::new(
            MysqlDriver::connect_with_params(
                host,
                port.parse().unwrap(),
                database,
                &user,
                &password,
            )
            .await?,
        )
    };
    let marker = driver
        .execute_query(
            "SELECT environment, fixture_version FROM vaporlensdb_qa_marker",
            None,
        )
        .await?;
    assert_eq!(marker.rows.len(), 1);
    assert_eq!(marker.rows[0][0], serde_json::json!("disposable_qa"));
    assert!(
        marker.rows[0][1] == serde_json::json!(1) || marker.rows[0][1] == serde_json::json!("1")
    );
    let schema = if postgres { "public" } else { database };
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let a = format!("vl_trigger_a_{suffix}");
    let b = format!("vl_trigger_b_{suffix}");
    let ta = format!("vl_ta_{suffix}");
    let tb = format!("vl_tb_{suffix}");
    let function = format!("vl_trigger_fn_{suffix}");
    let quote = if postgres { '"' } else { '`' };
    let qualified = |name: &str| {
        format!(
            "{quote}{}{quote}.{quote}{name}{quote}",
            schema.replace(quote, &format!("{quote}{quote}"))
        )
    };
    let result: Result<(), AppError> = async {
        driver.execute_query(&format!("CREATE TABLE {} (id INTEGER)", qualified(&a)), None).await?;
        driver.execute_query(&format!("CREATE TABLE {} (id INTEGER)", qualified(&b)), None).await?;
        if !driver.get_table_triggers(schema, &a).await?.is_empty() {
            return Err(AppError::ConfigError("new table unexpectedly has triggers".into()));
        }
        if postgres {
            driver.execute_query(&format!("CREATE FUNCTION {}() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'", qualified(&function)), None).await?;
        }
        for (table, trigger) in [(&a, &ta), (&b, &tb)] {
            let sql = if postgres {
                format!("CREATE TRIGGER {trigger} BEFORE INSERT ON {} FOR EACH ROW EXECUTE FUNCTION {}()", qualified(table), qualified(&function))
            } else {
                format!("CREATE TRIGGER {} BEFORE INSERT ON {} FOR EACH ROW SET NEW.id = NEW.id", qualified(trigger), qualified(table))
            };
            driver.execute_query(&sql, None).await?;
        }
        for (table, expected) in [(&a, &ta), (&b, &tb)] {
            let triggers = driver.get_table_triggers(schema, table).await?;
            if triggers.len() != 1 || triggers[0].name != *expected || triggers[0].schema.as_deref() != Some(schema) {
                return Err(AppError::ConfigError("trigger table ownership mismatch".into()));
            }
        }
        if !driver.get_table_triggers(schema, "not_a_table").await?.is_empty() {
            return Err(AppError::ConfigError("missing table unexpectedly has triggers".into()));
        }
        Ok(())
    }.await;
    // Only UUID-owned fixture objects are cleaned up; never existing user tables.
    for table in [&a, &b] {
        driver
            .execute_query(&format!("DROP TABLE IF EXISTS {}", qualified(table)), None)
            .await?;
    }
    if postgres {
        driver
            .execute_query(
                &format!("DROP FUNCTION IF EXISTS {}()", qualified(&function)),
                None,
            )
            .await?;
    }
    result
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL QA environment and marker"]
async fn postgres_table_trigger_scope_live() {
    live_trigger_scope(true).await.unwrap();
}

#[tokio::test]
#[ignore = "requires disposable MySQL QA environment and marker"]
async fn mysql_table_trigger_scope_live() {
    live_trigger_scope(false).await.unwrap();
}
