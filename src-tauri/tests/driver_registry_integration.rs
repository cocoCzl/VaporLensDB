//! Explicit bridge acceptance with a local H2 JAR. Never targets external databases.
use serde_json::json;
use vapor_lens_db_lib::{
    drivers::{jdbc::JdbcDriver, trait_def::DatabaseDriver},
    models::{
        connection::ConnectionConfig,
        driver_catalog::{DriverArtifact, DriverInstallation},
    },
    services::{
        config_store::ConfigStore,
        driver_registry::artifact_hash,
        external_driver::{installation_runtime_fingerprint, validate_jdbc_driver_class},
    },
};

#[tokio::test]
#[ignore = "requires TEST_CUSTOM_JDBC_DRIVER_PATH and built Java bridge"]
async fn independent_products_resolve_installations_and_fall_back_per_metadata_operation() {
    let jar =
        std::env::var("TEST_CUSTOM_JDBC_DRIVER_PATH").expect("explicit local H2 JAR required");
    let store = ConfigStore::new(
        std::env::temp_dir().join(format!("vapor-registry-bridge-{}", uuid::Uuid::new_v4())),
    )
    .unwrap();
    let mut drivers = Vec::new();
    for name in ["Any product A", "Unrelated product B"] {
        let mut definition = store.get_driver_definition("jdbc").unwrap().unwrap();
        definition.id = format!("custom-{}", uuid::Uuid::new_v4());
        definition.product_id.clear();
        definition.name = name.into();
        definition.built_in = false;
        definition.jdbc_driver_class = Some("org.h2.Driver".into());
        // Only tables has a template; every other basic operation must fall back.
        definition.metadata_dialect_sql=Some(json!({"tables":"SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS name, 'table' AS table_type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '{schema}' AND TABLE_TYPE = 'BASE TABLE'"}).to_string());
        let definition = store.save_custom_driver_definition(definition).unwrap();
        let installation = DriverInstallation {
            id: format!("installation-{}", uuid::Uuid::new_v4()),
            driver_definition_id: definition.id.clone(),
            label: "H2 local fixture (not vendor certification)".into(),
            artifacts: vec![DriverArtifact {
                path: jar.clone(),
                sha256: Some(artifact_hash(&jar).unwrap()),
                role: "primary".into(),
            }],
            java_requirement: "Java 21+".into(),
            validation: None,
        };
        store.publish_installation(&installation).unwrap();
        let c:ConnectionConfig=serde_json::from_value(json!({"id":uuid::Uuid::new_v4(),"name":name,"driverType":"jdbc","driverDefinitionId":definition.id,"driverPaths":[],"connectionUrl":format!("jdbc:h2:mem:{};DB_CLOSE_DELAY=-1",uuid::Uuid::new_v4().simple()),"createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()})).unwrap();
        let mut c = c;
        c.driver_properties =
            serde_json::from_value(json!([{"name":"MODE","value":"PostgreSQL","sensitive":true}]))
                .unwrap();
        let saved = store.create_connection(c, None, false).unwrap();
        let (runtime, definition) = store.resolve_connection(&saved).unwrap();
        validate_jdbc_driver_class(&runtime)
            .await
            .expect("actual class loading");
        let fingerprint = installation_runtime_fingerprint(&runtime).await.unwrap();
        assert_eq!(
            fingerprint,
            installation_runtime_fingerprint(&runtime).await.unwrap()
        );
        let mut invalid = runtime.clone();
        invalid.driver_class = Some("missing.Driver".into());
        assert_ne!(
            fingerprint,
            installation_runtime_fingerprint(&invalid).await.unwrap()
        );
        assert!(validate_jdbc_driver_class(&invalid).await.is_err());
        let driver = JdbcDriver::connect(&runtime, None, Some(&definition))
            .await
            .unwrap();
        assert_eq!(driver.execute_query("SELECT SETTING_VALUE FROM INFORMATION_SCHEMA.SETTINGS WHERE SETTING_NAME='MODE'", None).await.unwrap().rows[0][0], json!("PostgreSQL"));
        driver
            .execute_query(
                "CREATE TABLE ACCOUNTS(ID INTEGER PRIMARY KEY, CODE VARCHAR(16))",
                None,
            )
            .await
            .unwrap();
        driver
            .execute_query("INSERT INTO ACCOUNTS VALUES (1, 'fixture')", None)
            .await
            .unwrap();
        assert_eq!(driver.get_tables("PUBLIC").await.unwrap().len(), 1);
        assert_eq!(
            driver
                .get_columns("PUBLIC", "ACCOUNTS")
                .await
                .unwrap()
                .len(),
            2
        );
        assert!(!driver
            .get_indexes("PUBLIC", "ACCOUNTS")
            .await
            .unwrap()
            .is_empty());
        assert!(driver
            .get_foreign_keys("PUBLIC", "ACCOUNTS")
            .await
            .unwrap()
            .is_empty());
        assert!(driver.capabilities().supports_streaming);
        assert_eq!(driver.capabilities().driver_fetch_status, "unknown");
        // A real template execution failure must not be swallowed by fallback.
        let mut broken = definition;
        broken.metadata_dialect_sql =
            Some(json!({"tables":"SELECT * FROM MISSING_FIXTURE_TABLE"}).to_string());
        let broken = JdbcDriver::connect(&runtime, None, Some(&broken))
            .await
            .unwrap();
        assert!(broken.get_tables("PUBLIC").await.is_err());
        drivers.push((saved, driver));
    }
    assert_ne!(drivers[0].0.product_id, drivers[1].0.product_id);
    assert_ne!(
        drivers[0].0.driver_installation_id,
        drivers[1].0.driver_installation_id
    );
    for (_, driver) in &drivers {
        assert_eq!(
            driver
                .execute_query("SELECT CODE FROM ACCOUNTS", None)
                .await
                .unwrap()
                .rows[0][0],
            json!("fixture")
        );
    }
}
