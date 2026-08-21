# VaporLensDB Roadmap

VaporLensDB aims to stay faster and simpler than broad administration suites.
Roadmap order is based on workflow value, reliability, and measurable resource
cost rather than feature count.

## Release readiness

- Validate signed and upgrade-safe installers on macOS, Windows, and Linux.
- Complete OS credential-store and SSH-tunnel compatibility testing.
- Expand behavior, accessibility, startup-time, RSS, and large-result tests.

## Core database workflow

- Server-side filtering, sorting, and pagination for table data.
- Explicit transaction and autocommit controls.
- Safe editable data with a change preview and commit/rollback flow.
- Better SQL parsing, formatting, and execution-plan visualization.

## Advanced workflow

- Schema comparison and migration SQL generation.
- Session, lock, and activity monitoring.
- A documented extension model for drivers and focused integrations.

Large DBA suites, silent proprietary-driver downloads, and an unrestricted
plugin runtime are not current priorities.
