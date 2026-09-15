# Install and First Use

[简体中文](INSTALL.zh-CN.md) · [Back to README](../README.md)

## Current pre-1.0 use: build from source

VaporLensDB 0.8.5 is in **Pre-1.0 Development** and is distributed as
**Source Build Only**. There is no official downloadable DMG, MSI, NSIS,
AppImage, DEB, or RPM before 1.0.0. To use the current project, clone it and
run:

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

## Future packaged releases and local QA packages

The following installer guidance is for future formal releases or a locally
created QA package. No production installer has been released yet. After a
formal release, download VaporLensDB only from the project's
[GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest) page.
Development and test installers are not published as GitHub Releases. A manual
packaging check may retain temporary GitHub Actions artifacts for seven days.
Each formal release provides a `SHA256SUMS.txt` file.
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

1. After a formal release, download the DMG that matches your Mac (Apple Silicon or Intel, when both
   are available).
2. Open the DMG and drag **VaporLensDB** to **Applications**.
3. Open VaporLensDB from Applications.

Open an installer only after verifying its SHA-256 and formal release source.
Do not bypass a warning for an unverified file.

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

Saved database and SSH passwords are encrypted with a key protected by an OS
credential store. Current verification is platform-specific:

- macOS Keychain credential restore is runtime verified.
- Windows DPAPI implementation is present; Windows runtime is **NOT EXECUTED**.
- Linux Secret Service / `secret-tool` implementation is present; Linux runtime
  is **NOT EXECUTED**. Linux needs `libsecret-tools` on Debian/Ubuntu; without
  an active Secret Service session, leave **Save password** disabled and enter
  the password for the current session.

`VAPORLENSDB_USE_DEV_KEY=1` enables a local development key and must not be used
for a normal installation. Existing development keys are migrated into the OS
credential store after a successful upgrade.

## Preferences and help

- Open **Settings** to switch between Chinese and English, and choose light,
  dark, or system theme.
- Use **Command+K** on macOS or **Ctrl+K** on Windows/Linux to open the command
  palette.
- Use **Diagnostics** in Settings when preparing support information; review
  the exported package before sharing it.
