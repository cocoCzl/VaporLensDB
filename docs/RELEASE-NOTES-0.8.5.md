# VaporLensDB 0.8.5 Technical Preview

## Highlights

- Redesigned IDE workspace with Light, Dark, and System themes.
- SQL Workspace with connection-scoped tabs and query history.
- Read-only Data Grid, Row Inspector, and Value Viewer.
- Command Palette for workspace actions, data sources, cached objects, and recent queries.
- Improved connection-context reliability for SQL tabs and restored history.

## Verified Platform and Databases

- macOS Apple Silicon (arm64), installed from the DMG.
- MySQL native-driver connection, read-only query, disconnect, and reconnect.
- Oracle through the bundled JDBC bridge plus a user-provided Oracle JDBC JAR,
  including connection, metadata, read-only query, disconnect, and reconnect.

## Installation

Mount the supplied DMG and drag **VaporLensDB.app** to Applications. Check the
published SHA-256 checksum before opening the artifact.

This Technical Preview is ad-hoc signed. It is not Developer ID signed,
notarized, or stapled, so macOS Gatekeeper will not recognize it as a
notarized public release.

## Known Limitations

- Windows and Linux runtime verification is pending; their packages are not
  release-ready for this preview.
- PostgreSQL runtime verification is pending.
- Developer ID signing, notarization, and stapling are pending.
- Empty SQL Draft semantics and Disconnect Safety UX remain backlog items.
- Release DevTools policy must be explicitly resolved before a public
  Developer ID release.

## Checksums

The release announcement must include the SHA-256 calculated from the exact
DMG being distributed. Do not reuse a checksum from an earlier build.
