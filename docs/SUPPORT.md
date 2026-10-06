# Current support status

This is VaporLensDB's canonical current-status matrix. “Implemented”,
automated tests, and runtime verification are independent facts. A package
build or static review is never evidence that an operating system has passed
desktop runtime QA.

Product positioning and exclusions are defined in [V1-SCOPE.md](V1-SCOPE.md);
open acceptance gates are tracked in [V1-ACCEPTANCE.md](V1-ACCEPTANCE.md). Tier-A
means the primary native support scope, not a declaration that pre-1.0 is stable.
Historical macOS evidence does not certify all later workflow changes.

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
| macOS Intel / x86_64 | Native source build target; current acceptance does not cover Intel | **NOT EXECUTED** |
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

Parameterized CSV import is a Tier-A native-driver capability for PostgreSQL,
MySQL, and SQLite only. SQL Server and all JDBC paths do not support
parameterized CSV import in 1.0. Full-query export accepts one SQL statement;
multi-statement, multi-result export is unsupported. MySQL CLI `DELIMITER`
directives and PostgreSQL exotic or multidimensional types are also outside the
1.0 support scope.

## Capability boundaries

Implementation flags are not evidence of equal vendor behavior or desktop QA.
Native Tier-A below means PostgreSQL/MySQL/SQLite, not their optional JDBC paths.

| Capability | PostgreSQL native | MySQL native | SQLite native | Oracle / custom JDBC | SQL Server native |
| --- | --- | --- | --- | --- | --- |
| Query cancellation | Native supported path | Not promised | Not promised | Advertised by bridge; best-effort, driver-dependent, not Tier-A | Not promised |
| Auto / Manual transactions | Supported | Supported; server/engine semantics apply | Supported | Implemented; driver-dependent | Implemented; runtime unverified |
| Metadata / DDL | Implemented within vendor/type/privilege limits | Implemented within vendor/version/privilege limits | Implemented within SQLite limits | Metadata SQL/driver-dependent; DDL capability follows configured templates | Implemented; runtime unverified |
| Explain | Supported result inspection | Supported result inspection | Supported result inspection | Oracle path implemented; custom not generally advertised | Implemented; runtime unverified |
| Generated / identity flags | Structured metadata where available | Structured metadata where available | Structured metadata where available | Driver/template-dependent; no parity promise | No Tier-A acceptance promise |
| Parameterized CSV import | Supported | Supported | Supported | Unsupported | Unsupported |
| TLS | Native policy; verification depends on selected mode | Native policy; verification depends on selected mode | Not applicable to local file | Vendor JAR/URL configuration; no universal guarantee | Trust policy review pending |
| SSH | Shared tunnel for supported network configuration | Shared tunnel for supported network configuration | Not applicable to local file | Configuration/URL-dependent; best-effort | Implementation does not establish runtime acceptance |

Explain result inspection is not full visual Explain. Metadata flags do not
imply editable grid support. CSV task/preview cancellation is a separate
cooperative lifecycle, not proof that a driver can interrupt an active query.
JDBC cancellation being advertised does not give it PostgreSQL's native
cancellation guarantee. Cancellation behavior is not uniform across vendors.

SSH uses the local SSH integration; a build or unit test does not establish
all OS/authentication/URL combinations. PostgreSQL/MySQL encryption-only TLS
modes must not be described as server identity verification. Verification modes,
trust stores, server configuration and SSH hostname routing require their own
evidence; no blanket SSH/TLS certification is made by this matrix.

## Pre-1.0 feature freeze

The SQL-first product scope is locked. Work before acceptance focuses on
confirmed correctness (including misleading metadata presentation), privacy,
support-contract defects, and the bounded gates in V1-ACCEPTANCE. P0/P1 defects
block acceptance; P2 issues require explicit disposition rather than silently
becoming enhancements. Existing historical acceptance remains evidence for its
recorded scope, not automatic approval of later changes.

Table Data Editing (inline edits, insert/delete row UI, Apply/Revert) is a
post-1.0 major feature. Broader import/export features, schema compare,
monitoring, plugins, ODBC, SQL Server promotion and Oracle Tier-A promotion
are deferred. Source-product acceptance does not require signing/notarization
or runtime support promotion for currently unverified platforms.

## Frozen macOS acceptance record

- Phase 14C.3: **PASS / Accepted / Frozen** — driver switching updates a
  system-generated datasource name, a user-entered name is preserved, and the
  datasource context menu provides a persisted display-name-only Rename action.
- Phase 14C: **PASS / Accepted / Frozen** — release-like Tier-A smoke,
  production DevTools policy, and the minimized macOS entitlement set passed.
