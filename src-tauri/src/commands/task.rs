use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use tokio::time::{sleep, Duration};

use crate::{services::task_manager::TaskInfo, AppState};

const TASK_UPDATED_EVENT: &str = "task_updated";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNoopTaskInput {
    pub title: Option<String>,
    pub steps: Option<u64>,
    pub step_delay_ms: Option<u64>,
}

#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskInfo>, String> {
    Ok(state.task_manager.list_tasks().await)
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, AppState>,
    task_id: uuid::Uuid,
) -> Result<TaskInfo, String> {
    let task = state
        .task_manager
        .request_cancel(task_id)
        .await
        .map_err(String::from)?;
    Ok(task)
}

#[tauri::command]
pub async fn start_noop_task(
    app: AppHandle,
    state: State<'_, AppState>,
    input: Option<StartNoopTaskInput>,
) -> Result<TaskInfo, String> {
    let input = input.unwrap_or(StartNoopTaskInput {
        title: None,
        steps: None,
        step_delay_ms: None,
    });
    let steps = input.steps.unwrap_or(5).clamp(1, 100);
    let delay_ms = input.step_delay_ms.unwrap_or(150).clamp(10, 5_000);
    let manager = state.task_manager.clone();
    let task = manager
        .create_task(
            "noop",
            input.title.as_deref().unwrap_or("No-op task"),
            Some(steps),
        )
        .await;
    let handle = manager.handle(task.id).await.map_err(String::from)?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        if let Ok(task) = manager.start_task(handle.id, "Starting").await {
            emit_task_update(&app_for_task, &task);
        }

        for step in 1..=steps {
            if handle.is_cancel_requested() {
                if let Ok(task) = manager.finish_cancelled(handle.id, "Cancelled").await {
                    emit_task_update(&app_for_task, &task);
                }
                return;
            }

            sleep(Duration::from_millis(delay_ms)).await;
            if let Ok(task) = manager
                .update_progress(handle.id, step, format!("Step {step} of {steps}"))
                .await
            {
                emit_task_update(&app_for_task, &task);
            }
        }

        if let Ok(task) = manager.finish_success(handle.id, "Completed").await {
            emit_task_update(&app_for_task, &task);
        }
    });

    emit_task_update(&app, &task);
    Ok(task)
}

fn emit_task_update(app: &AppHandle, task: &TaskInfo) {
    let _ = app.emit(TASK_UPDATED_EVENT, task);
}
