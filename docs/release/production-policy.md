# Production policy

This document defines the desktop policy for a future formal VaporLensDB
release. It does not authorize a release, signing, notarization, or publication.

## DevTools

- Development builds retain Tauri DevTools through Rust `debug assertions`.
  Tauri injects its development Inspector shortcut only in that build mode.
- VaporLensDB's direct `tauri` dependency uses an explicit feature list and
  does **not** enable Tauri's `devtools` feature. Consequently, DevTools APIs
  and Tauri's shortcut-injection command are not compiled into release
  artifacts.
- There is no VaporLensDB application menu command that opens DevTools.
- A result-grid cell owns its localized application context menu. Other native
  context-menu behavior is not globally disabled by this policy.

Before a formal release, verify the unsigned/ad-hoc release artifact starts,
its normal application and result-grid context menus work, and common DevTools
shortcuts do not open an Inspector. The later signed-package QA repeats that
check after Developer ID signing and notarization.

## Capability review

`src-tauri/capabilities/default.json` is intentionally limited to the desktop
window, event, dialog, clipboard-write, and external-link operations used by
the application. The apparent DevTools permission inside Tauri's broad core
default is only meaningful when the corresponding command is compiled; the
release dependency deliberately excludes that command. Do not add the Tauri
`devtools` feature for a production build.

## Deferred formal-release work

- Minimum macOS entitlement verification.
- Developer ID signing, notarization, and stapling.
- Downloaded signed-artifact first-launch and upgrade verification.
