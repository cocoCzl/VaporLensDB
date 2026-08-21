# Packaging and Publishing

[简体中文](PACKAGING.zh-CN.md) · [Back to README](../README.md)

VaporLensDB packages must be built on their target operating system. This
repository does not currently automate releases, code signing, or macOS
notarization.

Until a formal version is approved for release, all installers are local or
temporary test artifacts. Do not commit installers or checksums, attach them to
pull requests, or publish them as GitHub Releases. The manually triggered
packaging workflow retains its Actions artifacts for seven days.

## Prerequisites

All build machines need:

- Node.js 22 and pnpm 10
- Rust stable
- JDK 21 for the JDBC bridge

macOS builds also need Xcode Command Line Tools. Windows builds also need
Microsoft C++ Build Tools with the MSVC toolchain, Microsoft Edge WebView2
Runtime, and Git Bash. Linux builds need the Tauri WebKitGTK and GTK development
packages and the `rpm` packaging command. Follow the current
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) if a platform
dependency is missing.

Install JavaScript dependencies once:

```bash
pnpm install --frozen-lockfile
```

## Build script commands

- `./build.sh` or `./build.sh current`: validate and package for the current platform.
- `./build.sh check`: run validation without creating an installer.
- `./build.sh mac`: validate, then replace the local macOS App and DMG artifacts.
- `./build.sh windows`: validate, then replace local MSI and NSIS artifacts on Windows.
- `./build.sh linux`: validate, then replace local AppImage, DEB, and RPM artifacts on Linux.
- `./build.sh live-tests`: run only configured real-database integration tests.
- `./build.sh jdbc-bridge`: build only the Java JDBC bridge.

The validation commands load an optional Git-ignored `.env`. With no database
configuration, live tests remain ignored. With complete database groups, the
matching tests run and any failure stops packaging. See the
[testing guide](TESTING.md) for configuration and database permissions.

Every packaging target first builds VaporLensDB's own JDBC bridge and embeds it
as an application resource. Oracle and custom JDBC vendor drivers remain local,
user-selected JARs and are never copied into an installer.

## Verify before packaging

Run this on each build machine before creating installation artifacts:

```bash
./build.sh check
```

It builds the JDBC bridge, runs frontend lint and build, then runs Rust clippy
with warnings denied and Rust tests. Configured live database tests are included;
unconfigured groups are reported as skipped.

## Build artifacts

### macOS

Run on macOS:

```bash
./build.sh mac
```

Artifacts:

```text
src-tauri/target/release/bundle/macos/VaporLensDB.app
src-tauri/target/release/bundle/dmg/VaporLensDB.dmg
artifacts/macos/<architecture>/VaporLensDB.app
artifacts/macos/<architecture>/VaporLensDB.dmg
artifacts/macos/<architecture>/SHA256SUMS.txt
```

`dist/` contains Vite's generated frontend assets and is embedded into the App
by Tauri; it is not an installer directory and is recreated by `pnpm build`.
`src-tauri/target/` is Cargo/Tauri's raw build directory. `artifacts/` is the
Git-ignored local staging directory. Each build replaces the current
architecture directory, so it contains only the latest App, DMG, and checksum.
An `.app` runs directly on macOS; a `.dmg` contains the App and an Applications
shortcut, so use the DMG for private test distribution.

`<architecture>` is `aarch64` on Apple Silicon and `x86_64` on Intel. The build
script validates that `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml` use the same version before packaging.

### Windows

Run from Git Bash:

```bash
./build.sh windows
```

From PowerShell, use `pnpm build:windows`; Git for Windows must make `bash.exe`
available on `PATH`.

Artifacts:

```text
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*.exe
artifacts/windows/<architecture>/VaporLensDB.msi
artifacts/windows/<architecture>/VaporLensDB-Setup.exe
artifacts/windows/<architecture>/SHA256SUMS.txt
```

### Linux

Install the distribution packages required by Tauri, including WebKitGTK 4.1,
GTK 3, AppIndicator, librsvg, OpenSSL development headers, and `rpm`. Then run:

```bash
./build.sh linux
```

Artifacts:

```text
src-tauri/target/release/bundle/appimage/*.AppImage
src-tauri/target/release/bundle/deb/*.deb
src-tauri/target/release/bundle/rpm/*.rpm
artifacts/linux/<architecture>/VaporLensDB.AppImage
artifacts/linux/<architecture>/VaporLensDB.deb
artifacts/linux/<architecture>/VaporLensDB.rpm
artifacts/linux/<architecture>/SHA256SUMS.txt
```

Windows and Linux use `x86_64` or `aarch64` according to the native Rust host;
the script does not cross-compile. As on macOS, each successful build replaces
only the current platform and architecture staging directory. Tauri's ignored
raw output can contain versioned names, while `artifacts/` always uses the fixed
names above.

`./build.sh current` and `pnpm build:app` select the documented native package
set for macOS, Windows, or Linux.

## Manual hosted packaging check

Run the **Package smoke test** workflow from the GitHub Actions page to build on
Ubuntu 22.04 and `windows-latest`. It performs the same validation and packaging
steps without live database credentials, then retains fixed-name test artifacts
for seven days. It does not create a tag or GitHub Release. Native `aarch64`
packages still require a matching build machine.

## Formal releases only: manual GitHub Release

Run this section only after a formal version is approved for release. Do not
perform its upload steps for test builds.

1. Confirm `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
   use the same release version.
2. Build and validate on macOS, Windows, and Linux using the commands above.
3. Collect the DMG, MSI, NSIS EXE, AppImage, DEB, and RPM. Include a macOS App
   bundle only when it is intentionally distributed outside the DMG.
4. Copy the installers into one release staging directory, then generate
   a checksum manifest there:

   ```bash
   # macOS (run after all release assets have been copied into this directory)
   shasum -a 256 VaporLensDB.dmg VaporLensDB.msi VaporLensDB-Setup.exe \
     VaporLensDB.AppImage VaporLensDB.deb VaporLensDB.rpm > SHA256SUMS.txt

   # Windows PowerShell (run after all release assets have been copied into this directory)
   Get-ChildItem VaporLensDB.dmg,VaporLensDB.msi,VaporLensDB-Setup.exe,`
       VaporLensDB.AppImage,VaporLensDB.deb,VaporLensDB.rpm |
     Get-FileHash -Algorithm SHA256 |
     ForEach-Object { '{0}  {1}' -f $_.Hash.ToLower(), $_.Path.Split('\\')[-1] } |
     Set-Content SHA256SUMS.txt
   ```

5. Update `CHANGELOG.md`, create the matching Git tag and a GitHub Release.
   Upload the installers and `SHA256SUMS.txt`, then describe the user-visible
   changes and known limits.
6. Download every uploaded asset from the draft release and verify its checksum
   before publishing the release.

Do not claim that an artifact is signed or notarized until that process is
actually enabled and verified.
