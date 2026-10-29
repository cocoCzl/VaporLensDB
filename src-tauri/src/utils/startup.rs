//! Opt-in, local startup timings. No SQL, paths, credentials or product names.
use std::{
    fs::OpenOptions,
    io::Write,
    sync::{Mutex, OnceLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

struct Trace {
    start: Instant,
    epoch_ms: f64,
    file: Mutex<Option<std::fs::File>>,
}
static TRACE: OnceLock<Trace> = OnceLock::new();

pub fn start() {
    let file = std::env::var_os("VAPORLENSDB_STARTUP_TRACE")
        .and_then(|path| OpenOptions::new().create(true).append(true).open(path).ok());
    let _ = TRACE.set(Trace {
        start: Instant::now(),
        epoch_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.0,
        file: Mutex::new(file),
    });
    mark("process_start");
}
pub fn enabled() -> bool {
    TRACE
        .get()
        .is_some_and(|trace| trace.file.lock().is_ok_and(|file| file.is_some()))
}
pub fn mark(stage: &str) {
    write(stage, None, serde_json::json!({}));
}
fn write(stage: &str, epoch_ms: Option<f64>, metrics: serde_json::Value) {
    if let Some(trace) = TRACE.get() {
        if let Ok(mut file) = trace.file.lock() {
            if let Some(file) = file.as_mut() {
                let elapsed = trace.start.elapsed().as_secs_f64() * 1000.0;
                let line = serde_json::json!({"pid":std::process::id(),"stage":stage,"elapsedMs":epoch_ms.map(|t|t-trace.epoch_ms).unwrap_or(elapsed),"receivedMs":elapsed,"metrics":metrics});
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

pub fn record(stage: String, epoch_ms: f64, metrics: std::collections::BTreeMap<String, f64>) {
    if !enabled()
        || !epoch_ms.is_finite()
        || stage.len() > 64
        || !stage
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return;
    }
    let metrics = metrics
        .into_iter()
        .filter(|(key, value)| {
            key.len() <= 48
                && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                && value.is_finite()
        })
        .take(32)
        .collect::<std::collections::BTreeMap<_, _>>();
    write(&stage, Some(epoch_ms), serde_json::json!(metrics));
}

pub fn initialization_script() -> &'static str {
    if enabled() {
        include_str!("startup.js")
    } else {
        ""
    }
}
