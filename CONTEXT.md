# VaporLensDB Context

VaporLensDB is a lightweight desktop database IDE built with Tauri 2, Rust, and
React. The product goal is a fast, practical inspection and SQL workflow for
common database work without becoming a heavy all-purpose administration suite.

## Product Shape

- Data Sources manage saved connections and connection testing.
- The SQL workspace supports query editing, execution, result browsing, and
  cancellation where the driver supports it.
- The Object Tree is the primary navigation model for catalogs, schemas,
  tables, views, routines, indexes, and related metadata.
- Read-only inspection workflows include data preview, structure, DDL/source,
  Object Inspector, and ER Diagram views.
- Operational workflows include import/export tasks, query history, diagnostics
  export, DBeaver import, and SSH tunnels.

## Supported Connection Paths

- PostgreSQL, MySQL, SQLite, and SQL Server use native Rust driver paths.
- Oracle and custom JDBC use a lightweight Java JDBC bridge with user-provided
  driver JARs.
- ODBC is intentionally out of scope.

## Safety Boundaries

- Default CI and release checks must not require private databases or local
  proprietary driver JARs.
- Live integration tests stay ignored and manual.
- Diagnostics redact SQL text by default and never export result data or
  decrypted secrets.
- Dangerous SQL handling remains lightweight confirmation, not a full policy
  engine.
