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

/// Read-only lifecycle evidence, disabled unless the local numeric trace is on.
pub fn window_snapshot(window: &tauri::Window, stage: &'static str, metrics: std::collections::BTreeMap<String, f64>) {
    if !enabled() { return; }
    let window = window.clone();
    let dispatcher = window.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        let mut metrics = metrics;
        metrics.insert("visible".into(), window.is_visible().unwrap_or(false) as u8 as f64);
        metrics.insert("minimized".into(), window.is_minimized().unwrap_or(false) as u8 as f64);
        metrics.insert("focused".into(), window.is_focused().unwrap_or(false) as u8 as f64);
        #[cfg(target_os = "macos")]
        if let Ok(native) = window.ns_window() {
            // Public, read-only AppKit getters on the UI thread. No visibility,
            // activation, redraw or WebKit state is changed by this probe.
            unsafe {
                use std::ffi::{c_char, c_void};
                #[link(name = "objc")]
                extern "C" {
                    fn sel_registerName(name: *const c_char) -> *const c_void;
                    fn objc_getClass(name: *const c_char) -> *mut c_void;
                    fn objc_msgSend();
                }
                let integer: unsafe extern "C" fn(*mut c_void, *const c_void) -> usize = std::mem::transmute(objc_msgSend as *const ());
                let boolean: unsafe extern "C" fn(*mut c_void, *const c_void) -> i8 = std::mem::transmute(objc_msgSend as *const ());
                let selector = |name: &std::ffi::CStr| sel_registerName(name.as_ptr());
                let app_class = objc_getClass(c"NSApplication".as_ptr());
                let app = integer(app_class, selector(c"sharedApplication")) as *mut c_void;
                metrics.insert("app_active".into(), (boolean(app, selector(c"isActive")) != 0) as u8 as f64);
                metrics.insert("app_hidden".into(), (boolean(app, selector(c"isHidden")) != 0) as u8 as f64);
                metrics.insert("occlusion_visible".into(), ((integer(native, selector(c"occlusionState")) & (1 << 1)) != 0) as u8 as f64);
                metrics.insert("key_window".into(), (boolean(native, selector(c"isKeyWindow")) != 0) as u8 as f64);
            }
        }
        write(stage, None, serde_json::json!(metrics));
    });
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
