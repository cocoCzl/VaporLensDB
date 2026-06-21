# VaporLensDB

VaporLensDB is a Tauri 2 + Rust + React database IDE. It focuses on a fast Object Tree, SQL editing, read-only inspection workflows, and practical database operations without becoming a heavy all-purpose administration console.

Current version: `0.4.2`.

## Current Status

The v1 usable loop, Object Tree and IDE workflow, and current post-v1 backlog are complete as tracked in `docs/TESTING.md`.

Supported connection paths:

- PostgreSQL: native Rust driver for connection management, SQL execution, metadata browsing, DDL, completion, query cancel, and live integration tests.
- MySQL: native Rust driver for connection management, SQL execution, metadata browsing, DDL, completion, and live integration tests.
- Oracle: JDBC support with user-provided `ojdbc` JAR for connection, SQL execution, Object Tree metadata, DDL/source, and completion.
- SQLite: native file-based connections, SQL execution, metadata browsing, and local integration tests.
- SQL Server: native `tiberius` path for connection, SQL execution, metadata browsing, DDL, and Explain where supported.
- Custom JDBC: user-defined JDBC runtime support through the driver manager.

Completed workflows include:

- Data Sources, SQL workspace, Sessions, and Settings shell.
- Lazy Object Tree with catalog/schema linkage, system-object filtering, search, keyboard navigation, right-click actions, and table/view quick actions.
- Read-only Data tabs with pagination, filtering, sorting, generated SQL, and CSV export.
- Structure, DDL, Source, Object Inspector, and ER Diagram workspaces.
- Background task manager for long-running export/import work with progress and cancellation.
- CSV table import/export tasks and transactional data editing queue.
- SSH tunnel support for password and private-key authentication.
- DBeaver configuration import preview/import.
- Query history with status/connection filtering, long SQL preview, and error detail preview.
- Diagnostics package export with SQL redaction by default.
- Complete English/Chinese locale key coverage for the main UI flows.

Out of current scope:

- ODBC support has been removed from the product scope.
- Workspace/project isolation is deferred.
- Full configurable dangerous-SQL policy UI is intentionally not planned; the app keeps the lightweight confirmation model.

## Development

Install dependencies:

```bash
pnpm install
```

Run the frontend only:

```bash
pnpm dev
```

Run the Tauri desktop app:

```bash
pnpm tauri dev
```

Build the frontend:

```bash
pnpm build
```

Run lint:

```bash
pnpm lint
```

Run Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Validate and package the desktop app:

```bash
./build.sh check
./build.sh mac
```

`./build.sh check` is the release gate. It builds the JDBC bridge and runs frontend lint, frontend build, Rust clippy with warnings denied, and Rust tests. GitHub Actions runs the same default verification on pushes and pull requests to `main` or `master`.

macOS artifacts are written to:

```text
src-tauri/target/release/bundle/macos/VaporLensDB.app
src-tauri/target/release/bundle/dmg/*.dmg
```

## Smoke Tests

The project uses focused Node smoke scripts for frontend and contract regressions. Common commands:

```bash
pnpm test:v1-ui-scope
pnpm test:object-tree-workflow
pnpm test:driver-manager
pnpm test:result-export
pnpm test:table-import-export
pnpm test:data-editing-queue
pnpm test:er-diagram
pnpm test:object-inspector-workspace
pnpm test:session-management
pnpm test:dbeaver-import
pnpm test:i18n
pnpm test:diagnostics-export
pnpm test:query-history-workflow
pnpm test:object-tree-action-discoverability
pnpm test:command-contracts
```

`docs/TESTING.md` contains the authoritative full verification command list.

## Live Integration Tests

Ignored integration tests require real database endpoints and are not part of default CI. Keep credentials in an untracked `.env` or your shell session; `.env.example` contains placeholder names only.

```bash
TEST_PG_JDBC_URL='jdbc:postgresql://<postgres-host>:5432/<postgres-database>' \
TEST_PG_USER='<postgres-user>' \
TEST_PG_PASSWORD='<postgres-password>' \
cargo test --manifest-path src-tauri/Cargo.toml --test postgres_driver -- --ignored

TEST_MYSQL_JDBC_URL='jdbc:mysql://<mysql-host>:3306/<mysql-database>' \
TEST_MYSQL_USER='<mysql-user>' \
TEST_MYSQL_PASSWORD='<mysql-password>' \
cargo test --manifest-path src-tauri/Cargo.toml --test mysql_driver -- --ignored

TEST_ORACLE_JDBC_URL='jdbc:oracle:thin:@//<oracle-host>:1521/<oracle-service>' \
TEST_ORACLE_USER='<oracle-user>' \
TEST_ORACLE_PASSWORD='<oracle-password>' \
TEST_ORACLE_JDBC_DRIVER_PATH='/path/to/ojdbc11.jar' \
cargo test --manifest-path src-tauri/Cargo.toml --test oracle_jdbc_driver -- --ignored
```

The latest recorded live verification passed against PostgreSQL, MySQL, and Oracle; see `docs/TESTING.md` for exact status.

## Important Documents

- `CONTEXT.md`: terminology and project context.
- `CHANGELOG.md`: public version history from the first public-ready snapshot.
- `CONTRIBUTING.md`: setup, verification, and contribution expectations.
- `SECURITY.md`: security reporting and sensitive-data handling.
- `docs/TESTING.md`: current progress, completed work, verification commands, and remaining scope.
- `docs/PRD-object-tree-and-ide-workflow.md`: Object Tree and IDE workflow product requirements.
- `docs/VaporLensDB-Design.md`: product and architecture design.
- `docs/VaporLensDB-Technical-Selection.md`: technical selection rationale.
- `docs/adr/`: architecture decision records.
