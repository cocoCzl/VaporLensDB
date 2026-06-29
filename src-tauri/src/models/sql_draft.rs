use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlDraft {
    pub id: Uuid,
    pub connection_id: Option<Uuid>,
    pub connection_name_snapshot: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub title: String,
    pub sql: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_opened_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
}
