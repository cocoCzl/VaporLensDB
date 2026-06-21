# Changelog

All notable changes to VaporLensDB are tracked here from the first public-ready
snapshot onward.

## 0.4.2

- Completed the v1 usable database IDE loop: Data Sources, SQL workspace,
  Sessions, Settings, Object Tree, read-only data preview, structure/DDL/source
  inspection, Object Inspector, ER Diagram, import/export tasks, query history,
  diagnostics, DBeaver import, and English/Chinese locale coverage.
- Added default release validation through `./build.sh check`, covering the
  JDBC bridge build, frontend lint/build, Rust clippy with warnings denied, and
  Rust tests.
- Added GitHub Actions CI for default clone-safe checks on pushes and pull
  requests to `main` and `master`.
- Documented private live database tests separately from default CI so real
  database endpoints, credentials, and local `ojdbc` paths stay out of tracked
  files.
