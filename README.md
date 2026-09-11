# VaporLensDB

[简体中文](README.zh-CN.md)

VaporLensDB is a lightweight cross-platform database IDE built with Tauri 2,
Rust, and React. It helps developers and data engineers connect to databases,
browse objects, run SQL, and inspect results without becoming a heavy
administration console.

Current version: **0.8.5**

## Download

VaporLensDB 0.8.5 is a **Technical Preview** for macOS arm64. It is an
ad-hoc test artifact: it is not Developer ID signed, notarized, or stapled.
Runtime verification for Windows, Linux, and PostgreSQL remains pending.
See the [0.8.5 Technical Preview release notes](docs/RELEASE-NOTES-0.8.5.md)
before installing it. Development and test installers are not published as
GitHub Releases. Manually triggered packaging checks may retain temporary
GitHub Actions artifacts for seven days.

| Platform | Recommended download | Notes |
| --- | --- | --- |
| macOS | `.dmg` | 0.8.5 Technical Preview is verified on Apple Silicon (arm64) only. |
| Windows | — | Runtime verification is pending; do not treat CI packages as release-ready. |
| Linux | — | Runtime verification is pending; do not treat CI packages as release-ready. |

See the [installation and first-use guide](docs/INSTALL.md) for platform
installation steps, SHA-256 verification, and Oracle/JDBC setup.

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

## Quick start

1. For the 0.8.5 macOS arm64 Technical Preview, mount the supplied DMG and
   drag **VaporLensDB.app** to Applications. Gatekeeper will not recognize the
   artifact because Developer ID signing and notarization are pending.
2. Open **New Connection**, choose a database type, enter the connection
   details, then select **Test** and **Save & Connect**.
3. Browse schemas and tables in the Data Source explorer, or create a SQL tab
   and run a query. A SQL tab keeps its own execution target while you browse
   other connections. Change the interface language or theme in **Settings**.

Oracle and custom JDBC connections require a local JDBC driver JAR. The app
guides you to add it when creating the connection.

## Build from source

Source builds require Node.js 22, pnpm 10, Rust stable, and JDK 21.

```bash
pnpm install
pnpm tauri dev
```

Run the release checks before packaging:

```bash
./build.sh check
./build.sh live-tests --mysql --oracle  # Explicit RC live integration selection
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

Detailed prerequisites, artifact locations, and the formal GitHub Release
process are in the [packaging guide](docs/PACKAGING.md).

## Documentation

- **Users:** [Installation and first use](docs/INSTALL.md),
  [changelog](CHANGELOG.md), [roadmap](ROADMAP.md), and [security policy](SECURITY.md).
- **Contributors:** [Contributing](CONTRIBUTING.md), [testing](docs/TESTING.md),
  and [packaging and publishing](docs/PACKAGING.md).
- **Technical reference:** [JDBC metadata SQL](docs/JDBC_METADATA_SQL.md),
  [product and architecture design](docs/VaporLensDB-Design.md), and
  [technical selection](docs/VaporLensDB-Technical-Selection.md).
