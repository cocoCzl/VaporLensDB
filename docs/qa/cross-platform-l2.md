# Cross-platform L2 runtime checklist

This checklist records future **manual desktop runtime** work. It is not
evidence that Windows or Linux has been runtime verified. Run it only on a
real graphical desktop for the listed operating system, using QA-owned
databases and a disposable SQLite root.

## Evidence rules

- Mark a case **PASS** only after it succeeds in the real desktop app.
- Mark an unperformed case **NOT EXECUTED**; do not infer it from a build,
  static analysis, or another operating system.
- Record the OS version, package/source-build route, app version/commit, and
  any required database/JDK/keyring prerequisites with the result.

## Windows L2

### Application lifecycle

- Build from source using the documented Windows prerequisites.
- Launch the desktop application; verify initial shell, menus, dialogs, SQL
  tabs, editor, and result grid.
- Quit, relaunch with the same profile, and verify no startup error.

### MySQL and PostgreSQL

For each QA datasource:

- Test Connection and Connect.
- Execute `SELECT 1`.
- Browse database/schema metadata and one table's columns.
- Disconnect, reconnect, and execute in the same old SQL tab.

### SQLite

- Connect to a native Windows path, for example
  `C:\\Users\\<qa-user>\\VaporLensDB-QA\\normal.sqlite`.
- Repeat create/query/disconnect/reconnect for a path containing spaces.
- Repeat for a Unicode directory and filename.
- Confirm the missing saved-datasource guard does not recreate a deleted file.

### Credentials and UI

- Save a disposable datasource password, restart, and verify restoration via
  Windows DPAPI without exposing the secret.
- Verify the top shell, dense tab closing, Monaco Cmd/Ctrl shortcuts, result
  grid cell copy, and native dialogs at normal and narrow window widths.

## Linux L2

### Prerequisites

- Use a real graphical Linux session, not a headless compilation-only host.
- Install the Tauri/WebKitGTK system packages listed in `docs/PACKAGING.md`.
- Provide a JRE/JDK on `PATH` for JDBC drivers where they are in scope.
- Install `libsecret-tools` and run an active Secret Service/keyring session
  before credential-storage checks.

### Application lifecycle

- Build/install via the documented Linux route.
- Launch the desktop application; verify initial shell, menus, dialogs, SQL
  tabs, editor, and result grid.
- Quit, relaunch with the same profile, and verify no startup error.

### MySQL and PostgreSQL

For each QA datasource:

- Test Connection and Connect.
- Execute `SELECT 1`.
- Browse database/schema metadata and one table's columns.
- Disconnect, reconnect, and execute in the same old SQL tab.

### SQLite

- Create/query/reconnect a normal native Linux path.
- Repeat for a path containing spaces and for a Unicode directory/filename.
- Confirm the missing saved-datasource guard does not recreate a deleted file.

### Credentials and UI

- Save a disposable datasource password, restart, and verify Secret Service
  restoration without exposing the secret.
- Verify the shell, dense tab closing, Ctrl shortcuts, result grid cell copy,
  and native dialogs at normal and narrow window widths.

## Current status

| Platform | Build/static readiness | Desktop runtime |
| --- | --- | --- |
| macOS | Current Tier-A QA scope validated | Verified |
| Windows | CI packaging workflow and platform-specific code paths exist | **NOT EXECUTED** |
| Linux | CI package workflow and Linux prerequisites documented | **NOT EXECUTED** |
