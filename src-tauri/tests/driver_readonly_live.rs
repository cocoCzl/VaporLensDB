//! Explicit read-only probe. No DDL, DML, imports, database creation or fixtures.
use serde_json::json;
use vapor_lens_db_lib::{
    drivers::{
        jdbc::JdbcDriver, mysql::MysqlDriver, postgres::PostgresDriver, trait_def::DatabaseDriver,
    },
    models::{
        connection::ConnectionConfig,
        driver_catalog::{DriverArtifact, DriverInstallation},
    },
    services::{config_store::ConfigStore, driver_registry::artifact_hash},
};
#[tokio::test]
#[ignore = "requires explicit read-only endpoint credentials and JDBC JAR"]
async fn resolved_jdbc_and_native_readonly_probe() {
    let required = |key| {
        std::env::var(key).unwrap_or_else(|_| panic!("missing required environment variable {key}"))
    };
    let url = required("TEST_READONLY_JDBC_URL");
    let user = required("TEST_READONLY_USER");
    let password = required("TEST_READONLY_PASSWORD");
    let jar = required("TEST_READONLY_JDBC_DRIVER_PATH");
    let definition_id = required("TEST_READONLY_DRIVER_DEFINITION");
    let root = std::env::temp_dir().join(format!("vapor-readonly-probe-{}", uuid::Uuid::new_v4()));
    let store = ConfigStore::new(root).unwrap();
    let definition = store
        .get_driver_definition(&definition_id)
        .unwrap()
        .expect("registered JDBC definition");
    store
        .publish_installation(&DriverInstallation {
            id: "readonly-install".into(),
            driver_definition_id: definition_id.clone(),
            label: "Read-only QA local JAR".into(),
            artifacts: vec![DriverArtifact {
                path: jar.clone(),
                sha256: Some(artifact_hash(&jar).unwrap()),
                role: "primary".into(),
            }],
            java_requirement: "Java 21+".into(),
            validation: None,
        })
        .unwrap();
    let c:ConnectionConfig=serde_json::from_value(json!({"id":uuid::Uuid::new_v4(),"name":"Read-only probe","driverType":definition.driver_type,"driverDefinitionId":definition_id,"productId":definition.product_id,"connectionMode":"urlOnly","connectionUrl":url,"username":user,"driverPaths":[],"createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()})).unwrap();
    let saved = store.create_connection(c, None, false).unwrap();
    let (runtime, definition) = store.resolve_connection(&saved).unwrap();
    let jdbc = JdbcDriver::connect(&runtime, Some(&password), Some(&definition))
        .await
        .expect("JDBC read-only connect");
    let sql = if definition.product_id == "oracle" {
        "SELECT 1 FROM dual"
    } else {
        "SELECT 1"
    };
    assert_eq!(
        jdbc.execute_query(sql, None)
            .await
            .expect("read-only JDBC scalar query")
            .row_count,
        1
    );
    assert!(!jdbc
        .get_schemas(None)
        .await
        .expect("read-only schema metadata")
        .is_empty());
    // Keep both executors alive simultaneously and retain product identity.
    if definition.product_id == "postgres" {
        let native = PostgresDriver::connect_with_url_credentials(
            url.strip_prefix("jdbc:").unwrap_or(&url),
            Some(&user),
            Some(&password),
        )
        .await
        .expect("native PG read-only connect");
        let (a, b) = tokio::join!(
            native.execute_query("SELECT 1", None),
            jdbc.execute_query("SELECT 1", None)
        );
        assert_eq!(a.unwrap().row_count, 1);
        assert_eq!(b.unwrap().row_count, 1);
    } else if definition.product_id == "mysql" {
        let native = MysqlDriver::connect_with_url_credentials(
            url.strip_prefix("jdbc:").unwrap_or(&url),
            Some(&user),
            Some(&password),
        )
        .await
        .expect("native MySQL read-only connect");
        let (a, b) = tokio::join!(
            native.execute_query("SELECT 1", None),
            jdbc.execute_query("SELECT 1", None)
        );
        assert_eq!(a.unwrap().row_count, 1);
        assert_eq!(b.unwrap().row_count, 1);
    }
}
