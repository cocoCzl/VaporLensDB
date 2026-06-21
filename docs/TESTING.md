# VaporLensDB Testing

This file tracks the verification commands that gate release readiness and the current Object Tree and IDE workflow.

## Current Status

- v1 usable loop, Object Tree, SQL workspace, data preview, structure, definition/source, ER diagram, import/export, diagnostics, query history, and connection readiness smoke coverage are complete.
- Default CI verification does not require private database endpoints or local JDBC driver JARs.
- Live database verification is available for PostgreSQL, MySQL, and Oracle through ignored tests that are run manually.
- 使用 `TEST_ORACLE_*` with a local `ojdbc` JAR when running Oracle live integration tests. The Oracle driver JAR is not committed or required by CI.

## Release Gate

Run the local release gate before tagging or publishing:

```bash
./build.sh check
```

This command builds the JDBC bridge and runs frontend lint, frontend build, Rust clippy with warnings denied, and Rust tests.

## Default CI Verification

These commands are safe for GitHub Actions and a fresh clone with Node, pnpm, Rust, and a JDK installed:

```bash
pnpm install --frozen-lockfile
! (git ls-files | rg '(^|/)[.]env($|[.])' | rg -v '(^|/)[.]env[.]example$')
! git ls-files -z | xargs -0 rg -n --hidden --glob '!pnpm-lock.yaml' --glob '!src-tauri/Cargo.lock' '192[.]168[.][0-9]{1,3}[.][0-9]{1,3}|10[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}|172[.](1[6-9]|2[0-9]|3[01])[.][0-9]{1,3}[.][0-9]{1,3}|jdbc:(postgresql|mysql|oracle):.*(192[.]168[.]|10[.]|172[.])|TEST_[A-Z0-9_]*PASS[W]ORD=['"'"'"]?(develop|password|root|admin|changeme)['"'"'"]?($|[[:space:]])|/Users/[A-Za-z0-9._/-]*ojdbc'
./build.sh jdbc-bridge
pnpm lint
pnpm build
pnpm test:object-tree-workflow
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
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

Live tests are ignored by default because they require private database endpoints and credentials. Keep values in an untracked `.env` or your shell session, using `.env.example` as the placeholder template.

Run these from `src-tauri` when your local environment is configured:

```bash
cd src-tauri && cargo test --test postgres_driver -- --ignored
cd src-tauri && cargo test --test mysql_driver -- --ignored
cd src-tauri && cargo test --test oracle_jdbc_driver -- --ignored
```

Equivalent root-level commands:

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

## Sensitive Information Check

Before publishing, scan tracked files for common leaks:

```bash
git ls-files | rg '(^|/)[.]env($|[.])' | rg -v '(^|/)[.]env[.]example$'
git ls-files -z | xargs -0 rg -n --hidden --glob '!pnpm-lock.yaml' --glob '!src-tauri/Cargo.lock' '192[.]168[.][0-9]{1,3}[.][0-9]{1,3}|10[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}|172[.](1[6-9]|2[0-9]|3[01])[.][0-9]{1,3}[.][0-9]{1,3}|jdbc:(postgresql|mysql|oracle):.*(192[.]168[.]|10[.]|172[.])|TEST_[A-Z0-9_]*PASS[W]ORD=['"'"'"]?(develop|password|root|admin|changeme)['"'"'"]?($|[[:space:]])|/Users/[A-Za-z0-9._/-]*ojdbc'
```

Expected result: no output. If the command reports a tracked file, replace real endpoints, passwords, private JDBC URLs, local `ojdbc` paths, or accidental `.env` references with placeholders before pushing.
