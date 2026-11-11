use super::*;
use crate::commands::query::convergence_tests::{
    run_owned_table, unset_mysql_config, DriverTableActions, LiveKind, LiveSettings, ObjectLedger,
};
use crate::services::{
    connection_manager::{create_active_connection, ConnectionManager},
    task_manager::TaskManager,
};

async fn task() -> (TaskManager, TaskHandle) {
    let manager = TaskManager::new();
    let info = manager.create_task("qa.csv", "CSV regression", None).await;
    manager.start_task(info.id, "starting").await.unwrap();
    let handle = manager.handle(info.id).await.unwrap();
    (manager, handle)
}

#[tokio::test]
#[ignore = "Unix opt-in; explicit authorized MySQL endpoint and JAR; full query export/context only"]
async fn mysql_full_query_export_preserves_unset_and_selected_context() {
    let settings = LiveSettings::load(LiveKind::MysqlContext);
    assert_eq!(settings.product, "mysql");
    let selected_database = settings.database.clone();
    for native in [true, false] {
        let (config, definition, password) = settings.config(native);
        let id = config.id;
        let mut connections = ConnectionManager::new();
        connections.begin_connect(id).unwrap();
        connections
            .finish_connect(
                id,
                Ok(
                    create_active_connection(&config, Some(&password), definition.as_ref())
                        .await
                        .unwrap(),
                ),
            )
            .unwrap();
        let generation = connections.connection_generation(id).unwrap();
        // Derive the server-level URL from the explicitly supplied endpoint.
        let empty_config = unset_mysql_config(config.clone());
        connections
            .install_mysql_empty_session(
                id,
                generation,
                create_active_connection(&empty_config, Some(&password), definition.as_ref())
                    .await
                    .unwrap(),
            )
            .unwrap();
        for (index, empty) in [true, false, true, false].into_iter().enumerate() {
            let op = connections
                .begin_context_query_operation(id, &format!("full-{index}"), empty)
                .unwrap()
                .wait()
                .await
                .unwrap();
            let database = if empty {
                None
            } else {
                Some(selected_database.clone())
            };
            crate::commands::query::apply_execution_context(
                op.driver.clone(),
                DriverType::Mysql,
                database.as_deref(),
                None,
            )
            .await
            .unwrap();
            let path = settings
                .evidence
                .clone()
                .join(format!("context-full-{native}-{index}.csv"));
            let (manager, handle) = task().await;
            let report = write_streamed_query_csv(
                &ExportQueryCsvInput {
                    connection_id: id,
                    connection_generation: generation,
                    sql: "SELECT DATABASE() AS qa_db, 1 AS qa_one".into(),
                    database,
                    schema: None,
                    console_id: None,
                    path: path.display().to_string(),
                    include_header: true,
                },
                Arc::new(QueryExportOperation::Auto(op)),
                &path,
                &manager,
                &handle,
            )
            .await
            .unwrap();
            assert_eq!(report.row_count, 1);
            assert_eq!(
                tokio::fs::read_to_string(path).await.unwrap(),
                if empty {
                    "qa_db,qa_one\r\n,1".to_string()
                } else {
                    format!("qa_db,qa_one\r\n{selected_database},1")
                }
            );
        }
        connections.disconnect(id).unwrap();
        println!("QA_FULL_EXPORT_CONTEXT_PASSED native={native}");
    }
}

#[tokio::test]
#[ignore = "Unix opt-in; explicit authorized MySQL/PG targets only; parameterized native CSV owned table"]
async fn authorized_native_csv_success_failure_cancel_and_observation() {
    let settings = LiveSettings::load(LiveKind::Csv);
    let product = settings.product.clone();
    let dialect = match product.as_str() {
        "mysql" => DriverType::Mysql,
        "postgres" => DriverType::Postgres,
        _ => panic!("CSV regression supports only MySQL and PostgreSQL"),
    };
    let schema = settings.schema.clone();
    let table_name = settings.owned_table_name("csv");
    let table = qualified_table(dialect, &schema, &table_name);
    let mut ledger = ObjectLedger::open(&settings.evidence, &product, &settings.database, &table)
        .expect("prepare ownership ledger before connecting");
    let (config, _, password) = settings.config(true);
    let id = config.id;
    let mut connections = ConnectionManager::new();
    connections.begin_connect(id).unwrap();
    connections
        .finish_connect(
            id,
            Ok(create_active_connection(&config, Some(&password), None)
                .await
                .unwrap()),
        )
        .unwrap();
    let driver = connections.driver(id).unwrap();
    settings.verify_write_target(driver.clone()).await;
    let actions = DriverTableActions {
        driver: driver.clone(),
        product: product.clone(),
        schema: schema.clone(),
        name: table_name.clone(),
    };
    let mut observer_after = None;
    let run = run_owned_table(&actions, &mut ledger, || async {
        let observer_active = create_active_connection(&config, Some(&password), None)
            .await
            .unwrap();
        let mut observers = ConnectionManager::new();
        observers.begin_connect(id).unwrap();
        observers.finish_connect(id, Ok(observer_active)).unwrap();
        let observer = observers.driver(id).unwrap();
        observer_after = Some(observer.clone());
        let path = settings
            .evidence
            .clone()
            .join(format!("native-csv-{product}.csv"));
        let input = ImportTableCsvInput {
            connection_id: id,
            driver_type: dialect,
            schema: schema.clone(),
            table: table_name.clone(),
            path: path.display().to_string(),
            has_header: true,
            delimiter: Some(";".into()),
            mapping: Some(vec![Some("note".into()), Some("id".into())]),
            empty_as_null: true,
        };
        let columns = driver.get_columns(&schema, &table_name).await.unwrap();
        tokio::fs::write(
            &path,
            "Text;Key\n中文;1\nO'Reilly;2\n\"semi;colon\";3\n;4\n",
        )
        .await
        .unwrap();
        let (manager, handle) = task().await;
        let op = connections
            .begin_query_operation(id, "csv-success")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let report = import_csv_rows(&input, op, columns.clone(), &manager, &handle)
            .await
            .unwrap();
        assert_eq!(report.inserted_rows, 4);
        let actual = observer
            .execute_query(&format!("SELECT id,note FROM {table} ORDER BY id"), None)
            .await
            .unwrap();
        assert_eq!(
            actual
                .rows
                .iter()
                .map(|row| row[1].clone())
                .collect::<Vec<_>>(),
            vec![
                serde_json::json!("中文"),
                serde_json::json!("O'Reilly"),
                serde_json::json!("semi;colon"),
                serde_json::Value::Null
            ]
        );
        println!("QA_CSV_SUCCESS mapping=note,id delimiter=semicolon observer_exact_rows=4");

        tokio::fs::write(&path, "Text;Key\nok;5\nduplicate;1\nnext;6\n")
            .await
            .unwrap();
        let (manager, handle) = task().await;
        let op = connections
            .begin_query_operation(id, "csv-row-error")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let report = import_csv_rows(&input, op, columns.clone(), &manager, &handle)
            .await
            .unwrap();
        assert_eq!(report.inserted_rows, 2);
        assert_eq!(report.failed_write_count, 1);
        println!("QA_CSV_ROW_ERROR reported_inserted=2 failed=1 policy=commit_valid_rows");

        tokio::fs::write(&path, "Text;Key\n\"unterminated;7\n")
            .await
            .unwrap();
        let (manager, handle) = task().await;
        let op = connections
            .begin_query_operation(id, "csv-fatal-error")
            .unwrap()
            .wait()
            .await
            .unwrap();
        assert!(
            import_csv_rows(&input, op, columns.clone(), &manager, &handle)
                .await
                .is_err()
        );
        let baseline = observer
            .execute_query(&format!("SELECT COUNT(*) FROM {table}"), None)
            .await
            .unwrap();
        assert_eq!(baseline.rows[0][0].to_string().trim_matches('"'), "6");

        let csv = format!(
            "Text;Key\n{}",
            (1000..2000)
                .map(|id| format!("cancel-{id};{id}\n"))
                .collect::<String>()
        );
        tokio::fs::write(&path, csv).await.unwrap();
        let (manager, handle) = task().await;
        let op = connections
            .begin_query_operation(id, "csv-cancel")
            .unwrap()
            .wait()
            .await
            .unwrap();
        let cancelled_after = async {
            loop {
                let tasks = manager.list_tasks().await;
                let info = tasks.iter().find(|task| task.id == handle.id).unwrap();
                if info.progress.current >= 100
                    && info
                        .progress
                        .message
                        .as_deref()
                        .is_some_and(|message| message.starts_with("Imported "))
                {
                    let progress = info.progress.current;
                    manager.request_cancel(handle.id).await.unwrap();
                    return progress;
                }
                tokio::task::yield_now().await;
            }
        };
        let (result, progress) = tokio::time::timeout(Duration::from_secs(10), async {
            tokio::join!(
                import_csv_rows(&input, op, columns.clone(), &manager, &handle),
                cancelled_after
            )
        })
        .await
        .unwrap();
        assert!(matches!(result, Err(ExportTaskError::Cancelled)));
        let after = observer
            .execute_query(&format!("SELECT COUNT(*) FROM {table}"), None)
            .await
            .unwrap();
        assert_eq!(after.rows, baseline.rows);
        println!("QA_CSV_CANCEL progress={progress} observer_final_rows=6 no_partial_import");
    })
    .await;
    assert!(run.is_ok(), "CSV fixture failed: {run:?}");
    let observer = observer_after.expect("successful fixture must initialize its observer");
    assert!(observer
        .execute_query(&format!("SELECT * FROM {table}"), None)
        .await
        .is_err());
}

#[tokio::test]
async fn csv_observer_manager_and_assertion_failures_keep_owned_cleanup_and_ledger() {
    for phase in [
        "observer connection initialization",
        "manager initialization",
        "CSV data assertion",
    ] {
        crate::commands::query::convergence_tests::assert_setup_failure_cleans_exact_owned_table(
            phase,
        )
        .await;
    }
}
