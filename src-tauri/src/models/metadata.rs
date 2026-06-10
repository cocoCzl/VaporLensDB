use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub database: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub schema: Option<String>,
    pub name: String,
    pub table_type: TableType,
    pub row_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DbObjectKind {
    Table,
    View,
    MaterializedView,
    Index,
    Procedure,
    Function,
    Package,
    Sequence,
    Trigger,
    Synonym,
    Event,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbObjectInfo {
    pub schema: Option<String>,
    pub name: String,
    pub kind: DbObjectKind,
    pub object_type: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TableType {
    Table,
    View,
    MaterializedView,
    SystemTable,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub schema: Option<String>,
    pub table: String,
    pub name: String,
    pub ordinal_position: i32,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub character_maximum_length: Option<i64>,
    pub numeric_precision: Option<i32>,
    pub numeric_scale: Option<i32>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub schema: Option<String>,
    pub table: String,
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub schema: Option<String>,
    pub table: String,
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_schema: Option<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverCapabilities {
    pub has_database: bool,
    pub has_schema: bool,
    pub supports_transactions: bool,
    pub supports_explain: bool,
    pub supports_cancel: bool,
    pub supports_ddl: bool,
    pub supports_streaming: bool,
}
