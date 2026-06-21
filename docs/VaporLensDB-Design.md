# VaporLensDB Design

## Product Design

VaporLensDB is designed as a desktop database IDE with a compact, work-focused
interface. The primary flow is connection selection, Object Tree navigation,
workspace tabs, and task/status feedback.

The UI favors dense operational screens over marketing-style surfaces. Common
actions should be discoverable through toolbar controls, context menus, and
workspace tabs rather than explanatory in-app copy.

## Application Architecture

- React renders the main IDE shell, connection dialogs, Object Tree, editors,
  data grids, inspectors, and task/status surfaces.
- Tauri commands form the boundary between frontend IPC contracts and backend
  services.
- Rust services own connection storage, connection lifecycle, metadata loading,
  query execution, query history, diagnostics, driver catalog behavior, SSH
  tunnels, and background task management.
- Native Rust drivers handle PostgreSQL, MySQL, SQLite, and SQL Server.
- A lightweight Java JDBC bridge handles Oracle and custom JDBC drivers.

## Data and Secret Handling

Saved passwords are encrypted at rest. DBeaver import requires manual password
entry because external credential formats may be encrypted or application
specific. Diagnostics redact SQL by default and avoid exporting result data or
decrypted secrets.

## Verification Model

Default validation must run from a fresh clone without private databases. Live
database coverage is available through ignored manual tests documented in
`docs/TESTING.md`.
