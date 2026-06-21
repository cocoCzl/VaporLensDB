# VaporLensDB Testing

This file tracks the verification commands that gate the current Object Tree and IDE workflow.

## Current Status

- v1 usable loop, Object Tree, SQL workspace, data preview, structure, definition/source, ER diagram, import/export, diagnostics, query history, and connection readiness smoke coverage are complete.
- Live database verification is available for PostgreSQL, MySQL, and Oracle.
- 使用 `TEST_ORACLE_*` with a local `ojdbc` JAR when running Oracle live integration tests.

## Core Verification

```bash
pnpm lint
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Smoke Verification

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

## Live Database Verification

Run these from `src-tauri` or adapt the commands with `--manifest-path src-tauri/Cargo.toml`.

```bash
cd src-tauri && cargo test --test postgres_driver -- --ignored
cd src-tauri && cargo test --test mysql_driver -- --ignored
cd src-tauri && cargo test --test oracle_jdbc_driver -- --ignored
```

Equivalent root-level commands:

```bash
TEST_PG_JDBC_URL='jdbc:postgresql://host:5432/' \
TEST_PG_USER='develop' \
TEST_PG_PASSWORD='develop' \
cargo test --manifest-path src-tauri/Cargo.toml --test postgres_driver -- --ignored

TEST_MYSQL_JDBC_URL='jdbc:mysql://host:3306/' \
TEST_MYSQL_USER='root' \
TEST_MYSQL_PASSWORD='password' \
cargo test --manifest-path src-tauri/Cargo.toml --test mysql_driver -- --ignored

TEST_ORACLE_JDBC_URL='jdbc:oracle:thin:@//host:1521/service' \
TEST_ORACLE_USER='develop' \
TEST_ORACLE_PASSWORD='develop' \
TEST_ORACLE_JDBC_DRIVER_PATH='/path/to/ojdbc11.jar' \
cargo test --manifest-path src-tauri/Cargo.toml --test oracle_jdbc_driver -- --ignored
```
