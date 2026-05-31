pub mod commands;
pub mod drivers;
pub mod models;
pub mod services;
pub mod utils;

use services::{
    config_store::ConfigStore, connection_manager::ConnectionManager,
    metadata_service::MetadataService, query_engine::QueryEngine,
};
use tokio::sync::Mutex;

pub struct AppState {
    pub config_store: ConfigStore,
    pub connection_manager: Mutex<ConnectionManager>,
    pub metadata_service: MetadataService,
    pub query_engine: QueryEngine,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let config_store = ConfigStore::new_default().expect("initialize config store");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config_store,
            connection_manager: Mutex::new(ConnectionManager::new()),
            metadata_service: MetadataService::new(),
            query_engine: QueryEngine::new(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::health_check,
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
            commands::driver::validate_external_driver,
            commands::metadata::get_databases,
            commands::metadata::get_schemas,
            commands::metadata::get_tables,
            commands::metadata::get_columns,
            commands::metadata::get_indexes,
            commands::metadata::get_foreign_keys,
            commands::metadata::get_views,
            commands::metadata::get_functions,
            commands::query::execute_query,
            commands::query::execute_query_stream,
            commands::query::explain_query,
            commands::query::cancel_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
