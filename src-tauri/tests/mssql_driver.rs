use vapor_lens_db_lib::{
    drivers::{mssql::MssqlDriver, trait_def::DatabaseDriver},
    models::error::AppError,
};

#[tokio::test]
#[ignore = "requires TEST_MSSQL_URL (native ADO or SQL Server JDBC connection string)"]
async fn empty_and_nonempty_selects_keep_column_metadata_and_query_error_mapping() {
    let driver =
        MssqlDriver::connect(&std::env::var("TEST_MSSQL_URL").expect("SQL Server test URL"))
            .await
            .unwrap();
    for predicate in ["1 = 0", "1 = 1"] {
        let result = driver.execute_query(&format!("SELECT CAST(7 AS bigint) AS id_alias, CAST(N'fixture' AS nvarchar(20)) AS name_alias WHERE {predicate}"), Some("metadata-regression")).await.unwrap();
        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.columns[0].name, "id_alias");
        assert_eq!(result.columns[1].name, "name_alias");
        assert!(result
            .columns
            .iter()
            .all(|column| !column.data_type.is_empty()));
        assert_eq!(result.row_count, u64::from(predicate == "1 = 1"));
        if predicate == "1 = 0" {
            assert!(result.rows.is_empty());
        } else {
            assert_eq!(
                result.rows[0],
                vec![serde_json::json!(7), serde_json::json!("fixture")]
            );
        }
    }
    let result = driver
        .execute_query("DECLARE @fixture INT = 7", None)
        .await
        .unwrap();
    assert!(result.columns.is_empty());
    assert!(result.rows.is_empty());
    assert!(matches!(
        driver
            .execute_query("SELECT phase3_missing_column", None)
            .await
            .unwrap_err(),
        AppError::QueryFailed { .. }
    ));
}
