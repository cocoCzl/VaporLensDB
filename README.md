# VaporLensDB

[简体中文](README.zh-CN.md)

VaporLensDB is a lightweight cross-platform database IDE built with Tauri 2,
Rust, and React. It helps developers and data engineers connect to databases,
browse objects, run SQL, and inspect results without becoming a heavy
administration console.

Current version: **0.7.1**

## Download

Download the installer for your platform from
[GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest).

| Platform | Recommended download | Notes |
| --- | --- | --- |
| macOS | `.dmg` | Apple Silicon and Intel builds are released separately when available. |
| Windows | `.msi` | Use the NSIS `.exe` installer when MSI installation is restricted. |

See the [installation and first-use guide](docs/INSTALL.md) for platform
installation steps, SHA-256 verification, and Oracle/JDBC setup.

## What it supports

- PostgreSQL, MySQL, SQLite, and SQL Server through native Rust drivers.
- Oracle through a local, user-provided `ojdbc` JAR.
- Custom JDBC drivers through user-provided JARs, driver classes, and JDBC URLs.
- A searchable Object Tree, SQL editor, compact read-only result grid, query
  history, import/export tasks, SSH tunnels, diagnostics export, and
  English/Chinese UI switching.

The result grid is intentionally read-only. ODBC and a full configurable
dangerous-SQL policy are outside the current scope.

## Quick start

1. Download and install VaporLensDB for macOS or Windows from
   [GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest).
2. Open **New Connection**, choose a database type, enter the connection
   details, then select **Test** and **Save & Connect**.
3. Browse schemas and tables in the Object Tree, or create a SQL tab and run a
   query. Change the interface language or theme in **Settings**.

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
```

Build on the target operating system:

```bash
./build.sh mac       # macOS: .app and .dmg
./build.sh windows   # Windows: .msi and NSIS .exe
```

Detailed prerequisites, artifact locations, checksums, and manual GitHub
Release publishing are in the [packaging guide](docs/PACKAGING.md).

## Documentation

- [Installation and first use](docs/INSTALL.md)
- [Packaging and publishing](docs/PACKAGING.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Testing](docs/TESTING.md)
- [JDBC metadata SQL](docs/JDBC_METADATA_SQL.md)
- [Product and architecture design](docs/VaporLensDB-Design.md)
- [Technical selection](docs/VaporLensDB-Technical-Selection.md)

Product requirement documents are retained for project history in `docs/`.
