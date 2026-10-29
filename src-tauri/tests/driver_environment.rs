//! Runs in a dedicated process with PATH empty; does not mutate other tests' environment.
use serde_json::json;
use vapor_lens_db_lib::{
    drivers::{sqlite::SqliteDriver, trait_def::DatabaseDriver},
    models::connection::ConnectionConfig,
    services::external_driver::validate_jdbc_prerequisites,
};

#[tokio::test]
#[ignore = "run this executable with an empty PATH to verify missing Java"]
async fn native_sqlite_works_and_jdbc_reports_missing_java() {
    assert!(
        std::env::var_os("PATH").is_none_or(|v| v.is_empty()),
        "requires a dedicated empty-PATH process"
    );
    let driver = SqliteDriver::connect(":memory:").await.unwrap();
    assert_eq!(
        driver
            .execute_query("SELECT 1", None)
            .await
            .unwrap()
            .row_count,
        1
    );
    let root = std::env::temp_dir().join(format!("vapor-no-java-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let jar = root.join("fixture.jar");
    std::fs::write(&jar, b"only prerequisite file validation is reached").unwrap();
    let config:ConnectionConfig=serde_json::from_value(json!({"id":uuid::Uuid::new_v4(),"name":"Missing Java fixture","driverType":"jdbc","driverClass":"example.Driver","driverPaths":[jar],"connectionUrl":"jdbc:fixture:memory","createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()})).unwrap();
    let error = validate_jdbc_prerequisites(&config)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("Java runtime is required"), "{error}");
    std::fs::remove_dir_all(root).unwrap();
}
