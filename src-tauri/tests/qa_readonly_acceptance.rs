//! Explicit read-only vendor checks. No fixture writes or default env loading.
use serde_json::json;
use vapor_lens_db_lib::{
    drivers::{
        jdbc::JdbcDriver,
        mysql::MysqlDriver,
        postgres::PostgresDriver,
        trait_def::{DatabaseDriver, DbParameter},
    },
    models::connection::ConnectionConfig,
    services::driver_catalog::driver_definitions,
};

#[tokio::test]
#[ignore = "requires explicit TEST_READONLY_* endpoint and local JAR"]
async fn versions_privileges_and_native_jdbc_values_are_observed_without_writes() {
    let required = |key| std::env::var(key).unwrap_or_else(|_| panic!("missing {key}"));
    let id = required("TEST_READONLY_DRIVER_DEFINITION");
    let definition = driver_definitions()
        .into_iter()
        .find(|d| d.id == id)
        .unwrap();
    let url = required("TEST_READONLY_JDBC_URL");
    let user = required("TEST_READONLY_USER");
    let password = required("TEST_READONLY_PASSWORD");
    let config: ConnectionConfig = serde_json::from_value(json!({
        "id":uuid::Uuid::new_v4(), "name":"Read-only version QA", "driverType":definition.driver_type,
        "productId":definition.product_id, "driverClass":definition.jdbc_driver_class,
        "driverPaths":[required("TEST_READONLY_JDBC_DRIVER_PATH")], "connectionUrl":url,
        "username":user, "createdAt":chrono::Utc::now(), "updatedAt":chrono::Utc::now()
    })).unwrap();
    let jdbc = JdbcDriver::connect(&config, Some(&password), Some(&definition))
        .await
        .unwrap();
    let (identity, sql, permission_sql) = match definition.product_id.as_str() {
        "mysql" => ("SELECT VERSION() AS version, DATABASE() AS current_database, CURRENT_USER() AS qa_user", "SELECT CAST(9007199254740993 AS SIGNED) AS big, CAST(12345678901234567890.123456789 AS DECIMAL(38,9)) AS precise, '中文' AS txt, NULL AS nil, '' AS qa_empty", "SHOW GRANTS FOR CURRENT_USER"),
        "postgres" => ("SELECT version(), current_database(), current_schema, current_user", "SELECT 9007199254740993::bigint AS big, 12345678901234567890.123456789::numeric AS precise, '中文'::text AS txt, NULL::text AS nil, ''::text AS qa_empty", "SELECT has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema, has_database_privilege(current_user,current_database(),'TEMP') AS can_temp"),
        "oracle" => ("SELECT banner FROM v$version WHERE banner LIKE 'Oracle%'", "SELECT CAST(9007199254740993 AS NUMBER(18)) AS big, CAST(12345678901234567890.123456789 AS NUMBER(38,9)) AS precise, '中文' AS txt, NULL AS nil, '' AS qa_empty FROM dual", "SELECT privilege FROM session_privs ORDER BY privilege"),
        _ => panic!("unsupported readonly fixture product"),
    };
    let identity = jdbc.execute_query(identity, None).await.unwrap();
    assert!(identity.row_count > 0);
    println!(
        "QA_SERVER_IDENTITY {}",
        serde_json::to_string(&identity.rows).unwrap()
    );
    let privileges = jdbc.execute_query(permission_sql, None).await.unwrap();
    // Do not print SHOW GRANTS text: some servers may include authentication material.
    println!("QA_PRIVILEGE_ROWS {}", privileges.row_count);
    if definition.product_id == "mysql" {
        let grants = serde_json::to_string(&privileges.rows)
            .unwrap()
            .to_uppercase();
        println!(
            "QA_PRIVILEGE_SUMMARY global_all={} select={} insert={} create={}",
            grants.contains("ALL PRIVILEGES ON *.*"),
            grants.contains("SELECT"),
            grants.contains("INSERT"),
            grants.contains("CREATE")
        );
    }
    if definition.product_id == "oracle" {
        println!("QA_SESSION {}", serde_json::to_string(&jdbc.execute_query("SELECT USER, sys_context('USERENV','CURRENT_SCHEMA'), sys_context('USERENV','SERVICE_NAME') FROM dual", None).await.unwrap().rows).unwrap());
        println!(
            "QA_PRIVILEGES {}",
            serde_json::to_string(&privileges.rows).unwrap()
        );
    } else if definition.product_id == "postgres" {
        println!(
            "QA_PRIVILEGES {}",
            serde_json::to_string(&privileges.rows).unwrap()
        );
    }
    let values = jdbc.execute_query(sql, None).await.unwrap();
    assert_eq!(values.rows[0][0], "9007199254740993");
    assert_eq!(values.rows[0][1], "12345678901234567890.123456789");
    assert_eq!(values.rows[0][2], "中文");
    assert!(values.rows[0][3].is_null());
    if definition.product_id == "oracle" {
        assert!(values.rows[0][4].is_null());
    } else {
        assert_eq!(values.rows[0][4], "");
    }
    let native: Option<Box<dyn DatabaseDriver>> = match definition.product_id.as_str() {
        "mysql" => Some(Box::new(
            MysqlDriver::connect_with_url_credentials(
                url.strip_prefix("jdbc:").unwrap(),
                Some(&user),
                Some(&password),
            )
            .await
            .unwrap(),
        )),
        "postgres" => Some(Box::new(
            PostgresDriver::connect_with_url_credentials(
                url.strip_prefix("jdbc:").unwrap(),
                Some(&user),
                Some(&password),
            )
            .await
            .unwrap(),
        )),
        _ => None,
    };
    if let Some(native) = native {
        let result = native.execute_query(sql, None).await.unwrap();
        assert_eq!(result.rows, values.rows, "Native/JDBC value parity");
        if definition.product_id == "postgres" {
            // Read-only replacement for the legacy test whose latter half writes a TEMP table.
            for (sql, expected) in [
                ("SELECT 1 AS id WHERE false", vec![("id", "int4")]),
                (
                    "SELECT NULL::bigint AS id, NULL::text AS name WHERE false",
                    vec![("id", "int8"), ("name", "text")],
                ),
            ] {
                let result = native.execute_query(sql, None).await.unwrap();
                assert_eq!(result.row_count, 0);
                assert!(result.rows.is_empty());
                assert_eq!(
                    result
                        .columns
                        .iter()
                        .map(|c| (c.name.as_str(), c.data_type.as_str()))
                        .collect::<Vec<_>>(),
                    expected
                );
            }
            let result = native
                .execute_parameterized(
                    "SELECT $1::bigint AS id WHERE false",
                    &[DbParameter::Text("7".into())],
                    None,
                )
                .await
                .unwrap();
            assert!(result.rows.is_empty());
            assert_eq!(result.row_count, 0);
            assert_eq!(result.columns[0].name, "id");
            assert_eq!(result.columns[0].data_type, "int8");
            println!("QA_PG_READONLY_EMPTY_PARAMETER_ASSERTIONS_PASSED");
        }
    }
}
