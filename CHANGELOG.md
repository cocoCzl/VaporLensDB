# Changelog

All notable changes to VaporLensDB are documented in this file.

## [0.8.3]

### Added

- Added a local macOS DMG creation script and replaceable, fixed-name artifact
  staging for App bundles, DMGs, and checksums.
- Added optional `.env`-driven PostgreSQL, MySQL, Oracle, and JDBC integration
  testing through the build script, including a dedicated `live-tests` target.

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
