# VaporLensDB

[简体中文](README.zh-CN.md)

VaporLensDB is a SQL-first database client for developers, focused on reliable
querying, transactions, result inspection, schema exploration, and data exchange.
It is built with Tauri 2, Rust, and React.

Current version: **0.9.1**

## Project status

**Pre-1.0 Development.** VaporLensDB is still under development and is not
stable or production-ready.

## Current distribution: source build

Current development distribution is **source-first**: clone the repository and
build VaporLensDB on your own machine. Public binary releases and DMG uploads,
Developer ID signing, and notarization are not part of this stage. Future binary
release procedures remain documented separately; they are not prerequisites
for using the source.

### Prerequisites, clone, and local build

Use a current Node.js 22 patch (22.22.2 or newer within 22.x) or Node.js 24 patch
(24.15.0 or newer within 24.x), pnpm 10, current stable Rust/cargo with rustfmt
and clippy, and JDK 21. These Node patch recommendations follow the locked test
dependencies; they are not a project-wide compatibility guarantee. See the
[toolchain policy](docs/INSTALL.md#toolchain-policy) for CI configuration,
locally tested versions, and the distinction from minimum requirements.

On macOS, install Xcode Command Line Tools. The verified Apple Silicon source
build does not require full Xcode, an Apple Developer Program membership,
a Developer ID certificate, or notarization credentials. Other hosts need their
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
./build.sh current
```

`current` runs the deterministic checks and then packages for the host platform.
It installs from the lockfile automatically if `node_modules` is absent; the
explicit install above also synchronizes an existing checkout with the lockfile.
Neither this build nor `./build.sh check` needs `.env`, database credentials, or
vendor JDBC JARs.

On Apple Silicon macOS, local outputs are:

```text
artifacts/macos/aarch64/VaporLensDB.app
artifacts/macos/aarch64/VaporLensDB.dmg
artifacts/macos/aarch64/SHA256SUMS.txt
```

These are local build artifacts, not published binary releases. The project-owned
JDBC bridge is built as part of validation and packaging, so JDK 21 is needed
even without JDBC data sources. Oracle/custom vendor JARs are supplied only when
configuring those data sources at runtime.

See [installation and first use](docs/INSTALL.md) for platform details.

## Platform and database status

The canonical [support matrix](docs/SUPPORT.md) records implementation,
automated evidence, per-platform runtime evidence, and 1.0 support tier as
separate facts.

The verified fresh-clone → validation → local package path is **macOS Apple
Silicon / arm64**. Intel macOS, Windows, and Linux have native source build
targets, but are not covered by that acceptance evidence.

| Platform | Build Target | Desktop Runtime Verification |
| --- | --- | --- |
| macOS Apple Silicon / arm64 | Yes | Tier-A verified |
| macOS Intel / x86_64 | Yes | Not covered by current acceptance |
| Windows | Yes | **NOT EXECUTED** |
| Linux | Yes | **NOT EXECUTED** |

- macOS arm64 Tier-A runtime is verified for MySQL, PostgreSQL, and SQLite.
- Oracle JDBC and Custom JDBC are experimental / best-effort, not Tier-A.
- SQL Server is implemented but is not advertised as a 1.0 Tier-A target.

## What it supports

- PostgreSQL, MySQL, and SQLite through Tier-A native Rust drivers.
- SQL Server through a native Rust driver, without a Tier-A support promise.
- Oracle through a local, user-provided `ojdbc` JAR.
- Custom JDBC drivers through user-provided JARs, driver classes, and JDBC URLs.
- A grouped, searchable Data Source explorer with clear connection states and
  independently scoped SQL execution targets.
- SQL drafts and query history, a command palette, compact read-only result
  grids, Tier-A native parameterized CSV import, result export tasks, SSH
  tunnels, diagnostics export, and English/Chinese UI switching.

The result grid is intentionally read-only. Table Data Editing (inline edits,
insert/delete row UI, and Apply/Revert mutations) is excluded from 1.0 and remains
a post-1.0 major feature. ODBC and a full configurable
dangerous-SQL policy are outside the current scope. Parameterized CSV import
is not supported for SQL Server or JDBC drivers, and full-query export accepts
one statement rather than multi-statement, multi-result scripts. See the
[support matrix](docs/SUPPORT.md) for the complete 1.0 limits.

## Development, validation, and local packaging

From the repository root, after installing dependencies:

| Purpose | Command | Result |
| --- | --- | --- |
| Frontend development | `pnpm dev` | Vite development server; desktop commands require Tauri |
| Desktop development | `pnpm tauri dev` | Tauri development app, no DMG |
| Validation | `./build.sh check` | Complete deterministic gate, no installer |
| Local packaged build | `./build.sh current` | Validation plus host-platform packages |

For JDBC during desktop development, first run `./build.sh jdbc-bridge`.
`pnpm build` builds frontend assets only. `pnpm build:app` and `./build.sh`
without a target are alternatives to `./build.sh current`.

Windows and Linux local packages are staged under
`artifacts/windows/<architecture>/` and `artifacts/linux/<architecture>/`.
See [packaging](docs/PACKAGING.md) for native-host prerequisites and formats.
Real-database integration tests are separate opt-in work described in
[testing](docs/TESTING.md); they are not required to build from a fresh clone.

After launching the app:

1. Open **New Connection**, choose a database type, enter the connection
   details, then select **Test** and **Save & Connect**.
2. Browse schemas and tables in the Data Source explorer, or create a SQL tab
   and run a query. A SQL tab keeps its own execution target while you browse
   other connections. Change the interface language or theme in **Settings**.

## Road to 1.0

- Follow the [SQL-first 1.0 scope](docs/V1-SCOPE.md) and its bounded
  [acceptance gates](docs/V1-ACCEPTANCE.md); scope is locked, acceptance is pending.
- Close confirmed privacy/presentation defects and verify the latest workflows
  on macOS arm64. Other platforms require runtime QA before support promotion.
- Keep source-product acceptance separate from future binary distribution,
  signing, notarization, and an explicitly approved version change.

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
- **Current support status:** [support matrix](docs/SUPPORT.md).
