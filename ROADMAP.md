# VaporLensDB Roadmap

VaporLensDB is a SQL-first Developer Client. The [1.0 scope](docs/V1-SCOPE.md)
is locked; [acceptance gates](docs/V1-ACCEPTANCE.md) remain open. Roadmap ideas
are not additional 1.0 commitments.

## Before source-first 1.0 acceptance

- Close the bounded privacy, presentation-correctness, and support-contract gates.
- Verify the latest native workflows on macOS arm64 against the accepted checkpoint.
- Retain clone-safe build checks and accurately scoped driver/platform evidence.

## Post-1.0 major feature: Table Data Editing

Safe editable Table Data remains a high-value direction: inline cell editing,
insert/delete row UI, local pending changes, review, and Apply/Revert. It is
explicitly excluded from 1.0. It needs a separate parameterized mutation model,
row identity, optimistic concurrency, affected-row validation, writable-column
rules, and transaction safety design before implementation.

## Other future workflow improvements

- Richer Explain visualization, column hide/freeze, and metadata batch optimization.
- Broader cancellation and vendor capabilities after driver-specific acceptance.
- Schema comparison and migration SQL generation.
- Session, lock, and activity monitoring.
- A documented extension model for drivers and focused integrations.

## Separate distribution and support expansion

Signed/notarized installers, upgrade-safe binary distribution, and Windows/Linux
or Intel macOS support promotion require their own acceptance and approval.
Build targets alone do not establish runtime support. They are not prerequisites
for the current macOS arm64 source-first product scope.

Large DBA suites, silent proprietary-driver downloads, and an unrestricted
plugin runtime are not current priorities.
