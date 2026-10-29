# Support and Limitations

VaporLensDB 0.9.1 is under development. This page separates available
implementations from verification coverage. A build, capability flag or passing
unit test does not establish desktop or vendor compatibility.

## Product scope

The client focuses on SQL execution, Auto/Manual transactions, read-only result
inspection, schema exploration, SQL files/history, CSV exchange, connection
management and diagnostics. SQL-authored writes are supported; inline table
editing, insert/delete row UI and Apply/Revert are planned after 1.0.
A full DBA suite, replication/backup GUI, schema comparison/migration designer,
ODBC, advanced Oracle administration and full cross-vendor visual Explain are
outside the 1.0 scope. Plans in the [README](../README.md#plans) are not support promises.

## Database implementations

| Product | Native Rust | JDBC | Support scope |
| --- | --- | --- | --- |
| PostgreSQL | Implemented; recommended | Optional | Primary native support; JDBC remains driver-dependent |
| MySQL | Implemented; recommended | Optional | Primary native support; JDBC remains driver-dependent |
| SQLite | Implemented; recommended | Optional | Primary native support; file and memory semantics differ |
| SQL Server | Implemented | User-configured definition possible | Native runtime verification incomplete; no primary-support commitment |
| Oracle | No built-in native implementation | Built-in definition, user-supplied `ojdbc` | Experimental; Service connection/query probes do not verify SID or all Oracle capabilities |
| User-defined product | No arbitrary native plugin loader | User JAR/class/URL and optional metadata SQL | Experimental; validate the selected driver/server combination |

A stable product ID, definition and immutable JDBC installation identify each
connection. Custom products appear in the connection directory without adding a
vendor enum. Optional JDBC does not inherit native verification. See
[driver configuration and migration (Chinese)](DRIVER-MANAGEMENT.md).

## Platforms

| Platform | Build and desktop coverage |
| --- | --- |
| macOS Apple Silicon / arm64 | Local source packages and desktop workflows exercised; native PostgreSQL/MySQL/SQLite have runtime coverage, with feature-specific gaps below. |
| macOS Intel / x86_64 | Native build target exists; desktop runtime unverified. |
| Windows x86_64 | Platform implementation and package workflow exist; desktop runtime unverified. |
| Linux x86_64 | Platform implementation and package workflow exist; desktop runtime unverified. |

macOS coverage does not certify every subsequent build or workflow. Native
title-bar theme switching was observed working on the tested macOS build.
A brief blank before the HTML skeleton remains unresolved; capture did not
cover the original native first frame. Continuous window-edge resizing remains
unverified. Checks are in
[desktop checks](TESTING.md#desktop-manual-checks).

## Feature limits

| Feature | PostgreSQL native | MySQL native | SQLite native | JDBC | SQL Server native |
| --- | --- | --- | --- | --- | --- |
| Query cancellation | Native cancellation path | Not promised | Not promised | Bridge support; best-effort, vendor-dependent | Not promised |
| Auto/Manual transactions | Implemented | Implemented; server/engine rules apply | Implemented | Implemented; vendor transaction/recovery validation incomplete | Implemented; runtime unverified |
| Parameterized CSV import | Supported | Supported | Supported | Unsupported | Unsupported |
| Metadata and DDL | Vendor/type/privilege limits | Vendor/version/privilege limits | SQLite limits | Per-operation metadata SQL or JDBC metadata; advanced DDL requires templates | Implemented; runtime unverified |
| Explain | Result inspection | Result inspection | Result inspection | Oracle adapter implemented; no general custom-driver support | Implemented; runtime unverified |
| Table Structure triggers | Table-scoped catalog query | Table-scoped catalog query | SQLite catalog by table name | Table ownership unsupported | Unsupported |

Transactions require explicit Commit/Rollback in Manual mode. Execution-target,
session-generation and transaction guards prevent implicit target changes,
commits or SQL replay during recovery; a broken physical session is not a
successful transaction restoration. Driver-level implementation does not prove
vendor recovery semantics. CSV task cancellation is cooperative and separate
from interrupting an active database query.

Full-query export accepts one statement, not a multi-statement/multi-result
script. MySQL CLI `DELIMITER` directives and PostgreSQL exotic/multidimensional
types are outside current support. Metadata visibility depends on privileges;
unsupported, failed and successfully empty results must remain distinct.
Schema-level triggers do not imply table ownership or same-named trigger DDL
resolution. Explain inspection is not a full visual query-plan designer.

## JDBC and network limits

- Java, vendor JARs and privileges determine JDBC behavior. H2 bridge checks,
  SQLite JDBC application-command file/memory checks, and read-only
  MySQL/PostgreSQL/Oracle Service probes provide limited verification;
  mock IPC and these probes do not certify all vendors or desktop paths.
- Protocol chunks and `fetchSize` hints do not prove server cursors or bounded
  driver reads. JDBC reports `driverFetchStatus=unknown` and `fetchStrategy=hintOnly`;
  vendor-side bounded fetching and attributable peak JVM/WebView memory remain
  unverified. Do not estimate WebView RSS from unrelated WebKit processes.
- Unknown SQL dialects can execute user SQL, but automatic paging/import SQL
  is withheld. A dialect label does not grant another product's catalog adapter.
- Native PostgreSQL/MySQL TLS modes differ: encryption-only is not server identity
  verification. Trust stores and SSH hostname routing need mode-specific checks.
  SQL Server TLS trust-policy review and Integrated Authentication verification
  remain outstanding.
- JDBC standalone TLS settings without a supported mapping are rejected; use
  documented vendor URL/Properties settings. Unsupported raw-URL SSH formats
  and SSH combined with arbitrary JDBC Properties are explicitly rejected,
  rather than silently discarding security requirements.
- SSH integration is implemented for supported network configurations, but real
  SSH+JDBC authentication/routing combinations remain unverified.
- Oracle SID needs a real SID listener; external vendor write/transaction/recovery
  suites need an explicitly authorized disposable database. Ordinary endpoint
  access does not authorize fixture writes. See [live tests](TESTING.md#live-database-tests).
- SQLite private memory lives with its physical session. Named shared-cache
  memory cannot share state across independent bridge JVMs. Saved-file
  disappearance is an error, not permission to recreate the file on reconnect.

## Credentials

macOS stores database passwords directly in Keychain under opaque references;
reads skip authentication UI. Older credential generations require password
re-entry rather than automatic probing/migration. Windows DPAPI and Linux
Secret Service/`secret-tool` are implemented, with desktop runtime unverified.
Linux needs an active Secret Service session. QA config-directory isolation does
not by itself isolate system credentials or WebView storage; see
[application profiles](TESTING.md#application-profiles).

## CSV failure privacy

CSV import reports counts and bounded row numbers/sanitized errors without
retaining failed source values in failure DTOs. The intentional preview remains
available. Imports do not automatically create failure sidecars. Older
`<CSV path>.import-report.json` files may contain row values; current imports
neither delete nor overwrite them, and diagnostics does not collect them.
Users decide whether to retain those files. Exporting failed row values is not
implemented.
