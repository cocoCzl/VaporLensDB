# VaporLensDB Testing

This file tracks the verification commands that gate release readiness for the
current IDE workspace.

## Current Status

- The 0.8.2 workspace covers grouped data sources, browsing versus SQL execution
  context, Object Tree navigation, SQL drafts and query history, command palette,
  connection readiness, and theme-aware IDE chrome.
- Existing smoke coverage also covers data preview, structure, definition/source,
  ER diagrams, import/export, diagnostics, tasks, and sessions.
- Default CI verification does not require private database endpoints or local JDBC driver JARs.
- Live database verification is available for PostgreSQL, MySQL, Oracle, SQLite,
  and JDBC template paths through ignored/manual tests.
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
pnpm test:data-source-switcher
pnpm test:object-tree-lifecycle
pnpm test:object-tree-schema-search
pnpm test:driver-manager
pnpm test:result-export
pnpm test:table-import-export
pnpm test:data-grid-read-only
pnpm test:er-diagram
pnpm test:object-inspector-workspace
pnpm test:session-management
pnpm test:dbeaver-import
pnpm test:i18n
pnpm test:diagnostics-export
pnpm test:query-history-workflow
pnpm test:sql-execution-recall
pnpm test:sql-records-connection-editor
pnpm test:object-tree-action-discoverability
pnpm test:p0-opening-workflow
pnpm test:p1-read-only-result-workflow
pnpm test:p2-object-understanding-workflow
pnpm test:command-contracts
pnpm test:command-palette
pnpm test:native-menu
pnpm test:ide-chrome
pnpm test:workspace-capacity
pnpm test:performance-guardrails
```

## Live Database Verification

Live tests are ignored by default because they require private database endpoints and credentials. Keep values in an untracked `.env` or your shell session, using `.env.example` as the placeholder template.

Run these from `src-tauri` when your local environment is configured:

```bash
cd src-tauri && cargo test --test postgres_driver -- --ignored
cd src-tauri && cargo test --test mysql_driver -- --ignored
cd src-tauri && cargo test --test oracle_jdbc_driver -- --ignored
cd src-tauri && cargo test --test jdbc_template_driver -- --ignored
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

TEST_PG_JDBC_URL='jdbc:postgresql://<postgres-host>:5432/<postgres-database>' \
TEST_PG_USER='<postgres-user>' \
TEST_PG_PASSWORD='<postgres-password>' \
TEST_PG_JDBC_DRIVER_PATH='/path/to/postgresql.jar' \
cargo test --manifest-path src-tauri/Cargo.toml --test jdbc_template_driver postgres_jdbc_template_queries_and_reads_metadata -- --ignored

TEST_MYSQL_JDBC_URL='jdbc:mysql://<mysql-host>:3306/<mysql-database>' \
TEST_MYSQL_USER='<mysql-user>' \
TEST_MYSQL_PASSWORD='<mysql-password>' \
TEST_MYSQL_JDBC_DRIVER_PATH='/path/to/mysql-connector-j.jar' \
cargo test --manifest-path src-tauri/Cargo.toml --test jdbc_template_driver mysql_jdbc_template_queries_and_reads_metadata -- --ignored
```

For JDBC Driver Template verification, attach local JARs through the app or set
driver-specific environment variables in your shell. Do not commit these values.
Validate each template against the same behaviors:

- connection test succeeds when the local JAR, driver class, URL, and
  credentials are valid;
- SQL execution returns rows;
- Object Tree metadata loads schemas, tables, and views;
- Structure metadata loads columns, primary keys, indexes, and foreign keys
  where the database exposes them;
- metadata failures leave SQL execution usable and show a clear object browsing
  failure state.

SQLite JDBC can be checked with a local SQLite JDBC JAR and a temporary database
file. PostgreSQL JDBC, MySQL JDBC, and Oracle JDBC should use private endpoints
from an untracked `.env` or shell session only.

## Sensitive Information Check

Before publishing, scan tracked files for common leaks:

```bash
git ls-files | rg '(^|/)[.]env($|[.])' | rg -v '(^|/)[.]env[.]example$'
git ls-files -z | xargs -0 rg -n --hidden --glob '!pnpm-lock.yaml' --glob '!src-tauri/Cargo.lock' '192[.]168[.][0-9]{1,3}[.][0-9]{1,3}|10[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}|172[.](1[6-9]|2[0-9]|3[01])[.][0-9]{1,3}[.][0-9]{1,3}|jdbc:(postgresql|mysql|oracle):.*(192[.]168[.]|10[.]|172[.])|TEST_[A-Z0-9_]*PASS[W]ORD=['"'"'"]?(develop|password|root|admin|changeme)['"'"'"]?($|[[:space:]])|/Users/[A-Za-z0-9._/-]*ojdbc'
```

Expected result: no output. If the command reports a tracked file, replace real endpoints, passwords, private JDBC URLs, local `ojdbc` paths, or accidental `.env` references with placeholders before pushing.
