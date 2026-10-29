//! A disposable native startup hint, never an independent user preference.
//! HTML reads the existing localStorage preference and refreshes this hint.
use serde::Deserialize;
use std::{io::Read, path::Path};
use tauri::utils::config::Color;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Light,
    Dark,
    #[default]
    System,
}

impl Appearance {
    pub fn configure_startup_window(self, window: &mut tauri::utils::config::WindowConfig) {
        window.theme = self.native();
        // On macOS, WindowConfig.background_color also configures WKWebView's
        // under-page background. On macOS 27 that path leaves the standard
        // titlebar in its initial appearance after runtime theme changes.
        // Set only the native canvas in setup, before the event loop starts.
        #[cfg(target_os = "macos")]
        {
            window.background_color = None;
        }
        #[cfg(not(target_os = "macos"))]
        if self.native().is_some() {
            window.background_color = Some(self.background(false));
        }
    }

    pub fn native(self) -> Option<tauri::Theme> {
        match self {
            Self::Light => Some(tauri::Theme::Light),
            Self::Dark => Some(tauri::Theme::Dark),
            Self::System => None,
        }
    }
    pub fn background(self, system_dark: bool) -> Color {
        // Rounded sRGB values of the shared startup.css --background tokens.
        if self == Self::Dark || (self == Self::System && system_dark) {
            Color(19, 21, 27, 255)
        } else {
            Color(245, 247, 250, 255)
        }
    }
    fn code(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::System => "system",
        }
    }
}

/// Keep native window paint separate from WKWebView's under-page background.
pub fn set_canvas_background(window: &tauri::WebviewWindow, color: Color) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let canvas = window.as_ref().window();
    #[cfg(not(target_os = "macos"))]
    let canvas = window;
    canvas.set_background_color(Some(color))
}
fn hint_path(dir: &Path) -> std::path::PathBuf {
    dir.join(if cfg!(debug_assertions) {
        "startup-theme-dev"
    } else {
        "startup-theme"
    })
}
pub fn read_hint(dir: &Path) -> Appearance {
    let mut value = String::new();
    if let Ok(file) = std::fs::File::open(hint_path(dir)) {
        let _ = file.take(16).read_to_string(&mut value);
    }
    match value.as_str() {
        "light" => Appearance::Light,
        "dark" => Appearance::Dark,
        _ => Appearance::System,
    }
}
pub fn write_hint(dir: &Path, theme: Appearance) -> std::io::Result<()> {
    let path = hint_path(dir);
    if std::fs::read_to_string(&path).ok().as_deref() == Some(theme.code()) {
        return Ok(());
    }
    // Only a tiny disposable hint; interrupted writes safely resolve to System.
    std::fs::write(path, theme.code())
}

#[cfg(target_os = "macos")]
pub fn system_dark() -> bool {
    use core_foundation::{
        base::{CFType, TCFType},
        string::{CFString, CFStringRef},
    };
    use std::ffi::c_void;
    extern "C" {
        fn CFPreferencesCopyAppValue(key: CFStringRef, app: CFStringRef) -> *const c_void;
        static kCFPreferencesAnyApplication: CFStringRef;
    }
    // Public CoreFoundation preference API, no shell process or private WebKit API.
    unsafe {
        let value = CFPreferencesCopyAppValue(
            CFString::new("AppleInterfaceStyle").as_concrete_TypeRef(),
            kCFPreferencesAnyApplication,
        );
        if value.is_null() {
            return false;
        }
        CFType::wrap_under_create_rule(value)
            .downcast::<CFString>()
            .is_some_and(|value| value == "Dark")
    }
}
#[cfg(not(target_os = "macos"))]
pub fn system_dark() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_window_keeps_theme_preference_without_a_webview_background_override() {
        for theme in [Appearance::Light, Appearance::Dark, Appearance::System] {
            let mut window = tauri::utils::config::WindowConfig {
                background_color: Some(Color(1, 2, 3, 255)),
                ..Default::default()
            };
            theme.configure_startup_window(&mut window);
            assert_eq!(window.theme, theme.native());
            #[cfg(target_os = "macos")]
            assert_eq!(window.background_color, None);
            #[cfg(not(target_os = "macos"))]
            if theme.native().is_some() {
                assert_eq!(window.background_color, Some(theme.background(false)));
            }
        }
    }
    #[test]
    fn explicit_theme_wins_and_system_is_not_frozen() {
        assert_eq!(
            Appearance::Light.background(true),
            Appearance::Light.background(false)
        );
        assert_eq!(
            Appearance::Dark.background(false),
            Appearance::Dark.background(true)
        );
        assert_eq!(
            Appearance::System.background(true),
            Appearance::Dark.background(false)
        );
        assert_eq!(
            Appearance::System.background(false),
            Appearance::Light.background(true)
        );
        assert_eq!(Appearance::System.native(), None);
    }
    #[test]
    fn hint_recovers_from_missing_invalid_and_changed_preferences() {
        let dir = std::env::temp_dir().join(format!("vapor-appearance-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(read_hint(&dir), Appearance::System);
        write_hint(&dir, Appearance::Light).unwrap();
        assert_eq!(read_hint(&dir), Appearance::Light);
        std::fs::write(hint_path(&dir), "invalid").unwrap();
        assert_eq!(read_hint(&dir), Appearance::System);
        write_hint(&dir, Appearance::Dark).unwrap();
        assert_eq!(read_hint(&dir), Appearance::Dark);
        write_hint(&dir, Appearance::System).unwrap();
        assert_eq!(read_hint(&dir), Appearance::System);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
