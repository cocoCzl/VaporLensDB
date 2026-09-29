# Changelog

All notable changes to VaporLensDB are documented in this file.

## [0.9.1]

### Added

- Added cancellable CSV Preview using the existing task cancellation lifecycle.
- Added an RC release checklist for the frozen 1.0 scope.

### Fixed

- Switched Tier-A native PostgreSQL, MySQL, and SQLite CSV imports from SQL
  literal construction to database parameter binding in batch and fallback
  paths.
- Fixed PostgreSQL CSV batch fallback after constraint failures by recovering
  through savepoints.
- Fixed PostgreSQL CSV parameters to use text wire format so the server can
  parse values using the prepared statement's target column types.
- Fixed SQL statement splitting for backslash-escaped strings under the
  supported default MySQL lexer behavior.

### Changed

- Clarified the frozen 1.0 Tier-A scope and explicit unsupported boundaries.
- Added PostgreSQL and MySQL native CSV runtime acceptance to the opt-in QA
  tooling while retaining the disposable-environment safety gate.
- Made the staged macOS QA App the sole long-lived release-like application
  identity by removing Tauri's raw App after DMG creation and staging succeed.
- Defined an explicitly marked pre-1.0 GitHub Pre-release policy for RC test
  artifacts without changing the stable 1.0 release gate.

### Testing

- Verified PostgreSQL and MySQL native parameterized CSV imports through the
  production import path against disposable QA databases.
- Verified multi-batch imports, transaction behavior, constraint fallback,
  NULL, Unicode, special-character and SQL-looking values, victim-table
  survival, and PostgreSQL wide-table parameter budgeting.

## [0.9.0]

### Changed

- Finalized native build-target readiness and platform-validation documentation.
- Added local macOS development and QA application-registration hygiene.

## [0.8.5]

### Fixed

- Synced the connection-dialog header icon with the selected database driver.

### Changed

- Reduced the startup splash delay after the backend becomes ready.
- Removed redundant generic guidance from data-source editing headers.

## [0.8.4]

### Added

- Added persisted resizing and collapsing for the SQL result panel.
- Added dedicated light and dark Monaco themes and section navigation for data-source editing.

### Changed

- Redesigned the application chrome, sidebars, tabs, toolbars, data grid, settings, dialogs, menus, and empty states around a compact professional IDE system.
- Consolidated global actions into contextual surfaces and tightened bundle budgets without adding runtime dependencies.
- Replaced the raster splash screen with a lightweight SVG/CSS startup experience.

### Testing

- Verified PostgreSQL, MySQL, and Oracle against the complete live integration and release gates.

## [0.8.3]

### Added

- Added a local macOS DMG creation script and replaceable, fixed-name artifact
  staging for App bundles, DMGs, and checksums.
- Added optional `.env`-driven PostgreSQL, MySQL, Oracle, and JDBC integration
  testing through the build script, including a dedicated `live-tests` target.
- Added fixed-name Windows MSI/NSIS and Linux AppImage/DEB/RPM staging, checksum
  generation, and a manually triggered hosted packaging check.
- Added the project-owned JDBC bridge to packaged application resources while
  keeping all vendor JDBC drivers user-provided and local.

### Changed

- Updated packaging and installation documentation to distinguish private test
  artifacts from formal GitHub Releases.
- Made current-platform builds select the supported installer formats and
  validate version consistency before packaging.
- Enabled TypeScript unused-code checks and refreshed the release verification
  guidance.

### Removed

- Removed obsolete public and runtime brand assets.

## [0.8.2]

### Changed

- Added database-vendor icons across data-source surfaces, with a neutral
  fallback for custom JDBC connections.

## [0.8.1]

### Added

- Multi-data-source IDE workspace with grouped, searchable Data Sources.
- Separate browsing and SQL execution contexts, so navigating the explorer does
  not change an open SQL tab's execution target.
- SQL draft recovery, data-source-scoped query history, and a global command
  palette.
- Data Source management workspace, connection-state feedback, and expanded
  workspace smoke coverage.

### Changed

- Refined the IDE shell, Object Tree, editor toolbar, and management surfaces
  for a compact JetBrains-style light and dark theme.
- Documented the public release workflow and removed internal planning records
  from the repository.

### Security

- Oracle and custom JDBC drivers remain local user-provided artifacts; database
  credentials, private endpoints, and driver files are not included in releases.
