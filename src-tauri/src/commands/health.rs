use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResponse {
    pub status: &'static str,
    pub app: &'static str,
    pub version: &'static str,
}

#[tauri::command]
pub fn health_check() -> HealthCheckResponse {
    HealthCheckResponse {
        status: "ok",
        app: "VaporLensDB",
        version: env!("CARGO_PKG_VERSION"),
    }
}
