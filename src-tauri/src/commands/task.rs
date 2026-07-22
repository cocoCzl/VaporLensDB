use std::{path::PathBuf, process::Command};

use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{models::error::AppError, services::task_manager::TaskInfo, AppState};

const TASK_UPDATED_EVENT: &str = "task_updated";

pub fn emit_task_update(app: &AppHandle, task: &TaskInfo) {
    let _ = app.emit(TASK_UPDATED_EVENT, task);
}

#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskInfo>, String> {
    Ok(state.task_manager.list_tasks().await)
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, AppState>,
    task_id: Uuid,
) -> Result<TaskInfo, String> {
    let task = state
        .task_manager
        .request_cancel(task_id)
        .await
        .map_err(String::from)?;
    Ok(task)
}

#[tauri::command]
pub async fn clear_completed_tasks(state: State<'_, AppState>) -> Result<u64, String> {
    Ok(state.task_manager.clear_completed_tasks().await)
}

#[tauri::command]
pub async fn reveal_task_output(state: State<'_, AppState>, task_id: Uuid) -> Result<(), AppError> {
    let path = PathBuf::from(state.task_manager.output_path(task_id).await?);
    if !path.is_file() {
        return Err(AppError::NotFound {
            resource: "task output file".to_string(),
            id: path.display().to_string(),
        });
    }

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg("-R").arg(&path).spawn();

    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg("/select,").arg(&path).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(&path))
        .spawn();

    result.map(|_| ()).map_err(AppError::from)
}
