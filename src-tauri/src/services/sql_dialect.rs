use crate::models::connection::DriverType;
use std::sync::LazyLock;
static DESCRIPTORS: LazyLock<serde_json::Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../src/shared/database-dialects.json"))
        .expect("shared dialect contract")
});
pub fn resolve_sql_dialect(value: &str) -> Option<DriverType> {
    let normalized = value.to_ascii_lowercase();
    DESCRIPTORS
        .as_object()?
        .iter()
        .find(|(_, d)| {
            d["aliases"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(&normalized)))
        })
        .and_then(|(id, _)| id.parse().ok())
}
