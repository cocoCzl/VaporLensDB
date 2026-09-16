# Current support status

This is VaporLensDB's canonical current-status matrix. “Implemented”,
automated tests, and runtime verification are independent facts. A package
build or static review is never evidence that an operating system has passed
desktop runtime QA.

## Database matrix

| Database | Implemented | Automated tests | macOS runtime | Windows runtime | Linux runtime | 1.0 support tier |
| --- | --- | --- | --- | --- | --- | --- |
| MySQL | Yes — native Rust driver; optional JDBC | Yes | L2 PASS / L3 PASS within claimed scope | **NOT EXECUTED** | **NOT EXECUTED** | Tier-A |
| PostgreSQL | Yes — native Rust driver; optional JDBC | Yes | L2 PASS / L3 PASS within claimed scope | **NOT EXECUTED** | **NOT EXECUTED** | Tier-A |
| SQLite | Yes — native Rust driver; optional JDBC | Yes | L2 PASS / L3 PASS within claimed scope | **NOT EXECUTED** | **NOT EXECUTED** | Tier-A |
| Oracle JDBC | Yes — user-provided `ojdbc` JAR | Limited, opt-in | Runtime evidence exists; not Tier-A accepted | **NOT EXECUTED** | **NOT EXECUTED** | Experimental / best-effort |
| Custom JDBC | Yes — user JAR, class, and URL | Basic coverage | Not Tier-A accepted | **NOT EXECUTED** | **NOT EXECUTED** | Experimental / best-effort |
| SQL Server | Yes — native driver | Source / driver-level coverage | **NOT EXECUTED** | **NOT EXECUTED** | **NOT EXECUTED** | Not advertised as Tier-A |

## Platform status

| Platform | Current evidence | Desktop runtime |
| --- | --- | --- |
| macOS arm64 | Current Tier-A runtime QA scope | Verified for MySQL, PostgreSQL, and SQLite only |
| Windows x86_64 | Platform code paths and package-build workflow | **NOT EXECUTED** |
| Linux x86_64 | Platform code paths, prerequisites, and package-build workflow | **NOT EXECUTED** |

## Credential storage status

- macOS Keychain: each saved database password is stored directly under an
  opaque datasource credential reference and read non-interactively; final
  zero-authorization-UI runtime acceptance is **PASS / Accepted / Frozen**.
  Older credential
  generations require database-password re-entry rather than Keychain migration.
- Windows DPAPI: implementation present; runtime **NOT EXECUTED**.
- Linux Secret Service / `secret-tool`: implementation present; runtime
  **NOT EXECUTED**.

## Scope limits

Oracle JDBC and Custom JDBC depend on the user-selected driver, server version,
JDK, privileges, and metadata behavior; neither receives a Tier-A promise.

SQL Server is implemented but is not an official 1.0 Tier-A target. Its TLS
trust policy requires a future review, and Windows Integrated Authentication is
not verified or promised for 1.0.

The Tier-A drivers currently use capability-aware query cancellation: MySQL and
SQLite do not promise cancellation, while PostgreSQL supports its native
cancellation path. This does not imply a generalized cancellation guarantee
for every driver.

## Pre-1.0 feature freeze

The macOS Tier-A product scope is frozen. Before 1.0, accepted behavior may
change only for P0/P1 correctness defects, data-loss/corruption risks, security
or credential/privacy defects, crashes/blank WebView failures, broken Tier-A
workflows, release-engineering blockers, or real Windows/Linux runtime blockers
when those hosts are available.

New features, new database capabilities, broad UX redesign, non-defect visual
polish, advanced grid editing, import/export expansion, schema compare,
monitoring, plugins, ODBC, SQL Server promotion, and Oracle Tier-A promotion
are deferred until after 1.0.

## Frozen macOS acceptance record

- Phase 14C.3: **PASS / Accepted / Frozen** — driver switching updates a
  system-generated datasource name, a user-entered name is preserved, and the
  datasource context menu provides a persisted display-name-only Rename action.
- Phase 14C: **PASS / Accepted / Frozen** — release-like Tier-A smoke,
  production DevTools policy, and the minimized macOS entitlement set passed.
