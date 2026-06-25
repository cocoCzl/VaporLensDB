# VaporLensDB Context

VaporLensDB is a lightweight desktop database IDE built with Tauri 2, Rust, and
React. The product goal is a fast, practical inspection and SQL workflow for
common database work without becoming a heavy all-purpose administration suite.

Primary users are developers and data engineers who need to quickly connect to
databases, inspect structure, run SQL, browse results, and handle small
import/export tasks.

The first optimization target is time-to-first-task: opening the app, choosing a
connection, finding an object, running SQL, and reading results should require
few decisions, clicks, and waits.

## Product Shape

- VaporLensDB is optimized for macOS first while preserving room for portable
  desktop behavior.
- Core workflows are connection-and-object navigation, SQL execution and result
  browsing, and table inspection through data, structure, DDL/source, diagrams,
  and small import/export tasks.
- The left workspace should prioritize the Object Tree. Saved connections are
  selected through a compact Data Source switcher instead of occupying the main
  navigation area by default.
- Saved connections are primarily organized by environment or purpose, such as
  local, test, staging, production, or ungrouped. Database engine type is a
  secondary identifier.
- The default connection surface shows the current connection and a small set of
  recent or favorite connections. The full saved-connection list belongs in the
  Data Source switcher or management surface.
- Data Source switching and Data Source management are separate workflows:
  switching is a high-frequency workspace action, while creation, editing,
  import, driver setup, SSH, and advanced settings belong to a dedicated
  management surface.
- Production Data Sources need visible but restrained risk cues, such as a
  production badge, environment color, and stronger confirmation for dangerous
  SQL. Normal inspection and query work should not be interrupted by policy
  prompts.
- The Data Source switcher is search-first and may also show recent, favorite,
  and environment-grouped connections for browsing.
- After a Data Source connects, the Object Tree should land on the first useful
  business schema. Object collections such as tables and views remain lazy until
  the user expands or searches them.
- Selecting a table or view in the Object Tree should show a lightweight
  summary. Opening a data preview is an explicit action, such as double-click or
  a context-menu action.
- Object search is scoped to the current Data Source. Connection search belongs
  to the Data Source switcher.
- Opening a table or view data preview should query a small first page by
  default. The generated SQL, row limit, and cancellation affordance remain
  visible.
- Table data browsing is read-only. Editing table cells is outside the core
  product experience.
- Read-only grids prioritize copying values, rows, selected cells, and headers.
  Filtering and sorting come next; bulk export is lower frequency.
- The SQL workspace favors fast execution and clear context over advanced IDE
  intelligence. Context-aware completion, execution, cancellation, error
  feedback, results, and history are core; deep semantic refactoring is not.
- SQL tabs are bound to an explicit Data Source context and should not silently
  follow global Data Source selection.
- SQL tab titles should be automatically recognizable from their Data Source or
  SQL content, while still allowing manual renaming for long-lived work.
- Query history belongs to the SQL workspace as a contextual drawer or panel,
  not as a persistent left-sidebar section.
- The left rail should stay minimal. Explorer and Settings are persistent
  entries; SQL tabs, sessions, history, and tasks appear in contextual workspace
  or status surfaces.
- Background tasks and session activity are summarized in the status bar and
  expanded through a bottom drawer when needed.
- Import and export are contextual table or result-set actions, not a separate
  ETL-style module.
- Settings contain global preferences and diagnostics. Data Source creation,
  editing, driver setup, imports, SSH, and advanced connection options belong to
  Data Source management.
- ER Diagram and Object Inspector are read-only object inspection workflows.
  They are opened from object context and are not table-design or modeling
  surfaces.
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

- Near-term product work focuses on polishing existing database support rather
  than adding more database families.
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
