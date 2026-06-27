pub mod app_menu;
pub mod commands;
pub mod drivers;
pub mod models;
pub mod services;
pub mod utils;

use services::{
    config_store::ConfigStore, connection_manager::ConnectionManager,
    metadata_index::MetadataIndexService, metadata_service::MetadataService,
    query_engine::QueryEngine, task_manager::TaskManager,
};
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub config_store: ConfigStore,
    pub connection_manager: Mutex<ConnectionManager>,
    pub metadata_service: MetadataService,
    pub metadata_index: MetadataIndexService,
    pub query_engine: QueryEngine,
    pub task_manager: TaskManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let config_store = ConfigStore::new_default().expect("initialize config store");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app_menu::set_application_menu(app.handle(), app_menu::AppMenuLanguage::Zh)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            app_menu::handle_menu_event(app, &event);
        })
        .manage(AppState {
            config_store,
            connection_manager: Mutex::new(ConnectionManager::new()),
            metadata_service: MetadataService::new(),
            metadata_index: MetadataIndexService::new(),
            query_engine: QueryEngine::new(),
            task_manager: TaskManager::new(),
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let state = window.state::<AppState>();
                tauri::async_runtime::block_on(async {
                    state.connection_manager.lock().await.shutdown_all().await;
                    state.metadata_index.clear_all().await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::contract::list_command_contracts,
            commands::health::health_check,
            commands::config::export_diagnostics_package,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::list_connections,
            commands::connection::test_connection,
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::connection_status,
            commands::connection::list_connection_statuses,
            commands::driver::list_driver_definitions,
            commands::driver::save_custom_driver_definition,
            commands::driver::delete_custom_driver_definition,
            commands::driver::import_jdbc_driver_artifacts,
            commands::driver::remove_jdbc_driver_artifact,
            commands::driver::validate_external_driver,
            commands::export::export_query_result_csv,
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
            commands::query_history::add_query_history,
            commands::query_history::list_query_history,
            commands::query_history::clear_query_history,
            commands::settings::set_application_menu_language,
            commands::task::list_tasks,
            commands::task::cancel_task,
            commands::task::start_noop_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
