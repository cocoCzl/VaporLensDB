# Packaging and Publishing

[简体中文](PACKAGING.zh-CN.md) · [Back to README](../README.md)

VaporLensDB packages must be built on their target operating system. This
repository does not currently automate releases, code signing, or macOS
notarization.

Until a formal version is approved for release, all installers are local or
privately shared test artifacts. Do not upload DMG, MSI, EXE, App bundles, or
checksums to the GitHub repository, pull requests, or GitHub Releases.

## Prerequisites

All build machines need:

- Node.js 22 and pnpm 10
- Rust stable
- JDK 21 for the JDBC bridge

macOS builds also need Xcode Command Line Tools. Windows builds also need
Microsoft C++ Build Tools with the MSVC toolchain and the Microsoft Edge
WebView2 Runtime. Follow the current [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
if a platform dependency is missing.

Install JavaScript dependencies once:

```bash
pnpm install --frozen-lockfile
```

## Verify before packaging

Run this on each build machine before creating installation artifacts:

```bash
./build.sh check
```

It builds the JDBC bridge, runs frontend lint and build, then runs Rust clippy
with warnings denied and Rust tests.

## Build artifacts

### macOS

Run on macOS:

```bash
./build.sh mac
```

Artifacts:

```text
src-tauri/target/release/bundle/macos/VaporLensDB.app
src-tauri/target/release/bundle/dmg/VaporLensDB_<version>_<architecture>.dmg
artifacts/macos/<architecture>/<version>/VaporLensDB.app
artifacts/macos/<architecture>/<version>/VaporLensDB_<version>_<architecture>.dmg
artifacts/macos/<architecture>/<version>/SHA256SUMS.txt
```

`dist/` contains Vite's generated frontend assets and is embedded into the App
by Tauri; it is not an installer directory and is recreated by `pnpm build`.
`src-tauri/target/` is Cargo/Tauri's raw build directory. `artifacts/` is the
Git-ignored, versioned local staging directory. An `.app` runs directly on
macOS; a `.dmg` contains the App and an Applications shortcut, so use the DMG
for private test distribution.

`<architecture>` is `aarch64` on Apple Silicon and `x86_64` on Intel. The build
script validates that `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml` use the same version before packaging.

### Windows

Run from a Windows Bash environment such as Git Bash:

```bash
./build.sh windows
```

Artifacts:

```text
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*.exe
```

`./build.sh current` and `pnpm build:app` use the macOS App+DMG flow on macOS,
the MSI+NSIS flow on Windows, and Tauri's native bundle flow on other platforms.

## Formal releases only: manual GitHub Release

Run this section only after a formal version is approved for release. Do not
perform its upload steps for test builds.

1. Confirm `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
   use the same release version.
2. Build and validate on macOS and Windows using the commands above.
3. Collect the DMG, MSI, and NSIS EXE. Include a macOS App bundle only when it
   is intentionally distributed outside the DMG.
4. Copy the DMG, MSI, and EXE into one release staging directory, then generate
   a checksum manifest there:

   ```bash
   # macOS (run after all release assets have been copied into this directory)
   shasum -a 256 VaporLensDB-*.dmg VaporLensDB-*.msi VaporLensDB-*.exe > SHA256SUMS.txt

   # Windows PowerShell (run after all release assets have been copied into this directory)
   Get-ChildItem VaporLensDB-*.dmg,VaporLensDB-*.msi,VaporLensDB-*.exe |
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
