# VaporLensDB Design

## Product Design

VaporLensDB is designed as a desktop database IDE with a compact, work-focused
interface. The primary flow is grouped Data Source navigation, Object Tree
browsing, workspace tabs, and task/status feedback.

The UI favors dense operational screens over marketing-style surfaces. Common
actions are discoverable through toolbar controls, context menus, workspace
tabs, and the command palette rather than explanatory in-app copy. Connection
state uses semantic color; blue is reserved for selection and focus.

Browsing a Data Source and executing SQL are separate contexts. Expanding or
selecting a source establishes the browsing context, while each SQL tab keeps
its own execution target to prevent an explorer action from changing where SQL
runs.

## Application Architecture

- React renders the main IDE shell, grouped Data Source explorer, connection
  dialogs, Object Tree, editors, data grids, inspectors, command palette, and
  task/status surfaces.
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
[`TESTING.md`](TESTING.md).
