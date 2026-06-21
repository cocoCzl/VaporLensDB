# Object Tree and IDE Workflow PRD

## Summary

The v1 Object Tree and IDE workflow provides a complete database inspection loop:
connect to a data source, browse objects, open focused workspaces, run SQL, and
inspect data or metadata without leaving the desktop app.

## User Goals

- Create and test database connections.
- Navigate database structure quickly through a lazy Object Tree.
- Run SQL and inspect paged results.
- Open table/view data previews, structure, DDL/source, Object Inspector, and ER
  Diagram workspaces.
- Export or import CSV data through background tasks with progress and
  cancellation.
- Review query history and export diagnostics without leaking secrets by
  default.

## Completed v1 Capabilities

- Data Sources, SQL workspace, Sessions, and Settings shell.
- Lazy Object Tree with catalog/schema linkage, search, keyboard navigation,
  system-object visibility, right-click actions, and quick table/view actions.
- Read-only Data tabs with pagination, filtering, sorting, generated SQL, and
  CSV export.
- Structure, DDL, Source, Object Inspector, and ER Diagram workspaces.
- Background task manager for import/export work.
- Query history, diagnostics export, DBeaver import, SSH tunnels, and complete
  English/Chinese locale key coverage for the main flows.

## Out of Scope

- ODBC support.
- Workspace/project isolation.
- A full configurable dangerous-SQL policy UI.
- Default CI execution against private live databases.
