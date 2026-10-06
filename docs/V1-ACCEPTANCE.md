# SQL-first 1.0 Acceptance Record

## Baseline and document audit

Phase 12A baseline: `0c4d42aade4a4d4230f7807fc1eb0f33e1c3d6c4`
(`feat: improve CSV import workflow`), version `0.9.1`, clean worktree/index.
This is a documentation-only scope decision, not new runtime acceptance.

Conflicts found before editing:

- README/design called the product a database IDE without the SQL-first scope.
- ROADMAP mixed implemented workflows and future editable data without a 1.0 boundary.
- README's Road to 1.0 coupled Windows/Linux QA and signing to product readiness.
- SUPPORT lacked Intel macOS status and a feature-level capability matrix; its
  freeze wording mixed product defects and deferred release engineering.
- Historical checked release items could be mistaken for acceptance of later
  SQL-file, execution-command/report, and CSV UI changes.

README (both languages), design, roadmap, support, install introductions, and
release checklist now refer to [V1-SCOPE.md](V1-SCOPE.md). CHANGELOG and
`docs/release/*` retain historical/future-release records, not current acceptance
claims. Historical version entries are not rewritten as new release notes.

## Gate categories

| Gate | Acceptance requirement | Current status |
| --- | --- | --- |
| Product scope | SQL-first included/excluded contract; no editing requirement | Locked |
| Correctness | No unresolved P0/P1; P2 findings explicitly dispositioned; privacy and misleading metadata below fixed | Open |
| Verified support | Evidence tied to driver, OS/architecture, checkpoint and workflow | Historical macOS arm64 evidence retained; latest desktop delta open |
| Documentation | README/SUPPORT/ROADMAP/install/release claims agree | Aligned in Phase 12A; preserve during fixes |
| Source build | Fresh clone, lockfile install, clone-safe checks and local package without private credentials | Historical macOS evidence retained; refresh when affected inputs change |
| Binary distribution | Approved version, signing/notarization, installer/upgrade acceptance and publication | Deferred, separate approval; not a source-product blocker |

## MUST before 1.0 (four gates)

1. **CSV failure privacy (implemented in Phase 12B, pending checkpoint acceptance):**
   automatic sidecar writing and row-value report fields have been removed.
   Default failure reporting may use only row number, sanitized error and safe
   metadata; no CSV values or absolute source paths in logs/diagnostics. Verify
   partial/full failure, cancellation and report-write behavior without changing
   import transaction or parameterization semantics. See the policy below.
2. **Trigger presentation correctness (closed by Phase 12C implementation and tests):**
   table Structure must show only triggers
   proven to belong to that table, or explicitly explain unavailable association.
   Schema-wide objects must not masquerade as table objects. Metadata failure
   must display an error/retry state, never successful “No triggers”. Verify two
   tables in one schema and a failed metadata request.
3. **Latest native desktop acceptance:** close the matrix below on macOS arm64
   with a checkpoint/build identity, scenario result and evidence. Automated
   tests cannot substitute for file-dialog, WebView, Quit and desktop behavior.
   Resolve environment-blocked deterministic tests on a suitable host; do not
   relabel sandbox failures as application success.
4. **Support/documentation contract:** maintain the aligned scope and capability
   matrix; confirm claims against the final acceptance checkpoint. Phase 12A
   closes the wording conflict, not outstanding runtime evidence. Unverified
   platforms remain unverified rather than becoming release blockers by default.

## CSV privacy audit and decision

Evidence: `src-tauri/src/commands/export.rs`, `import_csv_rows`, `RowReport`,
`ImportReport`, `csv_ui_report`; diagnostics: `src-tauri/src/commands/config.rs`,
`export_diagnostics_package`.

**Historical Phase 12A finding (before Phase 12B):** after the import loop and
final batch flush, if invalid-row or failed-write
count is nonzero and execution reaches report generation, the backend
**automatically wrote** `<input CSV path>.import-report.json` beside the input.
There was no separate user export action. It could overwrite a previous report.
Cancellation/early errors can exit before this write; not every failed import
creates a report. A successful import does not remove an older sidecar.

The JSON includes report path, table, total/inserted counts, invalid/failed
counts and omitted counts, plus bounded row reports containing row number,
message and `values`. Values can contain original or mapped business data.
Bounding the list does not remove the persistence risk. DB row errors pass
through the CSV error sanitizer, but sanitization of messages does not remove
the separately serialized values.

The new UI report deliberately clears `values`, bounds failures to 100 and
message length to 1000; normal completion notifications contain counts/table,
not rows. The diagnostics exporter constructs a package from config/history/
tasks and does not read or attach this sidecar. Ordinary result export does not
collect it either. This does not make the automatically written file private
from other software with access to its directory.

| Option | Privacy and workflow tradeoff | Decision |
| --- | --- | --- |
| A: keep automatic row-value JSON | Convenient retry data, but surprising sensitive-data persistence | Reject |
| B: no automatic row values; values only through explicit Export failed rows | Safe default; intentional export can support repair workflows | **Recommended policy** |
| C: no failure file, bounded in-memory report only | Smallest persistence surface; loses report after session ends | Acceptable initial implementation of the safe default |

Phase 12B policy: **CSV Failed-row Privacy**. Eliminate
implicit value persistence and prove UI/notification/log/diagnostic boundaries.
If a metadata-only failure file remains, sanitize it and exclude source paths
and row values. An explicit value export would require a user-selected path,
clear disclosure and separate bounded-data/retention design; shipping that new
feature is **not** required to close this gate. Do not silently delete existing
user sidecars. No backend changes were made in Phase 12A.

Phase 12B implements the no-file variant of the safe default: normal imports
create no sidecar, and row reports contain only row number and sanitized error.
Existing sidecars are untouched. Counts, bounded UI failures, and transaction/
cancellation behavior remain. Diagnostics has no sidecar reader or directory
scan. The bounded CSV preview still intentionally contains sample data. See
[SUPPORT.md](SUPPORT.md#csv-failure-privacy) for the user-facing privacy note.

## Trigger and Inspector audit

The trigger findings below record the Phase 12A baseline, before Phase 12C.

- `MainPanel.tsx` table Structure calls `loadSchemaObjects(connectionId, schema,
  'trigger')`, then stores the result without table filtering. The backend
  `get_schema_objects` command accepts schema/kind, not table. PostgreSQL's
  `pg_trigger` query filters schema only and returns no owning-table identity
  in `DbObjectInfo`. Other tables' triggers can therefore appear under the
  current table. Filtering by trigger name is not a safe fix.
- The same frontend call uses `.catch(() => [])`, disguising a failed request
  as an empty result. Both findings belong to MUST gate 2.

Phase 12C closes gate 2: the dedicated `get_table_triggers(schema, table)` native
queries restrict ownership in PostgreSQL/MySQL/SQLite, with no schema-wide
fallback or frontend name guessing. Other drivers return UnsupportedOperation.
Table Structure has independent loading/empty/data/unsupported/error states;
refresh clears stale data, and stale successes/errors cannot replace the current
request. SQLite cross-schema fixtures and frontend lifecycle/error tests verify
these contracts. Existing trigger definition behavior is unchanged. This does
not close the separate latest packaged-desktop acceptance gate.

PostgreSQL live two-table fixture passed. MySQL reached a successful empty
metadata query, but creating the fixture trigger was blocked by server error
1419 (binary logging / SUPER privilege); its UUID-owned tables were cleaned up.
MySQL populated-trigger live acceptance remains an environment validation gap;
no server privilege or global setting was changed to bypass it.

- `ObjectInspectorPanel.tsx` DDL Copy directly calls
  `navigator.clipboard?.writeText(ddl)` without the hardened clipboard helper
  or rejection feedback. This is a narrow SHOULD fix, not a claim that all
  previously hardened copy paths regressed.
- Generated/identity/default metadata is not fully shown in the Inspector.
  Under read-only positioning, clearer display is SHOULD, not a mutation-safety
  gate; writable filtering for existing CSV import remains mandatory.

## Native desktop acceptance delta

“Pending” means no checkpoint-specific packaged desktop evidence was established
by this audit. Earlier macOS acceptance in RELEASE-CHECKLIST remains historical.
Phase 11E automated results below were supplied in the accepted checkpoint
record; Phase 12A does not rerun application tests or claim new GUI acceptance.

| Workflow | Deterministic / integration evidence | Latest packaged desktop acceptance |
| --- | --- | --- |
| SQL Open / Save / Save As | Accepted SQL-file regression coverage | Pending native dialogs, overwrite and file identity |
| Dirty close / Quit; external modification | Regression coverage; earlier dirty-draft desktop QA exists | Pending file-backed close/Quit and external conflict choices |
| Execution target switching; Commit/Rollback and switch | Accepted session/transaction regression coverage | Pending correct context, refusal/prompt and backend state |
| Current / Selection / All | Accepted command regression coverage | Pending editor selection/cursor and execution target UX |
| Multi-statement partial failure | Accepted outcome/history/frontend regressions | Pending retained result tabs, summary and failure states |
| CSV picker / preview / mapping / import | 61 CSV/export Rust; 16 UI/hook; PG/MySQL production live PASS | Pending native picker, options, partial/full failure and cancel UX |
| Metadata progress / cancel | Accepted progress/cancellation regression coverage | Pending progress visibility and cancellation feedback |

The latest accepted frontend record is 49 suites / 501 tests; smoke 61/61.
Phase 11E full `./build.sh check` recorded Rust 367 passed, 12 localhost/socket
EPERM failures, 5 ignored. These are known sandbox restrictions, not desktop
acceptance and not a full PASS. Recheck affected socket tests outside that
restriction for final acceptance. Browser visual automation was not executed.
Windows/Linux desktop and Intel macOS runtime acceptance remain unverified;
no signing credentials are needed for current local macOS desktop QA.

## SHOULD before 1.0 (three items, not additional gates)

- Show generated/identity/auto-increment/default details in the Inspector.
- Route Inspector DDL Copy through the hardened clipboard helper with failure UX.
- Query history favorites for frequently reused SQL, if scope permits.

## Later

Table Data Editing; visual Explain; column hide/freeze; metadata batch
optimization; broader non-PG cancellation guarantees; broader vendor tooling.

## Acceptance status

- **Scope Locked: Yes.** Option A; editing excluded.
- **Product functionality ready: Not yet.** CSV privacy remediation is implemented
  pending checkpoint acceptance; trigger scope/error gate is closed by Phase 12C
  implementation and tests. Latest desktop acceptance remains open.
- **Environment validation remaining:** latest macOS arm64 native QA and the
  sandbox-blocked socket checks. Other OS runtime QA is required only before
  promoting their support claims. Future binary upgrade/signing QA is separate.
- No version bump, application change, new test, commit, tag or release is
  authorized by this document.
