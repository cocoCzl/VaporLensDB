# Packaging and Publishing

[简体中文](PACKAGING.zh-CN.md) · [Back to README](../README.md)

VaporLensDB packages must be built on their target operating system. This
repository does not currently automate releases, code signing, or macOS
notarization.

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
src-tauri/target/release/bundle/dmg/*.dmg
```

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

Use `./build.sh current` only when a generic bundle for the current platform is
needed. It is not the release command because it does not fix the intended
installer formats.

## Manual GitHub Release

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
