# Contributing

VaporLensDB combines a React/TypeScript interface with Tauri commands and Rust
storage, sessions, metadata, query execution, diagnostics and tasks.

## Development

Follow [INSTALL](docs/INSTALL.md) for tools and platform prerequisites. Install
locked dependencies with `pnpm install --frozen-lockfile`, then use
`pnpm tauri dev` for desktop development or `pnpm dev` for frontend preview. Build the JDBC
bridge with `./build.sh jdbc-bridge` before JDBC development.

The author works directly on `master`; do not automatically create a branch,
PR or merge workflow. Preserve existing uncommitted changes. External
contributors can still submit GitHub PRs. No development command authorizes a
push, tag or publication.

## Verification and changes

Run checks appropriate to the change; `./build.sh check` is the complete local
validation entry. It builds/tests the bridge and runs secret scanning, frontend
lint/tests/build, workflow checks, artifact-staging tests, bundle budgets,
Rust formatting, warnings-denied clippy and deterministic Rust tests. It needs
no private database or vendor JAR. Documentation-only changes need the affected
documentation/workflow checks, not live databases or desktop packaging.
See [TESTING](docs/TESTING.md) for focused and explicit integration commands.
[CI](.github/workflows/ci.yml) runs checks on pushes/PRs to main/master.

Keep command contracts explicit, update documentation with behavior changes,
and keep generated artifacts and secrets out of commits. Review diagnostics
and diffs under the [security policy](SECURITY.md).

## Architecture

React/Vite/Tailwind render the shell; Tauri IPC joins the frontend to Rust.
Native PostgreSQL/MySQL/SQLite/SQL Server use
`tokio-postgres`/`mysql_async`/`rusqlite`/`tiberius`; JDBC uses the Java bridge
with user-supplied JARs. Product identity, driver definition and immutable
installation are separate. Browse context must not change a SQL tab's execution
target. Preserve lease/generation and transaction protection. Unknown dialects
must not invent automatic paging/import SQL.

## Packaging and release

### Build identity

`./build.sh current` validates and packages locally. Host prerequisites, output
formats and launch commands are in [INSTALL](docs/INSTALL.md#packages-and-launch).
Versions in package.json, Cargo.toml and tauri.conf.json must agree. Successful
staging replaces only the current OS/architecture directory.

On macOS the staged `artifacts/macos/<architecture>/VaporLensDB.app` is the
persistent `com.vaporlens.db` package identity. Development uses
`src-tauri/target/debug/VaporLensDB-dev.app` with `com.vaporlens.db.dev`.
Verify the actual executable path, version, binary hash and bundled bridge
before desktop QA; a mounted DMG is installation media, not the installed app.

`pnpm build:release:macos` builds a release-mode App without the complete check
suite or DMG. It uses `scripts/tauri-release-build.sh` and
`src-tauri/tauri.bundle.conf.json`; build the bridge first. The normal macOS
package flow removes the raw App only after DMG creation, staging and checksums
succeed; the raw DMG remains under `src-tauri/target/release/bundle/dmg/`.
`./build.sh clean-macos-app-index` removes only explicitly listed obsolete
project bundles and registrations, not Applications, user configuration or Keychain.
The manual [package workflow](.github/workflows/package-smoke.yml) retains
artifacts for seven days without publishing a release.

### Release configuration and signing

Development builds retain DevTools through Rust debug assertions. The direct
Tauri dependency excludes the `devtools` feature: Inspector APIs and shortcut
injection are not compiled into release artifacts. Do not enable them for
production. There is no DevTools menu; localized result-cell context menus remain.
Review `src-tauri/capabilities/default.json` against actual window, event,
dialog, clipboard-write and external-link use. An apparent core permission
cannot enable an uncompiled command. Check menus/Inspector shortcuts in the
exact package intended for distribution.

Local macOS builds use ad hoc signing (`-`), not Developer ID or notarization.
The release wrapper remaps workspace/Cargo/Rustup paths to neutral prefixes.
[Entitlements](src-tauri/gen/apple/Entitlements.plist) keep `app-sandbox=false`
for selected files/JARs, database endpoints, Java processes and SSH; the local
build does not require JIT, unsigned executable memory or disabled library validation.

A formal distribution requires a separate explicit publication decision:

1. Confirm the intended commit, version, changelog, supported platforms and
   [desktop checks](docs/TESTING.md#desktop-manual-checks).
2. Keep Developer ID Application/notarization credentials outside Git and logs.
   In release-only configuration choose that identity, enable hardened runtime
   and apply minimal entitlements to applicable nested executables. Build using
   the release wrapper and create the intended DMG.
3. Inspect and verify the final App (substitute its actual path):

   ```bash
   codesign --display --verbose=4 VaporLensDB.app
   codesign --display --entitlements :- VaporLensDB.app
   codesign --verify --deep --strict --verbose=2 VaporLensDB.app
   ```

4. Submit the final archive with `notarytool` using an external credential
   profile, retain the result and staple an accepted ticket. Recheck with
   `spctl --assess --type execute --verbose=4 VaporLensDB.app`.
5. Test downloaded Finder/Gatekeeper launch, credentials across restart,
   SQLite files, Native/JDBC connections and upgrade. Do not bypass Gatekeeper
   to claim compatibility. Resolve correctness blockers; state remaining limits.
6. Publish only approved platforms/assets with matching versions, notes and
   checksums; label an RC as a prerelease. Download and verify the checksums.
   Do not commit installers, logs, credentials or vendor JARs.

### Licenses and SBOM

Review [LICENSE](LICENSE), pnpm-lock.yaml and src-tauri/Cargo.lock for the exact
release. Include bundled SQLite, Tauri/plugins, React, Monaco and bridge/runtime
dependencies. Curate `THIRD_PARTY_NOTICES` with required license texts,
attribution and source offers; ship reviewed notices, SPDX JSON and the project
license with formal distributions. A raw SBOM does not replace license notices.
User-provided vendor JARs are excluded from project distribution; their licenses
remain the user's responsibility.

The [security workflow](.github/workflows/security.yml) generates SPDX JSON in
`vaporlensdb-sbom`, retained for 30 days. Preserve the exact release's SBOM
beyond that retention. Signing, packaging and an SBOM alone do not establish
runtime support; use [SUPPORT](docs/SUPPORT.md) for the stated coverage.
