# macOS signing and notarization checklist

This is the formal-release procedure for a future VaporLensDB version. It is a
checklist only: this document does not authorize signing, notarization,
publication, or a version change.

## Preconditions

- Confirm the exact release commit, version, changelog, support matrix, and
  final `THIRD_PARTY_NOTICES` / retained SPDX SBOM.
- Complete current macOS release-mode, Windows desktop, and Linux graphical
  desktop runtime acceptance on the intended release candidate.
- Use an Apple Developer account with a valid **Developer ID Application**
  certificate. Keep certificate exports, Apple ID credentials, app-specific
  passwords, and API keys outside the repository and CI logs.
- Start from [the minimal entitlement plist](../../src-tauri/gen/apple/Entitlements.plist).
  The direct-distribution model explicitly keeps `app-sandbox=false`; it does
  not use Mac App Store sandboxing because VaporLensDB needs user-selected
  database files/JARs, arbitrary database endpoints, local child processes,
  and optional SSH integration.

## Build and sign

1. Select the Developer ID Application signing identity in release-only build
   configuration. Do not change the development ad-hoc identity in a way that
   weakens local development.
2. Build the production frontend and macOS bundle from the release commit.
   Use the repository macOS release-build entry point so Rust source paths are
   remapped from the build machine to neutral prefixes before bundling.
3. Enable hardened runtime for the Developer ID artifact and pass the minimum
   entitlement plist explicitly to every nested executable that needs signing.
4. Create the intended distribution package (normally DMG; any PKG workflow
   must be documented separately).
5. Verify structure before notarization:

   ```bash
   codesign --display --verbose=4 VaporLensDB.app
   codesign --display --entitlements :- VaporLensDB.app
   codesign --verify --deep --strict --verbose=2 VaporLensDB.app
   ```

   Record the identity, Team ID, architecture, version, and effective
   entitlements. Do not treat ad-hoc signatures as Developer ID evidence.

## Notarize and staple

1. Submit the final archive with `notarytool` using a secure credential
   profile/API-key configuration outside source control.
2. Wait for completion and retain the notarization submission ID and result.
3. Staple the accepted ticket to the final distribution artifact.
4. Re-run signature verification and assess the artifact with Gatekeeper:

   ```bash
   spctl --assess --type execute --verbose=4 VaporLensDB.app
   ```

5. Preserve the notarization log with internal release evidence; redact any
   account metadata before external sharing.

## Fresh-install acceptance

On a clean or suitably isolated macOS user environment, download the exact
published candidate and verify:

1. first launch through Finder/Gatekeeper;
2. normal application and localized result-grid context menus;
3. no casual DevTools entry point in the production artifact;
4. macOS Keychain credential save, full quit, restart, and restore;
5. Tier-A MySQL, PostgreSQL, and SQLite connect → `SELECT 1` → disconnect;
6. a user-selected SQLite file and the existing local JDK/JDBC path;
7. upgrade/install behavior from the previous supported build.

Only after those checks, checksum the uploaded artifacts and publish the
release. Windows and Linux runtime acceptance remains separate and cannot be
substituted by this macOS procedure.
