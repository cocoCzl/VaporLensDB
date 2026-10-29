use serde::Deserialize;
use tauri::AppHandle;

use crate::app_menu::{set_application_menu, AppMenuLanguage};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetApplicationMenuLanguageInput {
    pub language: String,
}

#[tauri::command]
pub fn set_application_menu_language(
    app: AppHandle,
    input: SetApplicationMenuLanguageInput,
) -> Result<(), String> {
    set_application_menu(&app, AppMenuLanguage::from_code(&input.language))
        .map_err(|error| error.to_string())
}

/// Records numeric startup timings only when local tracing was explicitly enabled.
#[tauri::command]
pub fn startup_trace(
    stage: String,
    epoch_ms: f64,
    metrics: std::collections::BTreeMap<String, f64>,
) {
    crate::utils::startup::record(stage, epoch_ms, metrics);
}

/// Synchronizes the canvas and a disposable startup hint without gating HTML.
#[tauri::command]
pub async fn sync_window_appearance(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::AppState>,
    theme: crate::utils::appearance::Appearance,
    dark: bool,
) -> Result<(), String> {
    window
        .set_theme(theme.native())
        .map_err(|e| e.to_string())?;
    crate::utils::appearance::set_canvas_background(&window, theme.background(dark))
        .map_err(|e| e.to_string())?;
    let dir = state.config_store.config_dir().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || crate::utils::appearance::write_hint(&dir, theme))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}
