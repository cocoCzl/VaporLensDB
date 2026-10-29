# Install and First Use

VaporLensDB 0.9.1 is under development. Build locally from source; local packages
are not official signed/notarized releases. Database and platform limits are
maintained in [SUPPORT](SUPPORT.md).

## Requirements

| Tool or host | Requirement |
| --- | --- |
| Node.js | Current 22.x patch at least 22.22.2, or 24.x patch at least 24.15.0, for the locked test dependencies; CI selects Node 22. |
| pnpm | pnpm 10, as used by CI. |
| Rust | Current stable Rust/cargo with rustfmt and clippy. No project MSRV is declared. |
| Java for source builds | JDK 21; `java`, `javac` and `jar` must resolve to it. |
| macOS | Xcode Command Line Tools; full Xcode and Apple signing credentials are not needed for local builds. |
| Windows | Git Bash, MSVC C++ Build Tools and WebView2. |
| Linux | WebKitGTK 4.1, GTK 3, AppIndicator, librsvg and OpenSSL development packages; `rpm` for RPM packaging. |

Install Git and follow the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for host-specific packages and the [pnpm installation instructions](https://pnpm.io/installation).
Build on the target OS; the build script does not cross-compile installers.
The Node versions above follow dependency requirements, not a guarantee for all
patches or platforms.

Source validation/packaging builds the project's JDBC bridge, so it needs a JDK
**even if you use only Native drivers**. An already packaged app needs no Java
for Native connections. JDBC needs a compatible Java runtime on PATH (Java 21+
for a bridge built with JDK 21) and vendor JARs; it does not need `javac` or `jar`
at runtime. The bridge build uses the selected JDK's bytecode level, without a
fixed `--release` target; building with a newer JDK can raise that runtime requirement.

## Build or run from source

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
./build.sh current
```

`current` validates and packages for the host OS. `mac`, `windows`, and `linux`
select that host explicitly; `./build.sh check` validates without packaging.
These commands do not load `.env`, access external databases or need vendor JARs.
If `node_modules` is absent the script installs locked dependencies; after an
update, explicitly run the install command to synchronize existing dependencies.

For development without packaging:

```bash
pnpm tauri dev             # Desktop app; no installer
pnpm dev                   # Frontend preview only; desktop IPC is unavailable
./build.sh jdbc-bridge     # Build bridge before using JDBC in development
```

`pnpm build` produces frontend assets only. `pnpm build:app` runs the local
package flow. See [testing](TESTING.md) for checks and isolated QA.

## Packages and launch

| Host | Local output directory | Files |
| --- | --- | --- |
| macOS | `artifacts/macos/<architecture>/` | `VaporLensDB.app`, `VaporLensDB.dmg`, `SHA256SUMS.txt` |
| Windows | `artifacts/windows/<architecture>/` | `VaporLensDB.msi`, `VaporLensDB-Setup.exe`, `SHA256SUMS.txt` |
| Linux | `artifacts/linux/<architecture>/` | `VaporLensDB.AppImage`, `VaporLensDB.deb`, `VaporLensDB.rpm`, `SHA256SUMS.txt` |

Architecture follows the Rust host (`aarch64` or `x86_64`). On Apple Silicon:

```bash
open artifacts/macos/aarch64/VaporLensDB.app
(cd artifacts/macos/aarch64 && shasum -a 256 -c SHA256SUMS.txt)
```

Alternatively, open the local DMG and drag the app to Applications. On Windows,
run one installer; on Linux, use the distribution's package installer or mark
the AppImage executable and launch it. Platform runtime verification is listed
in [SUPPORT](SUPPORT.md#platforms), separately from build targets.
`dist/` is frontend input, not an installer. Local macOS signing is ad hoc.
Maintainer signing and distribution procedures are in
[CONTRIBUTING](../CONTRIBUTING.md#packaging-and-release).

## First connection

1. Open **New Connection** and choose a database product.
2. Use the recommended Native driver, or select a JDBC definition and installed
   version. Add missing products/JARs in **Settings → Databases and drivers**.
3. Enter the required network, file or JDBC URL details and credentials.
4. Select **Test**, then **Save & Connect**. Missing JDBC installations may be
   saved for later repair, but cannot connect until configured.
5. Browse objects or open a SQL tab. Browsing another data source does not change
   that tab's execution target. Results are read-only; use SQL for writes.

The app bundles its bridge, not vendor JARs. Obtain JARs through an authorized
channel; see [driver management](DRIVER-MANAGEMENT.md) for installation versions,
network settings and configuration migration. JDBC heap defaults to 256 MB per
bridge; `VAPORLENSDB_JDBC_MAX_HEAP_MB` accepts 64–1024 MB.

## Credentials and configuration

Saved database passwords use macOS Keychain references, Windows DPAPI, or Linux
Secret Service. macOS reads are non-interactive; unavailable older credentials
must be entered and saved again rather than automatically migrated. Linux needs
an active Secret Service session and `secret-tool` (`libsecret-tools` on
Debian/Ubuntu); otherwise leave **Save password** disabled for session-only use.
Implementation and verification status are separate; see
[credential storage](SUPPORT.md#credentials).

Configuration normally uses `~/.vaporlensdb/config.db` on macOS/Linux and
`%APPDATA%/VaporLensDB/config.db` on Windows (with a user-profile fallback).
Keep its companion files, JARs and platform credentials when backing up; see
[backup and restore](DRIVER-MANAGEMENT.md#备份恢复与跨机器导入).
`VAPORLENSDB_CONFIG_DIR` and `VAPORLENSDB_USE_DEV_KEY=1` are QA/development options,
not normal installation settings. They do not isolate all OS/WebView storage.

## Troubleshooting

- **Build tool not found:** verify the tools above on PATH; on macOS install
  Command Line Tools. Check `java -version`, `javac -version` and `jar --version`
  use the intended JDK. Update dependencies with the lockfile after checkout changes.
- **JDBC cannot start:** check Java, the bundled/built bridge, selected class and
  complete ordered JAR set in the driver manager. A successful class-load check
  does not verify network access or database privileges.
- **Wrong build opens:** launch the exact staged app rather than a mounted DMG
  or older Applications copy. Developer and packaged identities differ; details
  are in [CONTRIBUTING](../CONTRIBUTING.md#build-identity).
- **Credential unavailable:** re-enter it; do not disable platform security or
  enable the development key for ordinary use.
- **Startup or layout issue:** use the [desktop checks and startup diagnostics](TESTING.md#desktop-manual-checks).
  Review diagnostics before sharing them under the [security policy](../SECURITY.md).
