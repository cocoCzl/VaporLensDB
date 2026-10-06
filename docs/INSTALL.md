# Install and First Use

[简体中文](INSTALL.zh-CN.md) · [Back to README](../README.md)

## Current distribution: source build

VaporLensDB 0.9.1 is in **Pre-1.0 Development**, not stable or production-ready.
Current distribution is **source-first**: clone and build locally. Public binary
releases, DMG uploads, Developer ID signing, and notarization are deferred.
Historical RC plans and future formal-release procedures are engineering
references, not the current installation path.

## Toolchain policy

Install Git and the following tools before building. Version labels distinguish
repository policy, dependency constraints, and observed results; they do not
promise compatibility with every version of a tool.

| Tool | Current policy and evidence |
| --- | --- |
| Node.js | CI is configured for Node 22. For a new setup, use a current 22.x patch at least 22.22.2, or a 24.x patch at least 24.15.0, to satisfy the locked test dependencies. No project-wide supported range is declared. |
| pnpm | Use pnpm 10, matching all current CI install jobs. The lockfile format is `9.0`; that alone does not select an exact pnpm patch or establish a minimum version. |
| Rust/cargo | Use current stable Rust with rustfmt and clippy, matching CI. The crate uses edition 2021 but declares no `rust-version`/MSRV. Edition alone does not establish the minimum compiler for the dependency graph. |
| JDK | Use JDK 21 for the project-owned JDBC bridge, matching CI and the documented build policy. Ensure `java`, `javac`, and `jar` resolve to that JDK. |

The local tools recorded during this audit were Node **24.11.1**, pnpm
**10.33.0**, Rust **1.94.1**, and JDK **21.0.9**. These are observed versions,
not exact pins. Frontend tests/build passed on that Node version, but it is below
jsdom's declared 24.x range; this is not a reason to recommend that older patch
for a new installation.
The fresh-clone local-package path has been accepted on Apple Silicon macOS;
CI configuration is not evidence of a completed desktop runtime test.

The locked Vite 8.2.2 declares Node `^20.19.0 || >=22.12.0`, while jsdom 30.0.1
used by tests declares `^22.22.2 || ^24.15.0 || >=26.0.0`. Thus “Node 22” without
a patch qualification is insufficient for the full gate. The recommendation
above follows dependency declarations; other Node majors have no project
compatibility commitment.

The repository intentionally retains the existing policy rather than adding
`packageManager`, `engines`, or `rust-toolchain.toml` in this phase. CI selects
pnpm's major explicitly; no authoritative exact pnpm patch has been adopted.
No verified project-wide Node/pnpm minimum or compiler incompatibility justifies
new enforcement. Install pnpm 10 using the
[pnpm installation instructions](https://pnpm.io/installation); this workflow
does not assume that Node bundles Corepack or require `corepack enable`.
`build.sh` checks required commands and retains its existing version behavior.

The bridge script invokes `javac` without `--release`, `-source`, or `-target`,
so emitted bytecode follows the selected JDK. JDK 21 remains the build policy,
not a newly proven Java language minimum. Lower JDK compatibility has not been
established; this phase does not change the Java target. When using JDBC data
sources, keep a compatible Java runtime available as well.

## Platform prerequisites and verification

| Platform | Native-host prerequisites | Verification |
| --- | --- | --- |
| macOS Apple Silicon / arm64 | Xcode Command Line Tools | Fresh-clone validation and local App/DMG build passed; Tier-A runtime verified |
| macOS Intel / x86_64 | Xcode Command Line Tools | Build target exists; current source-package/runtime acceptance does not cover Intel |
| Windows | Git Bash, MSVC C++ Build Tools, WebView2 | Build target exists; desktop runtime **NOT EXECUTED** |
| Linux | Tauri WebKitGTK/GTK development dependencies and `rpm` packaging tool | Build target exists; desktop runtime **NOT EXECUTED** |

Follow the host-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
and [packaging guide](PACKAGING.md). Build on the target OS; the script does not
cross-compile packages. The [support matrix](SUPPORT.md) is the canonical runtime
record. Linux credential persistence also needs an active Secret Service session.

The verified macOS source path needs **Xcode Command Line Tools**, not full
Xcode. It does not require Apple Developer Program membership, a Developer ID
certificate, notarization credentials, or a formal release-signing environment.
Local macOS builds use ad hoc signing; this is not Developer ID signing or
Apple notarization.

## Clone, validate, and build locally

From a terminal (Git Bash on Windows):

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
./build.sh check
./build.sh current
```

`check` validates without making an installer. `current` runs the deterministic
checks again and packages for the host OS; omit the separate `check` when only
a validated local package is wanted. Both commands build the project JDBC bridge
and therefore need the JDK even without JDBC data sources. Neither loads `.env`
or requires database credentials or vendor JDBC JARs.

If `node_modules` is missing, `build.sh` performs `pnpm install --frozen-lockfile`
automatically. The explicit install is still useful for an existing checkout,
because the script does not synchronize an already-present dependency directory.

## Local artifacts and launch

On Apple Silicon macOS:

```text
artifacts/macos/aarch64/VaporLensDB.app
artifacts/macos/aarch64/VaporLensDB.dmg
artifacts/macos/aarch64/SHA256SUMS.txt
```

Open the staged `.app` locally, or open your locally built DMG and drag
**VaporLensDB** to **Applications**. To verify the local DMG, from the repository
root run:

```bash
(cd artifacts/macos/aarch64 && shasum -a 256 -c SHA256SUMS.txt)
```

Intel macOS stages under `artifacts/macos/x86_64/`. Windows stages MSI/NSIS
installers under `artifacts/windows/<architecture>/`; Linux stages AppImage,
DEB, and RPM under `artifacts/linux/<architecture>/`, each with `SHA256SUMS.txt`.
These are **local build artifacts**, not current official downloadable releases.
`dist/` contains frontend assets; it is not the application installer directory.
See [PACKAGING.md](PACKAGING.md) for artifact details and separately scoped
future release procedures.

## Development without packaging

After installing dependencies, use either command as needed:

```bash
pnpm dev        # Frontend development server; desktop commands need Tauri
pnpm tauri dev  # Desktop development app, without creating a DMG
```

For JDBC in desktop development, run `./build.sh jdbc-bridge` first.
`pnpm build` builds frontend assets only. Daily development does not require
`./build.sh current`; run `./build.sh check` when validating changes.

## First connection

1. Select **New Connection**.
2. Choose PostgreSQL, MySQL, SQLite, SQL Server, Oracle, or a custom JDBC
   driver.
3. Enter the host, port, database, user, and authentication details requested
   by the selected driver.
4. Select **Test**. After a successful test, select **Save & Connect**.
5. Use the Object Tree to browse schemas and objects, or open a SQL tab to run
   a query.

The data grid is read-only. Copy values, rows, selected cells, or headers as
needed; edits must be made through SQL or your source system.

## Oracle and custom JDBC

Oracle and custom JDBC connections use a local JDBC driver JAR. VaporLensDB
includes its own open project bridge, but does not bundle proprietary database
driver files.

- For Oracle, obtain a compatible `ojdbc` JAR from Oracle through your approved
  licensing and distribution channel.
- In the connection dialog or **Settings → JDBC Drivers**, add the local JAR,
  confirm the driver class and JDBC URL, then test the connection.
- Keep driver JARs and database credentials out of this repository and out of
  public issue reports.

Each JDBC Data Source runs in a bounded JVM with a 256 MB maximum heap. For an
unusually large vendor driver, set `VAPORLENSDB_JDBC_MAX_HEAP_MB` before
starting VaporLensDB; accepted values are 64–1024.

## Saved credentials

Saved credentials use the platform credential-store backend. Current
verification is platform-specific:

- macOS stores each saved **database password** directly in Keychain and keeps
  only an opaque credential reference in its config database. Reads are
  non-interactive: normal use must never show a macOS Keychain authorization
  dialog. Older saved database credentials are intentionally not read or
  migrated; re-enter and save the database password once if one is unavailable.
  This behavior is **PASS / Accepted / Frozen** on the current macOS
  release-like QA artifact.
- Windows DPAPI implementation is present; Windows runtime is **NOT EXECUTED**.
- Linux Secret Service / `secret-tool` implementation is present; Linux runtime
  is **NOT EXECUTED**. Linux needs `libsecret-tools` on Debian/Ubuntu; without
  an active Secret Service session, leave **Save password** disabled and enter
  the password for the current session.

`VAPORLENSDB_USE_DEV_KEY=1` enables a local development key and must not be used
for a normal installation. Normal macOS operation never migrates or probes
older Keychain credential generations.

## Preferences and help

- Open **Settings** to switch between Chinese and English, and choose light,
  dark, or system theme.
- Use **Command+K** on macOS or **Ctrl+K** on Windows/Linux to open the command
  palette.
- Use **Diagnostics** in Settings when preparing support information; review
  the exported package before sharing it.
