use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::connection::DriverType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub connection_name_snapshot: String,
    pub driver_type: DriverType,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub sql: String,
    pub status: QueryHistoryStatus,
    pub started_at: DateTime<Utc>,
    pub elapsed_ms: Option<u64>,
    pub row_count: Option<u64>,
    pub affected_rows: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryHistoryStatus {
    Success,
    Failed,
}
