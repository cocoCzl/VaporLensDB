# VaporLensDB Technical Selection

## Core Stack

- Tauri 2 provides the desktop shell and IPC boundary while keeping the app
  lightweight.
- Rust owns database execution, metadata services, persistence, task management,
  diagnostics, and native driver integration.
- React, TypeScript, Vite, and Tailwind power the frontend IDE.
- pnpm is the package manager used by local development and CI.

## Database Driver Approach

- PostgreSQL uses `tokio-postgres`.
- MySQL uses `mysql_async`.
- SQLite uses `rusqlite` with bundled SQLite.
- SQL Server uses `tiberius`.
- Oracle and custom JDBC drivers use a small Java bridge so proprietary or
  user-selected JDBC JARs do not need to be committed.

## Build and Release Checks

`./build.sh check` is the local release gate. It builds the JDBC bridge, runs
frontend lint/build, runs Rust clippy with warnings denied, and runs Rust tests.

GitHub Actions mirrors the default clone-safe verification for pushes and pull
requests to `main` and `master`.

## Explicit Non-Goals

- Bundling proprietary Oracle JDBC artifacts.
- Requiring private live databases in default CI.
- Reintroducing ODBC support.
