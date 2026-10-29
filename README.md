# VaporLensDB

[简体中文](README.zh-CN.md)

VaporLensDB is a SQL-first database client for developers, built with Tauri 2,
Rust and React. **Version 0.9.1 is under active development, before 1.0; it is
not yet stable or production-ready.** Build locally from source.

## Features

- Multi-tab SQL with independent execution targets, Auto/Manual transactions,
  SQL files, drafts and query history.
- Searchable, grouped connections; schema and object browsing, definitions,
  read-only result grids and Explain result inspection.
- CSV import/export, background tasks, session management and diagnostics.
- Native Rust and JDBC drivers selected per connection; user-defined database
  products and pinned JDBC installations.
- English/Chinese UI, light/dark/system themes and a command palette.

## Support overview

MySQL, PostgreSQL and SQLite have the primary native support paths. SQL Server
native is implemented with limited runtime verification. Oracle and custom JDBC
are experimental and require user-provided vendor JARs. Optional JDBC drivers do
not inherit a product's native support status.

macOS Apple Silicon has build and desktop verification coverage. Intel macOS,
Windows and Linux have build targets, but desktop runtime remains unverified.
See [support and limitations](docs/SUPPORT.md) for the database/platform matrix,
parameterized import, cancellation, transactions, SSH/TLS and fetching limits.

## Get started

Use Node.js 22.22.2+ within 22.x or 24.15.0+ within 24.x, pnpm 10, stable Rust
with rustfmt/clippy, JDK 21, and your host's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
pnpm tauri dev
```

For JDBC in development, first run `./build.sh jdbc-bridge`.
To validate and build a local installer, run `./build.sh current`; to validate
without packaging, use `./build.sh check`. These commands need no database
credentials or vendor JARs. Using native connections in a packaged app does not
require Java. See [installation](docs/INSTALL.md) for details and artifact paths.

## Plans

These are plans, not implemented features or additional 1.0 commitments:

- Before 1.0: address correctness/privacy issues and verify current workflows;
  extend platform support only after runtime testing.
- After 1.0: safe table-data editing with reviewed changes and Apply/Revert;
  richer Explain, column hide/freeze, metadata efficiency and vendor capabilities;
  schema comparison/migration SQL, monitoring and a documented extension model.
- Signed/notarized binary distribution is separate future work.

## Documentation

- [Install and first use](docs/INSTALL.md) — English
- [Driver management and metadata SQL](docs/DRIVER-MANAGEMENT.md) — Chinese
- [Support and limitations](docs/SUPPORT.md) — English
- [Testing](docs/TESTING.md) and [contributing](CONTRIBUTING.md) — English
- [Changelog](CHANGELOG.md), [security](SECURITY.md), [license](LICENSE) — English
