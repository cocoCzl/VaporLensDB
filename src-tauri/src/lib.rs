pub mod app_menu;
pub mod commands;
pub mod drivers;
pub mod models;
pub mod services;
pub mod utils;

use commands::lifecycle::{ApplicationCloseRequestBridge, ApplicationShutdownCoordinator};
use services::{
    config_store::ConfigStore, connection_manager::ConnectionManager,
    external_driver::configure_bundled_jdbc_bridge_jar, metadata_index::MetadataIndexService,
    metadata_service::MetadataService, query_engine::QueryEngine, task_manager::TaskManager,
};
use std::{
    sync::Mutex as StdMutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub const IDLE_RECLAIM_STATUS_EVENT: &str = "vaporlensdb:idle-reclaim-status";
const IDLE_RECLAIM_INTERVAL: Duration = Duration::from_secs(30);

pub struct IdleReclaimWorker {
    shutdown: CancellationToken,
    task: StdMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl IdleReclaimWorker {
    pub fn new() -> Self {
        Self {
            shutdown: CancellationToken::new(),
            task: StdMutex::new(None),
        }
    }

    pub fn start(&self, app: tauri::AppHandle) {
        self.start_with_tick(IDLE_RECLAIM_INTERVAL, move || {
            let app = app.clone();
            async move {
                for event in app
                    .state::<AppState>()
                    .reclaim_idle_at(Instant::now())
                    .await
                {
                    let _ = app.emit(IDLE_RECLAIM_STATUS_EVENT, event);
                }
            }
        });
    }

    fn start_with_tick<F, Tick>(&self, interval: Duration, mut tick: F)
    where
        F: FnMut() -> Tick + Send + 'static,
        Tick: std::future::Future<Output = ()> + Send,
    {
        let mut task_slot = self.task.lock().unwrap_or_else(|error| error.into_inner());
        if task_slot.is_some() || self.shutdown.is_cancelled() {
            return;
        }
        let shutdown = self.shutdown.clone();
        let task = tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _ = shutdown.cancelled() => break,
                    _ = ticker.tick() => {
                        tick().await;
                    }
                }
            }
        });
        *task_slot = Some(task);
    }

    pub async fn stop(&self) {
        self.shutdown.cancel();
        let task = self
            .task
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }
}

#[cfg(test)]
mod idle_reclaim_worker_tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn worker_starts_once_outside_tokio_and_stop_joins_the_inflight_tick() {
        let worker = Arc::new(IdleReclaimWorker::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        let (sent, mut received) = tokio::sync::mpsc::unbounded_channel();
        let tick_calls = calls.clone();
        let tick_gate = gate.clone();
        worker.start_with_tick(Duration::from_millis(1), move || {
            let sent = sent.clone();
            let tick_calls = tick_calls.clone();
            let tick_gate = tick_gate.clone();
            async move {
                let count = tick_calls.fetch_add(1, Ordering::SeqCst) + 1;
                sent.send(count).unwrap();
                tick_gate.acquire().await.unwrap().forget();
            }
        });
        worker.start_with_tick(Duration::from_millis(1), || async {
            panic!("worker started twice")
        });
        tauri::async_runtime::block_on(async {
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(5), received.recv())
                    .await
                    .unwrap(),
                Some(1)
            );
            gate.add_permits(1);
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(5), received.recv())
                    .await
                    .unwrap(),
                Some(2)
            );
            let stopping_worker = worker.clone();
            let stopping = tokio::spawn(async move { stopping_worker.stop().await });
            worker.shutdown.cancelled().await;
            assert!(!stopping.is_finished());
            gate.add_permits(1);
            tokio::time::timeout(Duration::from_secs(5), stopping)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(calls.load(Ordering::SeqCst), 2);
            assert!(worker.task.lock().unwrap().is_none());
            worker.stop().await;
        });
        worker.start_with_tick(Duration::from_millis(1), || async {
            panic!("shutdown worker restarted")
        });
        assert!(worker.task.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn shutdown_before_start_is_a_no_op_and_prevents_a_timer_spawn() {
        let worker = IdleReclaimWorker::new();
        worker.stop().await;
        worker.start_with_tick(Duration::from_millis(1), || async {
            panic!("worker started after shutdown")
        });
        assert!(worker.task.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn repeated_stop_requests_are_idempotent() {
        let worker = Arc::new(IdleReclaimWorker::new());
        worker.start_with_tick(Duration::from_secs(30), || async {});

        let first = worker.clone();
        let second = worker.clone();
        tokio::time::timeout(Duration::from_secs(5), async move {
            tokio::join!(first.stop(), second.stop());
        })
        .await
        .unwrap();

        assert!(worker.task.lock().unwrap().is_none());
        worker.stop().await;
    }

    #[tokio::test]
    async fn dropping_worker_aborts_inflight_tick_instead_of_detaching_it() {
        struct TickCompletion(Option<tokio::sync::oneshot::Sender<()>>);
        impl Drop for TickCompletion {
            fn drop(&mut self) {
                if let Some(sent) = self.0.take() {
                    let _ = sent.send(());
                }
            }
        }
        let worker = IdleReclaimWorker::new();
        let (started, receive_started) = tokio::sync::oneshot::channel();
        let (completed, receive_completed) = tokio::sync::oneshot::channel();
        let mut started = Some(started);
        let mut completed = Some(completed);
        worker.start_with_tick(Duration::from_secs(30), move || {
            let started = started.take();
            let completion = TickCompletion(completed.take());
            async move {
                let _completion = completion;
                if let Some(started) = started {
                    started.send(()).unwrap();
                }
                std::future::pending::<()>().await;
            }
        });
        tokio::time::timeout(Duration::from_secs(5), receive_started)
            .await
            .unwrap()
            .unwrap();
        drop(worker);
        tokio::time::timeout(Duration::from_secs(5), receive_completed)
            .await
            .unwrap()
            .unwrap();
    }
}

impl Drop for IdleReclaimWorker {
    fn drop(&mut self) {
        self.shutdown.cancel();
        if let Some(task) = self
            .task
            .get_mut()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            task.abort();
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct IdleReclaimStatusEvent {
    pub status: crate::models::connection::ConnectionStatus,
    pub revision: u64,
}

impl Default for IdleReclaimWorker {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AppState {
    pub config_store: ConfigStore,
    pub connection_manager: Mutex<ConnectionManager>,
    pub metadata_service: MetadataService,
    pub metadata_index: MetadataIndexService,
    pub query_engine: QueryEngine,
    pub task_manager: TaskManager,
    pub idle_reclaim_worker: IdleReclaimWorker,
    pub idle_reclaim_gate: Mutex<()>,
    pub shutdown_coordinator: ApplicationShutdownCoordinator,
}

impl AppState {
    pub(crate) async fn reclaim_idle_at(&self, now: Instant) -> Vec<IdleReclaimStatusEvent> {
        let _cleanup = self.idle_reclaim_gate.lock().await;
        let reclaimed = self
            .connection_manager
            .lock()
            .await
            .reclaim_idle_sessions_at(now);
        let mut events = Vec::with_capacity(reclaimed.len());
        for (status, revision, runtime) in reclaimed {
            drop(runtime);
            self.metadata_service
                .clear_connection(status.connection_id)
                .await;
            self.metadata_index
                .clear_connection(status.connection_id)
                .await;
            events.push(IdleReclaimStatusEvent { status, revision });
        }
        events
    }
}

pub const APPLICATION_CLOSE_REQUEST_EVENT: &str = "vaporlensdb:request-application-close";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let config_store = ConfigStore::new_default().expect("initialize config store");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            app_menu::set_application_menu(app.handle(), app_menu::AppMenuLanguage::Zh)?;
            configure_bundled_jdbc_bridge_jar(
                app.path()
                    .resource_dir()?
                    .join("jdbc")
                    .join("jdbc-bridge.jar"),
            );
            app.state::<AppState>()
                .idle_reclaim_worker
                .start(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            app_menu::handle_menu_event(app, &event);
        })
        .manage(commands::sql_file::SqlFileGrants::default())
        .manage(ApplicationCloseRequestBridge::default())
        .manage(AppState {
            config_store,
            connection_manager: Mutex::new(ConnectionManager::new()),
            metadata_service: MetadataService::new(),
            metadata_index: MetadataIndexService::new(),
            query_engine: QueryEngine::new(),
            task_manager: TaskManager::new(),
            idle_reclaim_worker: IdleReclaimWorker::new(),
            idle_reclaim_gate: Mutex::new(()),
            shutdown_coordinator: ApplicationShutdownCoordinator::new(),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = commands::lifecycle::request_application_close(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::contract::list_command_contracts,
            commands::sql_file::sql_file,
            commands::health::health_check,
            commands::lifecycle::shutdown_application,
            commands::lifecycle::application_close_listener_ready,
            commands::lifecycle::application_close_request_finished,
            commands::config::export_diagnostics_package,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::rename_connection,
            commands::connection::delete_connection,
            commands::connection::list_connections,
            commands::connection::test_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::connection_status,
            commands::connection::connection_capabilities,
            commands::connection::list_connection_statuses,
            commands::connection::set_connection_session_policy,
            commands::data_source_group::list_data_source_groups,
            commands::data_source_group::create_data_source_group,
            commands::data_source_group::rename_data_source_group,
            commands::data_source_group::delete_data_source_group,
            commands::data_source_group::reorder_data_source_groups,
            commands::data_source_group::set_connection_data_source_group,
            commands::driver::list_driver_definitions,
            commands::driver::save_custom_driver_definition,
            commands::driver::delete_custom_driver_definition,
            commands::driver::import_jdbc_driver_artifacts,
            commands::driver::remove_jdbc_driver_artifact,
            commands::driver::validate_external_driver,
            commands::export::export_query_result_csv,
            commands::export::export_query_csv,
            commands::export::export_table_csv,
            commands::export::preview_table_csv_import,
            commands::export::import_table_csv,
            commands::metadata::get_databases,
            commands::metadata::get_schemas,
            commands::metadata::get_tables,
            commands::metadata::get_columns,
            commands::metadata::get_indexes,
            commands::metadata::get_foreign_keys,
            commands::metadata::get_views,
            commands::metadata::get_functions,
            commands::metadata::get_table_ddl,
            commands::metadata::get_schema_objects,
            commands::metadata::get_object_ddl,
            commands::metadata::start_metadata_index_task,
            commands::metadata::search_metadata_index,
            commands::metadata::clear_metadata_index,
            commands::query::execute_query,
            commands::query::execute_query_stream,
            commands::query::explain_query,
            commands::query::cancel_query,
            commands::query::analyze_sql_risk,
            commands::query::console_transaction_state,
            commands::query::set_console_transaction_mode,
            commands::query::commit_console_transaction,
            commands::query::rollback_console_transaction,
            commands::query_history::add_query_history,
            commands::query_history::list_query_history,
            commands::query_history::clear_query_history,
            commands::sql_draft::upsert_sql_draft,
            commands::sql_draft::list_sql_drafts,
            commands::sql_draft::mark_sql_draft_closed,
            commands::sql_draft::delete_sql_draft,
            commands::sql_draft::clear_sql_drafts,
            commands::settings::set_application_menu_language,
            commands::task::list_tasks,
            commands::task::cancel_task,
            commands::task::clear_completed_tasks,
            commands::task::reveal_task_output
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}
