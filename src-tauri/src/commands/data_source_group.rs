use tauri::State;
use uuid::Uuid;

use crate::{models::data_source_group::DataSourceGroup, AppState};

#[tauri::command]
pub fn list_data_source_groups(state: State<'_, AppState>) -> Result<Vec<DataSourceGroup>, String> {
    state
        .config_store
        .list_data_source_groups()
        .map_err(Into::into)
}

#[tauri::command]
pub fn create_data_source_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<DataSourceGroup, String> {
    state
        .config_store
        .create_data_source_group(name)
        .map_err(Into::into)
}

#[tauri::command]
pub fn rename_data_source_group(
    state: State<'_, AppState>,
    id: Uuid,
    name: String,
) -> Result<DataSourceGroup, String> {
    state
        .config_store
        .rename_data_source_group(id, name)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_data_source_group(state: State<'_, AppState>, id: Uuid) -> Result<(), String> {
    state
        .config_store
        .delete_data_source_group(id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn reorder_data_source_groups(
    state: State<'_, AppState>,
    ids: Vec<Uuid>,
) -> Result<Vec<DataSourceGroup>, String> {
    state
        .config_store
        .reorder_data_source_groups(ids)
        .map_err(Into::into)
}

#[tauri::command]
pub fn set_connection_data_source_group(
    state: State<'_, AppState>,
    connection_id: Uuid,
    group_id: Option<Uuid>,
) -> Result<(), String> {
    state
        .config_store
        .set_connection_group(connection_id, group_id)
        .map_err(Into::into)
}
