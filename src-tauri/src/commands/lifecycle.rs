use tauri::{AppHandle, Manager};

use crate::AppState;

#[tauri::command]
pub async fn shutdown_application(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.idle_reclaim_worker.stop().await;
    state.connection_manager.lock().await.shutdown_all().await;
    state.metadata_index.clear_all().await;
    app.exit(0);
    Ok(())
}
