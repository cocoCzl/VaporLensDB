//! Opt-in local lifecycle evidence. No SQL, input values or credentials.
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

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorDetails {
    kind: String,
    name: String,
    element: String,
    #[serde(rename = "locationClass")]
    location_class: String,
    message: String,
    location: String,
    line: u32,
    column: u32,
    stack: Vec<String>,
}

impl ErrorDetails {
    fn sanitized(mut self) -> Self {
        if !["resource", "javascript", "promise"].contains(&self.kind.as_str()) {
            self.kind = "unknown".into();
        }
        if ![
            "none", "img", "image", "svg", "use", "link", "script", "style", "iframe", "video",
            "audio", "source",
        ]
        .contains(&self.element.as_str())
        {
            self.element = "other".into();
        }
        if !["app", "data", "blob", "external"].contains(&self.location_class.as_str()) {
            self.location_class = "unknown".into();
        }
        if ![
            "Error",
            "TypeError",
            "SyntaxError",
            "RangeError",
            "ReferenceError",
            "DOMException",
            "AbortError",
            "SecurityError",
            "NotAllowedError",
            "InvalidStateError",
            "NetworkError",
            "UnknownError",
        ]
        .contains(&self.name.as_str())
        {
            self.name = "[redacted type]".into();
        }
        if ![
            "ResizeObserver loop [details redacted]",
            "Dynamic module import failed [details redacted]",
            "Operation not permitted [details redacted]",
            "Value is not a function [expression redacted]",
            "Cannot access null or undefined [expression redacted]",
            "Reference is not defined [expression redacted]",
            "Network or resource load failed [details redacted]",
            "Script error [details unavailable]",
            "Resource failed to load [details redacted]",
            "[non-string message redacted]",
        ]
        .contains(&self.message.as_str())
        {
            self.message = "[unknown message redacted]".into();
        }
        fn source(value: &str, frame: bool) -> bool {
            static SOURCE: OnceLock<regex::Regex> = OnceLock::new();
            static FRAME: OnceLock<regex::Regex> = OnceLock::new();
            let suffix = if frame { r":\d{1,10}:\d{1,10}$" } else { "$" };
            let pattern = if frame { &FRAME } else { &SOURCE };
            pattern.get_or_init(|| regex::Regex::new(&format!(r"^app:/(?:index\.html|boot-status\.js|favicon\.png|probe\.(?:html|js)|assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{{8,12}}\.(?:js|css|svg|png|woff2|ttf))?{suffix}")).unwrap()).is_match(value)
        }
        if self.location.len() > 240 || !source(&self.location, false) {
            self.location = "[redacted location]".into();
        }
        self.stack = self
            .stack
            .into_iter()
            .take(16)
            .map(|frame| {
                if frame.len() <= 260 && source(&frame, true) {
                    frame
                } else {
                    "[redacted frame]".into()
                }
            })
            .collect();
        self
    }
}

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

/// Opt-in runtime evidence records the store that actually opened, rather
/// than assuming a launcher environment reached the process.
pub fn runtime_identity(config_dir: &std::path::Path, identifier: &str) {
    if enabled() {
        write(
            "runtime_identity",
            None,
            serde_json::json!({
                "configDir": config_dir.canonicalize().unwrap_or_else(|_| config_dir.to_path_buf()),
                "executable": std::env::current_exe().ok(),
                "identifier": identifier,
                "version": env!("CARGO_PKG_VERSION"),
            }),
        );
    }
}

/// Read-only lifecycle evidence, disabled unless the local trace is on.
pub fn window_snapshot(
    window: &tauri::Window,
    stage: &'static str,
    metrics: std::collections::BTreeMap<String, f64>,
) {
    if !enabled() {
        return;
    }
    let window = window.clone();
    let dispatcher = window.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        snapshot_on_main_thread(&window, stage, metrics);
    });
}

fn snapshot_on_main_thread(
    window: &tauri::Window,
    stage: &'static str,
    metrics: std::collections::BTreeMap<String, f64>,
) {
    let mut metrics = metrics;
    metrics.insert(
        "visible".into(),
        window.is_visible().unwrap_or(false) as u8 as f64,
    );
    metrics.insert(
        "minimized".into(),
        window.is_minimized().unwrap_or(false) as u8 as f64,
    );
    metrics.insert(
        "focused".into(),
        window.is_focused().unwrap_or(false) as u8 as f64,
    );
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
            let integer: unsafe extern "C" fn(*mut c_void, *const c_void) -> usize =
                std::mem::transmute(objc_msgSend as *const ());
            let boolean: unsafe extern "C" fn(*mut c_void, *const c_void) -> i8 =
                std::mem::transmute(objc_msgSend as *const ());
            let selector = |name: &std::ffi::CStr| sel_registerName(name.as_ptr());
            let app_class = objc_getClass(c"NSApplication".as_ptr());
            let app = integer(app_class, selector(c"sharedApplication")) as *mut c_void;
            metrics.insert(
                "app_active".into(),
                (boolean(app, selector(c"isActive")) != 0) as u8 as f64,
            );
            metrics.insert(
                "app_hidden".into(),
                (boolean(app, selector(c"isHidden")) != 0) as u8 as f64,
            );
            metrics.insert(
                "occlusion_visible".into(),
                ((integer(native, selector(c"occlusionState")) & (1 << 1)) != 0) as u8 as f64,
            );
            metrics.insert(
                "key_window".into(),
                (boolean(native, selector(c"isKeyWindow")) != 0) as u8 as f64,
            );
            metrics.insert(
                "active_space".into(),
                (boolean(native, selector(c"isOnActiveSpace")) != 0) as u8 as f64,
            );
            metrics.insert(
                "window_number".into(),
                integer(native, selector(c"windowNumber")) as f64,
            );
            metrics.insert(
                "activation_policy".into(),
                integer(app, selector(c"activationPolicy")) as f64,
            );
            let view = integer(native, selector(c"contentView")) as *mut c_void;
            if !view.is_null() {
                metrics.insert(
                    "view_hidden".into(),
                    (boolean(view, selector(c"isHiddenOrHasHiddenAncestor")) != 0) as u8 as f64,
                );
                metrics.insert(
                    "view_attached".into(),
                    (integer(view, selector(c"window")) != 0) as u8 as f64,
                );
            }
        }
    }
    write(stage, None, serde_json::json!(metrics));
}

#[cfg(target_os = "macos")]
mod notifications {
    use super::*;
    use objc2::{
        rc::Retained,
        runtime::{AnyObject, ProtocolObject},
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSString};
    use std::{cell::RefCell, ptr::NonNull};

    thread_local! {
        static TOKENS: RefCell<Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(Vec::new()) };
    }

    pub fn install(window: &tauri::Window) {
        if !enabled() {
            return;
        }
        TOKENS.with(|tokens| {
            let mut tokens = tokens.borrow_mut();
            if !tokens.is_empty() {
                return;
            }
            let Ok(native) = window.ns_window() else {
                return;
            };
            let center = NSNotificationCenter::defaultCenter();
            // Observe public notifications; do not swizzle the window delegate,
            // activate the application, modify occlusion, or drive redraws.
            for (name, stage, window_only) in [
                (
                    "NSWindowDidChangeOcclusionStateNotification",
                    "native_occlusion",
                    true,
                ),
                ("NSWindowDidBecomeKeyNotification", "native_key_in", true),
                ("NSWindowDidResignKeyNotification", "native_key_out", true),
                (
                    "NSWindowDidMiniaturizeNotification",
                    "native_minimized",
                    true,
                ),
                (
                    "NSWindowDidDeminiaturizeNotification",
                    "native_restored",
                    true,
                ),
                ("NSWindowWillCloseNotification", "native_will_close", true),
                (
                    "NSApplicationDidBecomeActiveNotification",
                    "native_activated",
                    false,
                ),
                (
                    "NSApplicationDidResignActiveNotification",
                    "native_deactivated",
                    false,
                ),
                (
                    "NSApplicationDidHideNotification",
                    "native_app_hidden",
                    false,
                ),
                (
                    "NSApplicationDidUnhideNotification",
                    "native_app_unhidden",
                    false,
                ),
            ] {
                let observed_window = window.clone();
                let block = block2::RcBlock::new(move |_: NonNull<NSNotification>| {
                    // AppKit posts these on the UI thread. No DOM/JS evaluation.
                    snapshot_on_main_thread(&observed_window, stage, Default::default());
                });
                let name = NSString::from_str(name);
                unsafe {
                    let object = if window_only {
                        Some(&*native.cast::<AnyObject>())
                    } else {
                        None
                    };
                    tokens.push(center.addObserverForName_object_queue_usingBlock(
                        Some(&name),
                        object,
                        None,
                        &block,
                    ));
                }
            }
        });
        snapshot_on_main_thread(window, "native_observers_ready", Default::default());
    }

    pub fn clear() {
        TOKENS.with(|tokens| {
            let center = NSNotificationCenter::defaultCenter();
            for token in tokens.borrow_mut().drain(..) {
                unsafe {
                    center.removeObserver((*token).as_ref());
                }
            }
        });
    }
}

pub fn install_window_observers(window: &tauri::Window) {
    #[cfg(target_os = "macos")]
    notifications::install(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

pub fn clear_window_observers() {
    #[cfg(target_os = "macos")]
    notifications::clear();
}

fn write(stage: &str, epoch_ms: Option<f64>, metrics: serde_json::Value) {
    write_event(stage, epoch_ms, metrics, None);
}
fn write_event(
    stage: &str,
    epoch_ms: Option<f64>,
    metrics: serde_json::Value,
    details: Option<ErrorDetails>,
) {
    if let Some(trace) = TRACE.get() {
        if let Ok(mut file) = trace.file.lock() {
            if let Some(file) = file.as_mut() {
                let elapsed = trace.start.elapsed().as_secs_f64() * 1000.0;
                let mut line = serde_json::json!({"pid":std::process::id(),"stage":stage,"elapsedMs":epoch_ms.map(|t|t-trace.epoch_ms).unwrap_or(elapsed),"receivedMs":elapsed,"epochMs":epoch_ms.unwrap_or(trace.epoch_ms+elapsed),"receivedEpochMs":trace.epoch_ms+elapsed,"metrics":metrics});
                if let Some(details) = details {
                    line["error"] = serde_json::json!(details);
                }
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

pub fn record(
    stage: String,
    epoch_ms: f64,
    metrics: std::collections::BTreeMap<String, f64>,
    details: Option<ErrorDetails>,
) {
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
    let details = if stage == "perf_error" {
        details.map(ErrorDetails::sanitized)
    } else {
        None
    };
    write_event(&stage, Some(epoch_ms), serde_json::json!(metrics), details);
}

pub fn initialization_script() -> String {
    if enabled() {
        let gate = std::env::var("VAPORLENSDB_DIAGNOSTIC_EDITOR_GATE")
            .ok()
            .filter(|value| {
                matches!(
                    value.as_str(),
                    "workspace-input"
                        | "workspace-composition"
                        | "monaco-input"
                        | "monaco-composition"
                )
            });
        format!(
            "window.__vaporDiagnosticGateConfig = {};\n{}",
            serde_json::json!(gate),
            include_str!("startup.js")
        )
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formal_diagnostics_do_not_mutate_workspace_storage() {
        let script = include_str!("startup.js");
        assert!(!script.contains("localStorage"));
        assert!(!script.contains("sessionStorage"));
    }
    #[test]
    fn untrusted_error_text_cannot_bypass_renderer_redaction() {
        let detail = ErrorDetails {
            kind: "query SELECT secret".into(),
            name: "password".into(),
            element: "private".into(),
            location_class: "private".into(),
            message: "SELECT 'private'; password=private".into(),
            location: "file:///Users/private/config.db".into(),
            line: 1,
            column: 2,
            stack: vec![
                "SQL@file:///Users/private:1:2".into(),
                "app:/assets/MainPanel-Abcd1234.js:1:123".into(),
            ],
        }
        .sanitized();
        let json = serde_json::to_string(&detail).unwrap();
        assert!(!json.contains("private"));
        assert!(!json.contains("SELECT"));
        assert!(json.contains("MainPanel-Abcd1234.js:1:123"));
    }
    #[test]
    fn useful_static_error_and_bundled_resource_positions_survive() {
        let detail = ErrorDetails {
            kind: "resource".into(),
            name: "TypeError".into(),
            element: "script".into(),
            location_class: "app".into(),
            message: "Dynamic module import failed [details redacted]".into(),
            location: "app:/favicon.png".into(),
            line: 12,
            column: 3,
            stack: vec!["app:/assets/index-Ab_cd123.js:12:3".into()],
        }
        .sanitized();
        assert_eq!(detail.location, "app:/favicon.png");
        assert_eq!(detail.stack.len(), 1);
        assert!(detail.message.starts_with("Dynamic module"));
    }
}
