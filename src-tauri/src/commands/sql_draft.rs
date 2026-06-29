use chrono::Utc;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::{models::sql_draft::SqlDraft, AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSqlDraftInput {
    pub id: Option<Uuid>,
    pub connection_id: Option<Uuid>,
    pub connection_name_snapshot: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub title: String,
    pub sql: String,
    pub closed: Option<bool>,
}

#[tauri::command]
pub fn upsert_sql_draft(
    state: State<'_, AppState>,
    input: UpsertSqlDraftInput,
) -> Result<SqlDraft, String> {
    let now = Utc::now();
    let existing = input
        .id
        .map(|id| state.config_store.get_sql_draft(id))
        .transpose()
        .map_err(String::from)?
        .flatten();

    let connection = input
        .connection_id
        .map(|id| state.config_store.get_connection(id))
        .transpose()
        .map_err(String::from)?
        .flatten();

    let draft = SqlDraft {
        id: input.id.unwrap_or_else(Uuid::new_v4),
        connection_id: input.connection_id,
        connection_name_snapshot: connection
            .as_ref()
            .map(|connection| connection.name.clone())
            .or(input.connection_name_snapshot)
            .or_else(|| {
                existing
                    .as_ref()
                    .and_then(|draft| draft.connection_name_snapshot.clone())
            }),
        database: input.database.or_else(|| {
            connection
                .as_ref()
                .and_then(|connection| connection.database.clone())
        }),
        schema: input.schema,
        title: input.title.trim().to_string(),
        sql: input.sql,
        created_at: existing
            .as_ref()
            .map(|draft| draft.created_at)
            .unwrap_or(now),
        updated_at: now,
        last_opened_at: Some(now),
        closed_at: if input.closed.unwrap_or(false) {
            Some(now)
        } else {
            None
        },
    };

    state
        .config_store
        .upsert_sql_draft(draft)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_sql_drafts(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<SqlDraft>, String> {
    state
        .config_store
        .list_sql_drafts(limit.unwrap_or(50))
        .map_err(Into::into)
}

#[tauri::command]
pub fn mark_sql_draft_closed(state: State<'_, AppState>, id: Uuid) -> Result<(), String> {
    state
        .config_store
        .mark_sql_draft_closed(id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_sql_draft(state: State<'_, AppState>, id: Uuid) -> Result<(), String> {
    state.config_store.delete_sql_draft(id).map_err(Into::into)
}

#[tauri::command]
pub fn clear_sql_drafts(state: State<'_, AppState>) -> Result<(), String> {
    state.config_store.clear_sql_drafts().map_err(Into::into)
}
