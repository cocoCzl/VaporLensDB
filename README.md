# VaporLensDB

[简体中文](README.zh-CN.md)

VaporLensDB is a lightweight cross-platform database IDE built with Tauri 2,
Rust, and React. It helps developers and data engineers connect to databases,
browse objects, run SQL, and inspect results without becoming a heavy
administration console.

Current version: **0.8.5**

## Project status

**Pre-1.0 Development.** VaporLensDB is currently developed and evaluated
from source. It has no official downloadable binary releases, GitHub Releases,
or pre-releases before 1.0.0. Locally built App bundles and installers are QA
artifacts only, not public releases.

## Distribution

**Source Build Only.** To try VaporLensDB, clone this repository and run it
locally. See the [installation guide](docs/INSTALL.md) for the distinction
between current source builds, local QA packages, and future formal installers.

## Platform validation status

VaporLensDB targets macOS, Windows, and Linux. Target support and runtime
verification are intentionally distinct:

| Platform | Current validation status |
| --- | --- |
| macOS arm64 | Strongest runtime validation, including local QA packaging and MySQL/Oracle workflows. |
| Windows x86_64 | Packaging and source-level checks completed; runtime verification pending. |
| Linux x86_64 | Packaging and source-level checks completed; runtime verification pending. |

## Database status

**Implemented is not the same as app runtime verified.** The current evidence
is deliberately recorded by layer:

| Database | Implementation | Automated / integration evidence | App runtime verification |
| --- | --- | --- | --- |
| MySQL | Native driver; optional JDBC | Native and JDBC integration coverage, including FK/LONGTEXT regression | macOS arm64 verified |
| Oracle | JDBC with a user-provided `ojdbc` JAR | JDBC query and metadata integration coverage | macOS arm64 verified |
| PostgreSQL | Native driver; optional JDBC | Automated and opt-in JDBC integration coverage | Pending |
| SQLite | Native driver; optional JDBC | Local automated coverage | Packaged-app verification incomplete |
| SQL Server | Native driver implemented in source | Source-level coverage | Pending |
| Custom JDBC | Generic configurable user-JAR path | Basic automated coverage | Vendor-specific completeness is not guaranteed |

## What it supports

- PostgreSQL, MySQL, SQLite, and SQL Server through native Rust drivers.
- Oracle through a local, user-provided `ojdbc` JAR.
- Custom JDBC drivers through user-provided JARs, driver classes, and JDBC URLs.
- A grouped, searchable Data Source explorer with clear connection states and
  independently scoped SQL execution targets.
- SQL drafts and query history, a command palette, compact read-only result
  grids, import/export tasks, SSH tunnels, diagnostics export, and
  English/Chinese UI switching.

The result grid is intentionally read-only. ODBC and a full configurable
dangerous-SQL policy are outside the current scope.

## Source-first quick start

Prerequisites: Node.js 22, pnpm 10, Rust stable, JDK 21, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
operating system.

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install
pnpm tauri dev
```

Validate a local checkout with:

```bash
./build.sh check
```

Platform-specific development and local-QA packaging requirements are in the
[packaging guide](docs/PACKAGING.md). Local packaging does not make an
official installer available.

After starting the app from source:

1. Open **New Connection**, choose a database type, enter the connection
   details, then select **Test** and **Save & Connect**.
2. Browse schemas and tables in the Data Source explorer, or create a SQL tab
   and run a query. A SQL tab keeps its own execution target while you browse
   other connections. Change the interface language or theme in **Settings**.

Oracle and custom JDBC connections require a local JDBC driver JAR. The app
guides you to add it when creating the connection.

## Local validation and QA packaging

Run the deterministic development gate before local packaging:

```bash
./build.sh check
./build.sh live-tests --mysql --oracle  # Explicit live integration selection
```

Build on the target operating system:

```bash
./build.sh mac       # macOS: .app and .dmg
./build.sh windows   # Windows: .msi and NSIS .exe
./build.sh linux     # Linux: AppImage, DEB, and RPM
```

`pnpm build:app` packages for the current platform. On macOS it creates an App
and DMG; on Windows it creates MSI and NSIS installers; on Linux it creates
AppImage, DEB, and RPM packages. Running `./build.sh` without a target is
equivalent to `./build.sh current`.

Live PostgreSQL, MySQL, Oracle, and JDBC tests are separate opt-in suites.
Copy `.env.example` to the Git-ignored `.env`, then explicitly select the
database integrations to run. Ordinary checks and packaging never load private
database configuration. See the testing guide for permissions and safety.

These outputs are local QA artifacts while VaporLensDB is pre-1.0. Future
formal-distribution procedures are retained in the
[packaging guide](docs/PACKAGING.md) for 1.0 release preparation.

## Road to 1.0

- Resolve persistence and data-safety semantics.
- Finalize the supported database matrix.
- Complete Windows and Linux runtime QA.
- Freeze the 1.0 capability scope, then perform formal signing and release
  preparation.

## Documentation

- **Users:** [Installation and first use](docs/INSTALL.md),
  [changelog](CHANGELOG.md), [roadmap](ROADMAP.md), and [security policy](SECURITY.md).
- **Contributors:** [Contributing](CONTRIBUTING.md), [testing](docs/TESTING.md),
  and [packaging and publishing](docs/PACKAGING.md).
- **Technical reference:** [JDBC metadata SQL](docs/JDBC_METADATA_SQL.md),
  [product and architecture design](docs/VaporLensDB-Design.md), and
  [technical selection](docs/VaporLensDB-Technical-Selection.md).
- **Development record:** [0.8.5 validation notes](docs/VALIDATION-NOTES-0.8.5.md)
  (internal QA evidence, not a release note).
