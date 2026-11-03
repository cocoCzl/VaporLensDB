# Native lifecycle / first editor diagnostics

These probes are off unless `VAPORLENSDB_STARTUP_TRACE` names a writable local
JSONL file. Keep logs, isolated profiles, app shells and release binaries outside
the repository. Build with `pnpm tauri build --no-bundle --no-sign`; do not enable
DevTools or change dependency versions to run this experiment.

The event stream records Rust monotonic receive time, renderer event time and
wall-clock time (for matching external experiment annotations). AppKit observers
read activation, key-window, occlusion, minimize/restore and hide/unhide state.
They do not activate, show, redraw or resize windows, or replace native delegates.
The DOM observer disconnects at shell commit. rAF requests are event-driven,
limited to eight outstanding requests and use immutable IDs. A callback is not
physical paint; an absent/late callback must not be called click latency.

Error evidence is capped at 20 renderer events. It preserves standard error type,
finite message templates, bundled source positions and redacted stack locations.
Arbitrary messages are wholly redacted because they may echo SQL, clipboard,
IME contents or credentials. Source URLs omit query, fragment, external host,
userinfo, arbitrary file paths and function/argument text. Rust validates the
allowlist again. Unknown errors may therefore remain unclassified; do not infer
that an error caused occlusion just because it preceded it.

## First loading boundary experiment

Only when tracing is on, additionally set
`VAPORLENSDB_DIAGNOSTIC_EDITOR_GATE` to one of:

| Value | Artificial boundary held until a real event |
| --- | --- |
| `workspace-input` | First workspace module readiness, until draft input/paste |
| `workspace-composition` | First workspace module readiness, until compositionstart |
| `monaco-input` | First Monaco readiness handoff, until draft input/paste |
| `monaco-composition` | First Monaco readiness handoff, until compositionstart |

The textarea stays editable. No fixed delay, key synthesis, fake composition or
automatic focus loop is involved. A composition event before module resolution
also releases the gate. Normal/trace-on ungated runs and gated boundary runs must
be reported separately: the gate proves handoff behavior under a controlled
overlap, not its natural frequency. Always start a fresh process with no restored
SQL tab; a later Tab in an already loaded workspace is insufficient.

`perf_editor_phase` uses boundary 1=workspace, 2=Monaco; event 1=module requested,
2=module/instance available, 3=draft mounted, 4=draft handoff, 5=Monaco focused/ready.
Numeric lengths, selection offsets, focus, composing and equality flags are
allowed. Text, SQL, keys, event.data, tab/connection IDs and labels are not.
`perf_editor_input` events are 1=focusin, 2=focusout, 3=beforeinput, 4=input,
5=compositionstart, 6=compositionend, 7=select. They observe loading drafts only.

Run redaction/probe regressions with:

```sh
node --test scripts/startup-diagnostics.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --offline --lib utils::startup::tests
```

For the human control, first finish automation, restore the documented control
mode, quit the QA app and give its exact path and seed/build hashes. During human
operation do not select, activate, snapshot or inspect any window with CUA. Read
passive log files only, after the user reports completion. Preserve first failed
runs even if closing/reopening succeeds.

For a known empty workspace, the disposable bundle
`com.vaporlensdb.qa.lifecycle` can additionally set
`VAPORLENSDB_DIAGNOSTIC_EMPTY_WORKSPACE=1`. This removes only its
`vaporlensdb.sqlWorkspace.v1` localStorage snapshot before application modules
execute, independently of trace on/off. Ordinary bundle IDs cannot opt in.
A fresh backend `VAPORLENSDB_CONFIG_DIR` alone does **not** reset this browser
snapshot. Keep website/OS caches labeled retained; this is not strict cold cache.
The locked Tauri 2.11.1 `WebviewAttributes::from(WindowConfig)` does not copy
`data_store_identifier`, so setting that config field did not isolate storage
in our experiment. The ineffective approach was removed; no dependency upgrade
or alternate window-creation path is used.
