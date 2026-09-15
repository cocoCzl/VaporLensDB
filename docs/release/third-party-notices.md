# Third-party notices and SBOM process

This is the reproducible preparation process for a future formal VaporLensDB
binary release. It does not create a final notice file or claim that any local
QA artifact is distributable.

## Inputs and current automation

- Rust dependency resolution is locked in `src-tauri/Cargo.lock`.
- JavaScript dependency resolution is locked in `pnpm-lock.yaml`.
- The repository license is `LICENSE`.
- `.github/workflows/security.yml` already runs Anchore's `sbom-action` against
  the repository and uploads an SPDX JSON artifact named
  `vaporlensdb-sbom` for 30 days.

## Formal-release procedure

1. At the approved release commit, run the existing SBOM workflow or its
   equivalent against that exact commit and retain the generated SPDX JSON in
   the immutable release staging record. Do not rely on a short-lived CI
   artifact as the only retained copy.
2. Review direct runtime dependencies from both lockfiles, including Tauri and
   its plugins, Rust database drivers, bundled SQLite, React, Monaco, and the
   JDBC bridge build dependencies. Identify each dependency whose license
   requires attribution, notice text, source offer, or other distribution work.
3. Generate and curate a human-readable `THIRD_PARTY_NOTICES` file from that
   review. Preserve exact upstream license texts where their licenses require
   them; do not treat a raw SBOM as a substitute for attribution.
4. Review the final notices and SPDX JSON as release inputs alongside the
   package manifests and checksums. Record reviewer and release commit.
5. Ship `THIRD_PARTY_NOTICES`, the retained SPDX JSON, and the project
   `LICENSE` with the formal binary release (inside the installer/app resource
   or alongside every downloadable installer, according to the final packaging
   decision).

Oracle and custom JDBC vendor JARs are user-provided and are not bundled by
VaporLensDB. Their licenses remain the user's responsibility and must not be
silently represented as part of VaporLensDB's third-party distribution set.
