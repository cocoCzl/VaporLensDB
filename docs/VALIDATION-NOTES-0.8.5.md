# VaporLensDB 0.8.5 Validation Notes

## Internal development / validation record

VaporLensDB 0.8.5 is in **Pre-1.0 Development** and is **Source Build Only**.
This document records validation evidence from development QA. It is not a
published release note, download announcement, or release candidate.

## Recorded validation checkpoint

- macOS Apple Silicon (arm64) local QA packaging was validated.
- MySQL native-driver connection, read-only query, disconnect, and reconnect
  were validated in the macOS app path.
- Oracle through the bundled JDBC bridge and a user-provided Oracle JDBC JAR
  was validated for connection, metadata, read-only query, disconnect, and
  reconnect in the macOS app path.
- Migration and workspace/data-grid/diagnostics validation were completed as
  part of the macOS checkpoint.

## Scope limits

- Windows and Linux have packaging/source-level validation only; runtime QA is
  pending.
- PostgreSQL packaged-app/runtime validation is pending.
- MySQL and Oracle are the databases with macOS arm64 app-runtime evidence;
  implemented drivers are not automatically runtime verified.
- Local App bundles and installers are QA artifacts only. They may be replaced
  by later development builds and must not be presented as public downloads.

## Historical QA fingerprint

The historical local QA DMG used during this checkpoint had this fingerprint:

| Artifact | SHA-256 |
| --- | --- |
| Historical local `VaporLensDB.dmg` | `37f319df689663bbf163d3fe4a41fc2297ab1b6aaf556b5ed3f190eb14ffb59c` |

This value identifies only that historical QA artifact. It is not a public
release checksum and must not be reused for later builds.

## Follow-up before 1.0

- Resolve Empty SQL Draft semantics and Disconnect Safety UX consistency.
- Complete Windows/Linux runtime QA and finalize the supported database matrix.
- Re-evaluate macOS entitlements during Developer ID signing/notarization
  preparation; current exceptions are not proven runtime requirements.
