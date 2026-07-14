use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub elapsed_ms: u64,
    pub affected_rows: u64,
    pub query_id: Option<String>,
    pub truncated: bool,
    pub max_rows: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultChunk {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStreamSummary {
    pub query_id: String,
    pub row_count: u64,
    pub affected_rows: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
    pub max_rows: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStreamDone {
    pub query_id: String,
    pub row_count: u64,
    pub affected_rows: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
    pub max_rows: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStreamError {
    pub query_id: String,
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl QueryResult {
    pub fn empty(elapsed_ms: u64, affected_rows: u64) -> Self {
        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            row_count: 0,
            elapsed_ms,
            affected_rows,
            query_id: None,
            truncated: false,
            max_rows: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainResult {
    pub format: ExplainFormat,
    pub plan: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<QueryResult>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExplainFormat {
    Text,
    Json,
    Table,
}

#[cfg(test)]
mod tests {
    use super::{ColumnMeta, QueryResult};

    #[test]
    fn query_result_round_trips_json() {
        let result = QueryResult {
            columns: vec![ColumnMeta {
                name: "id".to_string(),
                data_type: "int4".to_string(),
                nullable: false,
            }],
            rows: vec![vec![serde_json::json!(1)]],
            row_count: 1,
            elapsed_ms: 3,
            affected_rows: 0,
            query_id: Some("q1".to_string()),
            truncated: false,
            max_rows: None,
        };

        let json = serde_json::to_string(&result).expect("serialize query result");
        let decoded: QueryResult = serde_json::from_str(&json).expect("deserialize query result");

        assert_eq!(decoded.columns[0].name, "id");
        assert_eq!(decoded.rows[0][0], serde_json::json!(1));
        assert_eq!(decoded.query_id.as_deref(), Some("q1"));
    }
}
