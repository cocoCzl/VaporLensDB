# SQL-first 1.0 Scope

**Decision: Option A — SQL-first Developer Client. Scope locked; acceptance pending.**
This contract does not change version `0.9.1` or authorize a release.

VaporLensDB 1.0 is a SQL-first database client for developers, focused on reliable
querying, transactions, result inspection, schema exploration, and data exchange.

面向开发者的 SQL-first 数据库客户端，重点提供可靠的查询、事务、结果查看、结构探索
和数据交换工作流。

## Included

- **SQL:** multi-tab editor; Current / Selection / All; driver-capability-aware
  cancellation; Auto / Manual transactions; execution-context protection;
  multi-statement outcomes; SQL file Open / Save / Save As; query history.
- **Results:** read-only grid; duplicate-column handling; copy; bounded display
  and truncation warnings; result provenance; export within documented limits.
- **Metadata:** database/schema/table/view exploration; columns, PK/FK/index;
  vendor-limited DDL; metadata search/index. Object availability depends on driver
  and privileges; this is not cross-vendor metadata parity.
- **Connections:** supported native drivers; experimental JDBC/custom JARs;
  groups/favorites/recent; credential handling; SSH/TLS within verified capability.
- **Data exchange:** CSV preview/import/mapping and explicit empty/NULL semantics;
  CSV export; DBeaver connection import. Native CSV import is PG/MySQL/SQLite only.
- **Diagnostics/source-first:** privacy-aware diagnostics, source build, and
  documented validation/local packaging workflow.

## Excluded from 1.0

**Table Data Editing is not part of 1.0 scope:** inline cell editing, insert row
UI, delete row UI, and Apply/Revert mutations are a **post-1.0 major feature**.
They require an independent mutation, concurrency, and transaction safety model.
Read-only Table Data and SQL-authored writes remain supported workflows.

Also excluded: a full DBA suite, replication management, backup/restore GUI,
full cross-vendor DDL designer, schema diff/migration designer, advanced Oracle
DBA tooling, and full visual Explain across all vendors. These are scope
boundaries, not promises never to implement them.

## Support boundary

[SUPPORT.md](SUPPORT.md) is canonical for capabilities and evidence. Primary
Tier-A native workflows are PostgreSQL, MySQL, and SQLite on **macOS Apple
Silicon / arm64**. Tier-A does not mean the current pre-1.0 build is already
stable. Oracle/custom JDBC are experimental / best-effort; SQL Server is
implemented but not Tier-A. Optional JDBC routes do not inherit native Tier-A.

Intel macOS, Windows, and Linux have build targets, but runtime acceptance is
unverified. Support promotion needs new evidence; it is not a prerequisite for
this deliberately narrower source-first 1.0 scope.

## Remaining gates and deferred work

The bounded [acceptance record](V1-ACCEPTANCE.md) defines four MUST gates:
CSV failure privacy; trigger table scope/error semantics; latest native desktop
acceptance; and support/documentation alignment. It also records SHOULD items
and separates automated, desktop, and environment evidence.

Table Data Editing, Explain visualization, column hide/freeze, metadata batch
optimization, non-PG cancellation improvements, and broader vendor features
remain later work. Existing JDBC best-effort cancellation is not removed by
that deferral. New features do not become 1.0 gates merely by being useful.

Source-product acceptance and public binary readiness are separate decisions.
Developer ID signing, notarization, binary publication, and upgrade acceptance
for a future binary release stay under release engineering. A version bump
requires separate approval; this contract is not a 1.0 release announcement.
