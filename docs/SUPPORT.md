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

- macOS Keychain: implementation and credential restore runtime verified.
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
