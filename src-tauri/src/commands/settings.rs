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
