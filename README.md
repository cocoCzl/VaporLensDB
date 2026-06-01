# VaporLensDB

VaporLensDB is a Tauri + Rust + React database management tool. The project goal is a modern, lightweight desktop alternative to DBeaver.

## Current Phase

Phase 6 from `docs/VaporLensDB-Implementation-Plan.md` is now underway as a working baseline: runnable application shell, PostgreSQL/MySQL drivers, encrypted connection management, unified IPC error parsing, Toast notifications, database navigator metadata loading, SQL tabs, query execution, Explain, formatting, result display, streaming query results, multi-result switching, and initial metadata-backed SQL completion.

The editor performance pass is also complete: Monaco is explicitly lazy-loaded, SQL formatter is loaded on demand, Monaco AMD assets are served from `/monaco/vs`, and the copied Monaco static assets are reduced to the core editor, SQL/PGSQL language support, the default editor worker, and required nls files.

Next phase: harden Phase 6 SQL completion with better dialect awareness, alias-aware column suggestions, lazy metadata loading, and completion smoke tests.

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
src-tauri/target/release/bundle/dmg/VaporLensDB_0.1.0_aarch64.dmg
```

## Important Documents

- `docs/VaporLensDB-Design.md`: product and architecture design.
- `docs/VaporLensDB-Implementation-Plan.md`: phased AI/developer implementation plan.
