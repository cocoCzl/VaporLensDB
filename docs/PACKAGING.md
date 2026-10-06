# Packaging and Publishing

[简体中文](PACKAGING.zh-CN.md) · [Back to README](../README.md)

Current development distribution is **source-first**. Build packages on their
target operating system for local use. Public binary releases and DMG uploads,
Developer ID signing, and notarization are deferred. The RC/upload/formal-release
sections below are retained engineering procedures, not the current installation
path or authorization to publish. Start with [INSTALL.md](INSTALL.md).

Do not commit installers or checksums or attach them to pull requests. Local QA
artifacts must not be uploaded directly to a GitHub Release. The manually
triggered packaging workflow retains its Actions artifacts for seven days.

## Quick start

On macOS, run:

```bash
./build.sh current
```

The canonical local QA artifacts on Apple Silicon are:

```text
artifacts/macos/aarch64/
├── VaporLensDB.app
├── VaporLensDB.dmg
└── SHA256SUMS.txt
```

The accepted fresh-clone/package path is Apple Silicon macOS. The Intel target
stages under `artifacts/macos/x86_64/`, but Intel runtime/package acceptance is
not established by that evidence. Verify the local DMG checksum with:

```bash
cd artifacts/macos/aarch64
shasum -a 256 -c SHA256SUMS.txt
```

The expected result is `VaporLensDB.dmg: OK`. Windows and Linux stage their
fixed-name QA artifacts under `artifacts/windows/<architecture>/` and
`artifacts/linux/<architecture>/` respectively.

Use `artifacts/` for day-to-day QA and release staging. Do not select files for
publication from `target/`: `src-tauri/target/` is Cargo/Tauri's build
workspace, while `artifacts/` is VaporLensDB's canonical, curated staging
directory.

## Local QA Packaging

Use local packaging to validate target-platform behavior during development.
Do not present its DMG, MSI, NSIS, AppImage, DEB, or RPM output as publicly
available software. Public RC artifacts require the separate approved process
below.

## Artifact classes

- **Local QA artifact:** produced by `./build.sh current` for local testing. It
  is not public merely because the build succeeded.
- **GitHub Pre-release / RC artifact:** produced from the approved release
  commit after the tag plan, clean build, platform evidence, and checksum have
  been verified. GitHub must mark it as a Pre-release.
- **Stable release:** requires a separate stable-release gate. An RC is never
  described as stable or production-ready.

## Prerequisites

Use the [toolchain policy](INSTALL.md#toolchain-policy): a current Node 22.x patch
(at least 22.22.2) or 24.x patch (at least 24.15.0) following locked test dependency
requirements, pnpm 10, current stable Rust with rustfmt/clippy, and JDK 21 for the
project-owned JDBC bridge. The documented choices are not a promise of a fully
tested compatibility range. Vendor JDBC JARs are not build prerequisites.

The verified Apple Silicon source build needs no full Xcode, Apple Developer
Program membership, Developer ID certificate, or notarization credentials.

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
- `./build.sh live-tests --mysql --oracle`: explicitly run selected live JDBC integrations.
- `VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1 ./build.sh destructive-live-tests --mysql`: explicitly run CREATE/DROP DATABASE tests against a disposable environment.
- `./build.sh jdbc-bridge`: build only the Java JDBC bridge.

Validation and packaging commands are deterministic and never load `.env` or
run external database tests. Live database coverage is selected explicitly and
is documented in the [testing guide](TESTING.md).

Every packaging target first builds VaporLensDB's own JDBC bridge and embeds it
as an application resource. Oracle and custom JDBC vendor drivers remain local,
user-selected JARs and are never copied into an installer.

## Verify before local QA packaging

Run this on each build machine before creating installation artifacts:

```bash
./build.sh check
```

It builds the JDBC bridge, runs frontend lint and build, then runs Rust clippy
with warnings denied and deterministic Rust tests. It never loads `.env` or runs
external database tests; invoke the selected live profile explicitly.

## Build artifacts

### macOS

Run on macOS:

```bash
./build.sh mac
```

Artifacts:

```text
src-tauri/target/release/bundle/dmg/VaporLensDB.dmg
artifacts/macos/<architecture>/VaporLensDB.app
artifacts/macos/<architecture>/VaporLensDB.dmg
artifacts/macos/<architecture>/SHA256SUMS.txt
```

`dist/` contains Vite's generated frontend assets and is embedded into the App
by Tauri; it is not an installer directory and is recreated by `pnpm build`.
`src-tauri/target/` is Cargo/Tauri's raw build directory. During `./build.sh mac`
or `./build.sh current`, Tauri first creates
`src-tauri/target/release/bundle/macos/VaporLensDB.app` as a temporary packaging
intermediate. The script creates the DMG, copies the App and DMG into staging,
and writes the checksum before removing that raw App. A failed build may leave
the intermediate for `./build.sh clean-macos-app-index` to remove safely.
The raw DMG is retained at
`src-tauri/target/release/bundle/dmg/VaporLensDB.dmg`.

`artifacts/` is the Git-ignored local staging directory. Each successful build
replaces the current architecture directory, so it contains only the latest
App, DMG, and checksum. The staged App is the canonical local QA App and the
only long-lived `com.vaporlens.db` bundle registered with LaunchServices; this
prevents the raw intermediate and staged copy from appearing as duplicate apps.
A mounted DMG is temporary installation media, not a long-lived local identity.
Repeated successful `./build.sh current` runs therefore do not accumulate
ordinary VaporLensDB identities. Development remains a separate identity at
`src-tauri/target/debug/VaporLensDB-dev.app`.
An `.app` runs directly on macOS; a `.dmg` contains the App and an Applications
shortcut. During Pre-1.0 Development, both remain local QA artifacts.

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
`macos-latest`, Ubuntu 22.04, and `windows-latest`. It performs the same
validation and packaging steps without live database credentials, then retains
fixed-name test artifacts for seven days. It does not create a tag or GitHub
Release. Native `aarch64` packages still require a matching build machine.

## Pre-1.0 RC test distribution

A pre-1.0 RC may be published only after explicit approval:

1. Approve the release commit and determine the RC tag without changing the
   application version merely to add an RC suffix.
2. Check out the tag in a clean workspace, install locked dependencies, run the
   deterministic gate, and build the platform packages.
3. Publish only platforms backed by current runtime evidence. The release plan
   defines the supported platform and asset set for that candidate.
4. Verify artifact metadata and checksums before upload. Do not upload raw
   build directories, secrets, credentials, logs, vendor JDBC JARs, or internal
   review documents.
5. Create a GitHub Release marked **Pre-release** with its supported platforms,
   known limits, signing status, and checksum instructions.
6. Download the uploaded assets into a new directory and verify their checksums
   before making the Pre-release visible.

An RC is a test distribution, not a stable or production-ready release. The
historical proposal and its recorded evidence are retained in
[the deferred 0.9.1 RC 1 plan](release/0.9.1-rc.1.md); future candidates must
use their own release-specific plan rather than copying its tag or platform
scope into this general guide.

## Upload GitHub Release assets manually

Installers and checksums are release assets, not Git source files. In
particular, do not run `git add VaporLensDB.dmg` or commit generated packages.

For a manual GitHub upload:

1. Open **Releases** and choose **Draft a new release**.
2. Select the already approved tag and enter the release title and notes.
3. For an RC, enable **Set as a pre-release**; do not mark it as the latest
   stable release.
4. Upload only the assets named by the current release plan. A macOS RC commonly
   uses `VaporLensDB.dmg` and `SHA256SUMS.txt`.
5. Before publishing, download the uploaded assets into a new directory and
   verify them against the downloaded checksum manifest.

The `gh` CLI may be used as an optional equivalent when it is installed and
authenticated, but the release process does not depend on it.

## Stable distribution

Run this section only after a version is formally approved for stable release.
A prior RC Pre-release does not satisfy the stable-release gate.

1. Confirm `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
   use the same release version.
2. Build and validate each platform in the current stable support matrix. Every
   published platform requires current runtime evidence.
3. Collect only the asset set defined by the current release plan and
   `SUPPORT.md`. Include a macOS App bundle only when it is intentionally
   distributed outside the DMG.
4. Copy the approved installers into one release staging directory, then
   generate a checksum manifest for exactly those assets. For example, a
   macOS-only release can use:

   ```bash
   shasum -a 256 VaporLensDB.dmg > SHA256SUMS.txt
   ```

   Use the platform's SHA-256 tooling for other asset sets, and keep the
   manifest filenames identical to the uploaded asset filenames.

5. Update `CHANGELOG.md`, create the matching Git tag and a GitHub Release.
   Upload the installers and `SHA256SUMS.txt`, then describe the user-visible
   changes and known limits.
6. Download every uploaded asset from the draft release and verify its checksum
   before publishing the release.

Do not claim that an artifact is Developer ID signed or notarized until that
process is actually enabled and verified. The current candidate's concrete
signing and notarization status belongs in its release-specific plan; do not
infer it from a successful package build. Never add an automated Gatekeeper
bypass.

## macOS entitlement review for future signing

The release entitlement plist deliberately contains only
`com.apple.security.app-sandbox=false`. VaporLensDB is prepared for Developer
ID direct distribution, not the Mac App Store sandbox model: it needs
user-selected database files and JDBC JARs, arbitrary database endpoints,
local Java processes, and optional SSH integration. The prior
`allow-jit`, `allow-unsigned-executable-memory`, and
`disable-library-validation` exceptions were removed after controlled local
release-mode builds and runtime launch checks.

macOS packaging runs through `scripts/tauri-release-build.sh`, which derives
Rust source-path remapping from the active build machine. This keeps local
workspace, Cargo, and Rustup paths out of distributable executable strings;
use `pnpm build:release:macos` for the focused local `.app` check. That focused
command intentionally retains Tauri's raw App; only `./build.sh mac` and
`./build.sh current` consume it as a temporary packaging intermediate.

See [the macOS signing and notarization checklist](release/macos-signing.md)
for the formal-release procedure. Developer ID signing/notarization itself is
still not enabled by this repository configuration.
