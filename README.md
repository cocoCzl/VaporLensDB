# VaporLensDB

VaporLensDB is a Tauri + Rust + React database management tool. The project goal is a modern, lightweight desktop alternative to DBeaver.

## Current Phase

VaporLensDB has completed the v1 usable loop and post-v1 foundation Tasks 1-4. The current next task is the full driver manager, tracked in `docs/TASKS.md`.

PostgreSQL and MySQL use native Rust drivers. Oracle is experimental JDBC support: users provide `ojdbc` locally, and the current Oracle path only promises connection testing and basic SQL querying. SQLite, SQL Server, ODBC, custom JDBC, SSH tunnels, data editing, import/export, ER diagrams, and the full driver manager remain hidden or disabled until their task acceptance criteria are met.

The default shell intentionally exposes only Data Sources, SQL, and Settings. Query history is stored in `config.db`, result grids are read-only, and dangerous SQL requires confirmation before execution.

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

Run the v1 UI scope smoke test:

```bash
pnpm test:v1-ui-scope
```

Build the Rust backend:

```bash
cd src-tauri
cargo build
```

Validate and package the desktop app:

```bash
./build.sh check      # lint, frontend build, Rust tests
./build.sh mac        # macOS .app and .dmg
```

macOS artifacts are written to:

```text
src-tauri/target/release/bundle/macos/VaporLensDB.app
src-tauri/target/release/bundle/dmg/VaporLensDB_0.1.1_aarch64.dmg
```

## Important Documents

- `docs/VaporLensDB-Design.md`: product and architecture design.
- `docs/VaporLensDB-Technical-Selection.md`: technical selection rationale for Rust/Tauri, native drivers, JDBC sidecar, and ODBC.
- `docs/TASKS.md`: current progress, completed work, and remaining task checklist.
