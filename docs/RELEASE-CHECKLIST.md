# VaporLensDB Release Candidate Checklist

Current distribution is source-first. This checklist retains historical QA
records and future release-engineering requirements; checked items do not mean
that public binary distribution is active. Developer ID signing, notarization,
GitHub binary Releases, and DMG uploads are deferred. Source users should follow
[INSTALL.md](INSTALL.md), without release credentials.

This checklist records release-candidate evidence without expanding the frozen
1.0 scope. It applies to explicitly marked pre-1.0 RC testing as well as later
1.0 candidates; an RC is not a stable release. `SUPPORT.md` is the canonical
capability matrix. Re-run an expensive or mutation-capable acceptance test only
when its affected implementation has changed.

## Source quality

- [x] `git diff --check`
- [x] `pnpm test`
- [x] `pnpm lint`
- [x] `pnpm build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [x] `./build.sh check` (the repository's complete deterministic gate)

## Tier-A database evidence

- [x] PostgreSQL native production `import_csv_rows`: parameter binding,
  multi-batch, constraint fallback, transaction behavior, SQL-looking payload,
  cleanup, and the 321-column parameter-budget case passed in disposable QA.
- [x] MySQL native production `import_csv_rows`: parameter binding, multi-batch,
  constraint fallback, transaction behavior, SQL-looking payload, and cleanup
  passed in disposable QA using the default SQL mode.
- [x] SQLite deterministic behavioral acceptance covers parameterized import,
  special values, NULL/empty-string distinction, SQL-looking payload, batch
  boundaries, transactions, cancellation, and reporting.
- [x] PostgreSQL/MySQL mutation acceptance retained the two-part safety gate:
  `VAPORLENSDB_QA_ENVIRONMENT=1` plus the in-database disposable-QA marker.

These results apply only to the Tier-A native PostgreSQL, MySQL, and SQLite
paths. They do not promote SQL Server or JDBC CSV import into the 1.0 scope.

## Desktop acceptance evidence

- [x] Query execution and native PostgreSQL cancellation.
- [x] Manual transaction commit/rollback and failed-transaction close behavior.
- [x] Dirty-draft close protection, application Quit, and persisted-draft
  restore after forced termination.
- [x] Current retained-result export and single-statement full-query re-execute
  export, including temporary-file cleanup.
- [x] Tier-A CSV import workflows and independently cancellable CSV Preview.

The recorded desktop evidence is macOS-only. Windows and Linux desktop runtime
remain **NOT EXECUTED** and must not be inferred from successful package builds.

## Security and privacy

- [x] Credential-store claims match the platform evidence in `SUPPORT.md`.
- [x] Sensitive-information scan and log/URL/password redaction checks pass.
- [x] TLS documentation does not exceed the verified driver modes and platform
  evidence.
- [x] Disposable database mutation tests retain their environment and marker
  gates.
- [x] Export/import temporary files and QA fixture objects are cleaned up.
- [x] Tier-A CSV values remain protocol parameters in batch and fallback paths.

## Packaging

- [x] `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` use the same formally approved version.
- [x] Application name `VaporLensDB` and bundle identifier
  `com.vaporlens.db` are correct.
- [x] Icons, frontend assets, the project JDBC bridge, and required resources
  are present in each package.
- [x] The current-platform release build and installer staging complete, with
  expected artifact names and SHA-256 output.
- [ ] Upgrade behavior is checked for the formally approved release version.
- [x] Signing/notarization status is described accurately; an ad hoc or unsigned
  QA artifact is never presented as signed or notarized.

Current sources are version `0.9.1`. Change every version source together only
after a release version is formally approved. Windows/Linux runtime evidence
and formal signing/notarization are separate release decisions, not implicit
PASS items in this checklist.

The synchronized current-version locations are `package.json`,
`src-tauri/Cargo.toml`, the root package entry in `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json`, `src-tauri/Info.dev.plist`, the README files,
installation/testing documentation, and `CHANGELOG.md`. Runtime/About uses
Cargo's package version. Packaging fixture tests also contain the current
version in expected artifact names. Update them together only after release
approval; `build.sh` rejects a mismatch among the three primary sources.

## Historical 0.9.1 RC distribution plan — deferred

The earlier plan below is retained for reference, not current publication
authorization. Any future binary release requires a new explicit decision.

- Application version remains `0.9.1`; the planned RC tag is `v0.9.1-rc.1`.
- GitHub distribution must be marked **Pre-release** and described as RC testing,
  never stable or production-ready.
- Platform scope is macOS arm64 only. Windows and Linux remain **NOT EXECUTED**
  and must not have assets attached to this RC.
- Assets are exactly `VaporLensDB.dmg` and `SHA256SUMS.txt`; raw App directories,
  build trees, vendor JDBC JARs, local configuration, credentials, logs, and
  internal review documents are excluded.
- The macOS App is ad hoc signed and not Apple notarized. Release notes must
  warn that Gatekeeper may block or warn about the internet-downloaded artifact
  and must not provide an automated security bypass.
- Stable 1.0 still requires its own release gate; this RC does not satisfy it.

## Historical local-build audit record

On 2026-09-28, `./build.sh current` passed both in the working candidate and in
an isolated source snapshot created without `.env`, pre-existing dependencies,
build outputs, QA credentials, or vendor JDBC JARs. Lockfile installation,
deterministic checks, macOS arm64 release compilation, App/DMG creation,
resource embedding, staging, and SHA-256 verification all passed. The generated
App is ad hoc signed and not notarized. Upgrade behavior remains pending the
formal 1.0 version decision.

On 2026-09-29, the macOS packaging lifecycle fix passed `./build.sh check` and
two consecutive `./build.sh current` runs. The staged App, DMG, and checksum
were complete, the raw App was removed, and LaunchServices retained exactly the
canonical QA and Dev identities.
