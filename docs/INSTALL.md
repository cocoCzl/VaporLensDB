# Install and First Use

[简体中文](INSTALL.zh-CN.md) · [Back to README](../README.md)

## Current pre-1.0 use: source builds and RC testing

VaporLensDB 0.9.1 is in **Pre-1.0 Development / RC testing**. It is not stable
or production-ready. Source builds remain available for development, and an
explicitly marked GitHub Pre-release may provide an RC test artifact for a
platform with recorded runtime evidence. To run from source:

```bash
pnpm install
pnpm tauri dev
```

For reproducible validation, use the lockfile before the deterministic gate:

```bash
pnpm install --frozen-lockfile
./build.sh check
```

Source builds require Node.js 22, pnpm 10, Rust stable, JDK 21, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the host
operating system. JDK 21 is required when JDBC drivers are used. See
[PACKAGING.md](PACKAGING.md) for platform prerequisites and local QA packaging.

## Platform build targets

| Platform | Build target / prerequisites | Runtime verification |
| --- | --- | --- |
| macOS | `./build.sh mac`; Xcode Command Line Tools | Tier-A verified |
| Windows | `./build.sh windows` on Windows/Git Bash; MSVC Build Tools and WebView2 | **NOT EXECUTED** |
| Linux | `./build.sh linux` on Linux; WebKitGTK/GTK/Tauri packaging packages | **NOT EXECUTED** |

Windows and Linux prerequisites and build targets are documented, but their
real desktop runtime validation is still pending. See [PACKAGING.md](PACKAGING.md)
for the exact native-host requirements. JDK 21 is required where JDBC is used;
Linux credential persistence additionally needs an active Secret Service session.

## Local QA, RC, and future stable packages

`./build.sh current` creates local QA artifacts; those files are not public
releases. An approved RC is published separately as a GitHub **Pre-release**
after a release commit, tag, clean build, and checksum verification. A stable
release requires its own release gate. Obtain any published package only from
the project's [GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases)
page and use the accompanying `SHA256SUMS.txt`.
Verify the downloaded installer before opening it:

```bash
# macOS
shasum -a 256 VaporLensDB.dmg

# Windows PowerShell
Get-FileHash .\VaporLensDB-* -Algorithm SHA256

# Linux
sha256sum VaporLensDB.AppImage VaporLensDB.deb VaporLensDB.rpm
```

Compare the resulting hash with the matching entry in `SHA256SUMS.txt`.

## macOS

1. For an RC test or future stable release, download only the DMG whose CPU
   architecture is explicitly listed by that release.
2. Open the DMG and drag **VaporLensDB** to **Applications**.
3. Open VaporLensDB from Applications.

The current 0.9.1 RC plan is macOS arm64 only. Its App is ad hoc signed and is
**not Apple notarized**, so Gatekeeper may warn about or block the downloaded
DMG/App. This is a known RC-testing limitation, not evidence of a Developer ID
signed release. Verify the SHA-256 and release source; do not disable Gatekeeper
or use an automated security-bypass script.

## Windows

1. After a formal release, download the `.msi` installer. Use the NSIS `.exe` installer if MSI is
   restricted by your environment.
2. Run the installer and follow its prompts.
3. Start **VaporLensDB** from the Start menu.

Verify the SHA-256 and that the file came from the project's formal GitHub
Release before installing it. Ask your administrator if software installation
is managed by your organization.

## Linux

- AppImage: run `chmod +x VaporLensDB.AppImage`, then start it with
  `./VaporLensDB.AppImage`.
- Debian/Ubuntu: install with `sudo apt install ./VaporLensDB.deb`.
- Fedora/RHEL: install with `sudo dnf install ./VaporLensDB.rpm`.

Choose the package matching the distribution and CPU architecture. Linux
packages depend on the platform WebKitGTK runtime; use the AppImage when a
system package is not appropriate.

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
