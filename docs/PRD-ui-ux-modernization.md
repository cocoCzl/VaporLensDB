# VaporLensDB UI/UX Modernization PRD

## Background and Goals

VaporLensDB already provides the core workflow of a lightweight desktop database
IDE: users can manage Data Sources, browse an Object Tree, run SQL, inspect
results, preview data, review metadata, and manage supporting tasks. The current
interface is functional, but its visual hierarchy is too even. Repeated borders,
card-like workspace regions, duplicated Data Source prompts, dense toolbars, and
weak separation between primary and secondary actions make the application feel
closer to a web administration dashboard than a polished desktop IDE.

The modernization should combine the professional workspace structure and
operational efficiency associated with DataGrip-like database IDEs with a
lighter, more restrained visual identity. It must improve both appearance and
task completion rather than acting as a cosmetic theme replacement.

The goals are:

1. Reduce time-to-first-task when opening the application, choosing a Data
   Source, finding an object, opening SQL, and reading results.
2. Establish a clear visual hierarchy across landing states, the Object Tree,
   tabs, editors, result grids, dialogs, and status surfaces.
3. Make frequent actions obvious to newer users while preserving efficient
   keyboard, context-menu, and shortcut paths for experienced users.
4. Give VaporLensDB a restrained Professional Finish based on alignment,
   typography, spacing, semantic icons, and precise state feedback.
5. Keep the core workspace consistent on macOS and Windows while allowing
   operating-system surfaces and shortcut notation to follow platform
   conventions.
6. Preserve the product's lightweight, read-only inspection focus and avoid
   expanding the work into a heavy all-purpose database administration suite.

## Problem Statement

As a VaporLensDB user, I can complete core database inspection and SQL tasks,
but the interface does not consistently tell me what is most important or what I
should do next. When no Data Source is connected, recent SQL and recent Data
Sources compete for attention while the Object Tree repeats the disconnected
message. After connecting, the main area may continue presenting unrelated Data
Sources instead of orienting me to the current connection. During active work,
multiple boxed regions, repeated toolbar controls, crowded tab context, and
technical status information consume space without improving understanding.

The result is an interface that feels visually fragmented, exposes too many
controls at the same level, and does not yet match the speed or polish expected
from a professional desktop database IDE.

## Solution

Create a coherent Lightweight IDE Workspace with separate, context-aware states:

- A Connection-first Landing Workspace when no Data Source is connected.
- A Data Source Start Workspace after a Data Source connects and before a working
  tab is opened.
- A compact Continuous Work Surface for the Object Tree, SQL editors, object
  inspection tabs, and read-only result grids.

The redesign will reduce unnecessary borders and card containers, simplify
global chrome, establish a Semantic Icon Language, improve connection and query
feedback, and reorganize actions through Progressive Workspace Interaction.
Common actions remain visible; secondary and advanced actions move into context
menus, overflow menus, shortcuts, or dedicated management surfaces.

The visual reference is the information hierarchy and efficiency of a modern
database IDE, especially DataGrip-like object navigation and data grids, combined
with a lighter and more contemporary desktop visual treatment. The result must
retain VaporLensDB's own identity and must not imitate another product's skin.

## Functional Scope

### 1. Application Shell and Cross-platform Structure

- Keep a shared core workspace structure on macOS and Windows.
- Continue using the native system title bar instead of introducing a custom
  frameless title bar.
- Adapt system menus, window controls, and shortcut notation to each operating
  system.
- Remove or consolidate the persistent standalone Workbench heading when the
  same context is already available in the landing state, active tab, or SQL
  toolbar.
- Keep the top workspace chrome compact and avoid stacking multiple rows that
  repeat the same title, connection, or action information.
- Preserve a minimal left tool-window rail for Explorer and Settings.
- Reduce the visual weight and width of the left rail. The Explorer item toggles
  the Object Tree panel; Settings remains available at the bottom.

### 2. Connection-first Landing Workspace

- Show this state when no Data Source is connected and no working tab is active.
- Make choosing and connecting to a Data Source the primary task.
- Show a small set of recent or favorite saved Data Sources as direct connection
  targets.
- Allow a user to click a recent Data Source card or its explicit icon-and-text
  Connect action to start connecting.
- Provide clear access to create a new Data Source and open full Data Source
  management.
- Keep recent SQL available as secondary content rather than a competing primary
  panel.
- When a recent SQL item is selected, restore its tab and original Data Source
  binding without immediately creating a database connection.
- If the original Data Source no longer exists, open the SQL as unbound and
  prompt the user to select a Data Source.
- Use a utility-first composition with restrained VaporLensDB branding. Do not
  turn the landing state into a marketing page.
- Avoid exposing full connection URLs by default. Show the Data Source name,
  database type, connection state, and a simplified host/database summary.
- Never show credentials or secret-bearing fields on the landing state.

### 3. Data Source Start Workspace

- Show this state after a Data Source connects and before the user opens a SQL,
  data preview, structure, DDL/source, inspector, diagram, management, or settings
  tab.
- Do not represent this state as a permanent or closeable tab.
- Let it appear automatically whenever no working tab is open.
- Orient the user to the current Data Source with a primary New SQL action and a
  clear prompt to select an object from the Object Tree.
- Show recent SQL associated with the current Data Source where useful.
- Do not show a gallery of unrelated recent Data Sources after a connection is
  active.

### 4. Data Source Switching and Management

- Keep Data Source switching and Data Source management as separate workflows.
- Replace the visually heavy Data Source card above the Object Tree with a
  compact two-line switcher showing name, database type, connection state, and a
  disclosure control.
- Keep Connect or Disconnect available as an explicit high-frequency action.
- Move editing and lower-frequency actions into the switcher menu or the Data
  Source management workspace.
- Make the full switcher search-first.
- Support recent Data Sources, favorites, and optional user-defined Data Source
  Groups.
- Do not assign built-in development, testing, staging, or production semantics
  to groups or connections.
- Do not display persistent environment badges or environment colors.
- Keep dangerous-SQL confirmation general to all connections rather than tied to
  a production classification.
- Keep complete Data Source management in a workspace tab.
- Use focused dialogs for quick creation or editing, while advanced connection,
  driver, SSH, import, and management workflows remain in the management
  surface.

### 5. Object Tree and Left Workspace

- Preserve the Object Tree as the primary navigation model for catalogs,
  databases, schemas, tables, views, routines, indexes, and related metadata.
- Keep the Object Tree visible and useful after a Data Source connects.
- Keep a concise disconnected state in the same panel before connection without
  duplicating the entire landing page message.
- Allow the Object Tree panel to be resized, collapsed, and restored.
- Remember the user's most recent panel width and collapsed state.
- Use a narrower default width than the current wide fixed sidebar while
  retaining enough space for long object names.
- Automatically orient the tree to the first useful business schema.
- Keep system schemas hidden by default and available through the existing
  visibility control.
- Simplify low-value wrapper levels when doing so does not misrepresent database
  semantics. A single database or container may be visually de-emphasized rather
  than repeated as several equally prominent layers.
- Keep object category folders such as tables and views where they improve
  navigation and avoid mixing large object collections.
- Use dedicated compact database-object glyphs with stable restrained colors.
- Continue using a neutral shared icon family for general actions such as search,
  refresh, close, settings, and navigation.
- Keep single-click selection separate from expansion and default opening.
- Keep double-click as the default open action for tables, views, and supported
  objects.
- Show no more than one high-frequency inline action on row hover.
- Move secondary object actions into the context menu or selected-object detail
  surface.
- Keep keyboard navigation, search, refresh, copy-name, structure, DDL/source,
  data preview, and inspector workflows discoverable.

### 6. Workspace Tabs

- Keep tabs in a single row.
- Provide horizontal scrolling and an all-tabs list when tabs overflow.
- Keep the active tab visible when opening, closing, or switching tabs.
- Keep SQL tabs explicitly bound to a Data Source and never silently follow a
  global Data Source change.
- Use concise tab titles and reduce persistent bordered badges inside every tab.
- Use a small icon or color cue for context, while exposing the complete Data
  Source name through the SQL toolbar and tooltip.
- Do not display fixed environment badges.
- Show an unsaved or changed-state indicator for SQL drafts where applicable.
- Support middle-click close, close-other-tabs actions, and optional pinning for
  long-lived tabs.
- Keep manual tab renaming available.

### 7. SQL Workspace and Toolbar

- Preserve the existing SQL editing, completion, execution, cancellation,
  explain, history, and result workflows.
- Keep only high-frequency and safety-relevant context permanently visible:
  Execute, Cancel, current Data Source, current database/schema, row limit, and
  execution state.
- Move formatting, Explain, history, and other secondary actions into a clear
  overflow or contextual area when space is constrained.
- Keep the existing execute-selection-or-current-statement keyboard behavior.
- Display shortcut notation according to the operating system.
- Keep full connection context visible before execution without repeating it in
  multiple chrome layers.
- Show SQL errors in the result area associated with the executing tab.
- Keep query execution and cancellation non-blocking for other tabs and panels.

### 8. Read-only Data Grid

- Keep table previews and query results read-only.
- Adopt a DataGrip-like compact professional data-grid presentation without
  copying its theme.
- Use compact row height, compact headers, clear but restrained cell boundaries,
  and stable alignment by value type.
- Keep headers visible during vertical scrolling where technically appropriate.
- Provide a clear active cell, selected row, and selected range state.
- Present `NULL` values with a dedicated muted treatment that remains distinct
  from empty strings.
- Preserve copying of values, rows, selected cells, and headers.
- Preserve filtering, sorting, pagination, generated SQL visibility, and export
  actions according to existing product scope.
- Avoid strong zebra striping, card containers around the grid, and controls on
  every row.
- Keep result actions in a compact result toolbar.

### 9. Status, Feedback, and Loading

- Make feedback contextual wherever possible.
- Show Data Source connection failures on the related Data Source item or
  switcher state with a retry path.
- Show Object Tree loading and failure states on the relevant node or collection.
- Show SQL errors and execution state in the associated workspace.
- Use global notifications as summaries and navigation aids rather than the only
  error surface.
- Allow actionable notifications to navigate to the affected Data Source, tab,
  object, query, or task.
- Use local loading states and disable only the controls that cannot proceed.
- Avoid whole-application loading overlays after startup.
- Use the bottom status bar for current Data Source/database/schema context,
  active queries, sessions, tasks, and connection state.
- Hide routine backend health and version information when healthy; show it when
  abnormal or inside diagnostics/settings.
- Move theme switching out of the permanently visible status bar.

### 10. Visual System

- Use a Continuous Work Surface for the active IDE workspace, separated by
  subtle dividers and background levels rather than nested cards.
- Reserve cards, rounded elevated surfaces, and shadows for landing content,
  dialogs, menus, and temporary overlays.
- Retain blue as the main interaction and brand accent while reducing its total
  area.
- Use green only for connected or successful states, amber for warnings, and red
  for errors or dangerous actions.
- Keep normal icons, toolbars, dividers, and inactive surfaces neutral.
- Use short functional transitions for disclosure, selection, menus, connection
  state, and progress.
- Do not use decorative floating, bouncing, glassmorphism, or prominent gradient
  effects.
- Use Geist for the interface and a consistent bundled legible monospace font for
  SQL, DDL, and technical values.
- Maintain one balanced compact density for the first release rather than adding
  a compact/comfortable preference.

### 11. Themes, Localization, and Window Adaptation

- Apply the same hierarchy and component behavior to light and dark themes.
- Use the light theme as the primary visual review baseline while requiring dark
  theme parity before completion.
- Preserve runtime switching between Chinese and English.
- Ensure both languages use the same layout without fixed widths that only fit
  one locale.
- Keep the application usable at the existing 800x600 minimum window size.
- At small sizes or Windows high-DPI scaling, collapse or narrow the Object Tree,
  convert multi-column landing content to one column, replace secondary toolbar
  labels with accessible icons, and reduce status-bar content.
- Do not introduce application-level horizontal scrolling.

### 12. Progressive Workspace Interaction

- Keep common actions visible and understandable to first-time users.
- Keep advanced and lower-frequency actions available through context menus,
  overflow menus, shortcuts, and management workspaces.
- Preserve tooltip and accessible-label support for icon-only actions.
- Add a global searchable command entry in a later phase for actions such as New
  SQL, switch Data Source, open settings, show query history, and switch theme.
- Use `Command+K` on macOS and `Ctrl+K` on Windows unless platform conflicts or
  established application shortcuts require an alternative.

### 13. Delivery Phases

#### Phase 1: Shell and Primary Workflow

- Application shell and top chrome.
- Connection-first Landing Workspace.
- Data Source Start Workspace.
- Left tool-window rail, compact Data Source switcher, and resizable Object Tree.
- Workspace tabs and core Semantic Icon Language.
- Status-bar simplification.
- Light/dark, Chinese/English, and minimum-window behavior for these surfaces.

#### Phase 2: Working Surfaces and Advanced Efficiency

- SQL toolbar refinement.
- DataGrip-like read-only data-grid polish.
- Dialog, Data Source management, Settings, and supporting surface consistency.
- Global command entry.
- Remaining visual and interaction consistency across object inspection,
  diagrams, query history, sessions, and tasks.

## User Stories

1. As a developer opening VaporLensDB with no active connection, I want the
   interface to emphasize saved Data Sources, so that I can start work without
   deciding between equally prominent panels.
2. As a returning user, I want to connect by clicking a recent Data Source, so
   that resuming work takes one clear action.
3. As a user with many saved Data Sources, I want to search them immediately, so
   that I do not have to scan a long list.
4. As a user with frequently used Data Sources, I want recent and favorite items
   available first, so that common connections remain fast to access.
5. As a user who organizes many connections, I want optional custom groups, so
   that I can organize them without being forced into environment labels.
6. As a user running VaporLensDB in an isolated desktop environment, I do not
   want development, testing, staging, or production badges added automatically,
   so that irrelevant labels do not clutter the interface.
7. As a user connecting to a saved Data Source, I want immediate local progress
   and failure feedback, so that I know what the application is doing.
8. As a user viewing a recent Data Source, I want a concise host and database
   summary, so that I can identify it without exposing or reading a full URL.
9. As a security-conscious user, I want credentials excluded from landing and
   workspace surfaces, so that screenshots and screen sharing do not expose
   secrets.
10. As a user restoring recent SQL, I want its original Data Source context
    restored without automatically connecting, so that I can inspect the script
    before creating a session.
11. As a user whose original Data Source was deleted, I want a restored SQL tab
    to clearly show that it is unbound, so that I can deliberately choose a new
    Data Source.
12. As a user who just connected, I want a quick-start state focused on the
    current Data Source, so that unrelated connections do not distract me.
13. As a user who wants to write SQL, I want New SQL to be the primary connected
    quick-start action, so that I can begin querying immediately.
14. As a user who prefers object navigation, I want the connected quick-start
    state to direct me to the Object Tree, so that I can browse before opening a
    query.
15. As a user closing all working tabs, I want the Data Source Start Workspace to
    return automatically, so that I am not left with an empty unexplained canvas.
16. As a user navigating database metadata, I want the Object Tree to remain the
    primary left workspace, so that schemas, tables, views, and routines are
    always available after connection.
17. As a user on a smaller display, I want to resize or collapse the Object Tree,
    so that the editor and results can use more space.
18. As a returning user, I want the Object Tree width and collapsed state
    remembered, so that I do not reconfigure my workspace every launch.
19. As a user connecting to a database with many system schemas, I want system
    objects hidden by default, so that business schemas are easier to find.
20. As a user who needs system metadata, I want to reveal system objects through
    an explicit control, so that simplification does not remove access.
21. As a user opening a connection, I want the first useful business schema
    selected or emphasized, so that I reach relevant objects quickly.
22. As a user browsing Oracle or another deeply nested database, I want redundant
    wrapper levels visually de-emphasized when safe, so that common objects are
    not buried beneath unnecessary hierarchy.
23. As a user scanning a large Object Tree, I want stable, specialized icons for
    object types, so that I can distinguish tables, views, schemas, keys, and code
    objects quickly.
24. As a user learning the interface, I want general action icons to stay
    visually consistent, so that refresh, search, close, and settings remain
    predictable.
25. As a user moving the pointer through the Object Tree, I want minimal hover
    controls, so that rows do not constantly shift or fill with icons.
26. As an experienced user, I want full object actions in the context menu, so
    that a clean tree does not reduce capability.
27. As a keyboard user, I want Object Tree selection, expansion, search, refresh,
    and opening behavior to remain available from the keyboard, so that mouse use
    is optional.
28. As a user with many open workspaces, I want tabs to stay on one row with an
    overflow list, so that the editor does not lose vertical space.
29. As a user switching tabs, I want the active tab to remain visible, so that I
    always know where I am.
30. As a user running SQL against multiple Data Sources, I want every SQL tab to
    retain explicit Data Source binding, so that global switching does not change
    query context silently.
31. As a user scanning tabs, I want concise titles and restrained context cues,
    so that more tabs fit without hiding their meaning.
32. As a user with unfinished SQL, I want a changed-state indicator, so that I do
    not close useful work accidentally.
33. As an experienced desktop user, I want middle-click and close-other-tabs
    actions, so that tab cleanup is fast.
34. As a user with a long-lived workspace, I want to pin important tabs, so that
    they remain available while temporary tabs are closed.
35. As a SQL user, I want Execute, Cancel, connection context, database/schema,
    row limit, and execution state visible, so that the critical workflow is
    always understandable.
36. As a SQL user, I want lower-frequency actions moved out of the primary
    toolbar, so that the editor has less visual noise.
37. As a keyboard-oriented SQL user, I want execution shortcuts to preserve the
    existing selection-or-current-statement behavior, so that the redesign does
    not reduce productivity.
38. As a Windows user, I want shortcuts displayed with Windows notation, so that
    guidance matches my keyboard.
39. As a macOS user, I want shortcuts displayed with macOS notation, so that
    guidance feels native.
40. As a user whose query fails, I want the error beside the relevant result
    surface, so that I do not have to correlate it with a transient toast.
41. As a user running a long query, I want to continue working in other tabs, so
    that one operation does not block the entire application.
42. As a user reading query results, I want a compact DataGrip-like grid, so that
    more useful rows and columns fit on screen.
43. As a user comparing values, I want selected cells and ranges to remain
    visually clear, so that copying data is reliable.
44. As a user interpreting results, I want `NULL` to look different from an empty
    string, so that I do not misread database values.
45. As a user reading mixed data types, I want stable type-aware alignment, so
    that numeric and textual values are easier to scan.
46. As a user scrolling many rows, I want headers to remain available, so that I
    retain column context.
47. As a user copying data, I want value, row, range, and header copy workflows
    preserved, so that visual modernization does not remove core grid utility.
48. As a user previewing table data, I want the grid to remain read-only, so that
    inspection cannot accidentally modify database records.
49. As a user loading a large schema, I want only the relevant tree node to show
    loading state, so that I can continue using the rest of the application.
50. As a user encountering metadata failure, I want an inline retry action, so
    that recovery is obvious.
51. As a user monitoring active work, I want the status bar to show current Data
    Source context, queries, sessions, and tasks, so that operational information
    is available without opening another screen.
52. As a user during normal operation, I do not want backend version and health
    text occupying the status bar, so that the bar prioritizes my work context.
53. As a user when backend health is abnormal, I want a clear diagnostic cue, so
    that hidden routine status does not hide real problems.
54. As a user of light theme, I want a refined visual hierarchy, so that the
    workspace feels professional without heavy decoration.
55. As a user of dark theme, I want the same hierarchy and state clarity, so that
    dark mode is not a secondary or inconsistent experience.
56. As a Chinese-language user, I want all redesigned surfaces localized, so that
    the application remains fully usable in Chinese.
57. As an English-language user, I want long labels to fit without breaking the
    layout, so that English receives equal design quality.
58. As a user switching language, I want the interface to update using the
    existing language-switching behavior, so that I do not need a separate build.
59. As a Windows user using 125% or 150% scaling, I want controls and text to stay
    legible and usable, so that the application does not depend on macOS sizing.
60. As a user at the 800x600 minimum window size, I want the workspace to degrade
    gracefully, so that I can still connect, browse, query, and inspect results.
61. As a user at small window sizes, I want secondary labels to collapse before
    critical actions disappear, so that the interface remains functional.
62. As a user sensitive to visual motion, I want short functional transitions
    rather than decorative animation, so that the workspace feels stable.
63. As a new user, I want common actions visible, so that I can understand the
    product without memorizing shortcuts.
64. As an experienced user, I want shortcuts, context menus, and overflow actions,
    so that discoverability does not make the workspace permanently crowded.
65. As a user searching for an action in a later phase, I want a global command
    entry, so that I can navigate without remembering menu locations.
66. As a user managing connection details, I want a dedicated management
    workspace for complex tasks, so that advanced forms are not squeezed into a
    small popup.
67. As a user making a quick connection change, I want a focused edit dialog, so
    that simple updates do not require navigating a full management screen.
68. As a long-session user, I want consistent spacing, typography, icon weight,
    and interaction states, so that the application remains comfortable to use.
69. As a VaporLensDB user, I want the interface to feel like a lightweight
    professional IDE rather than a web administration dashboard, so that the
    visual quality matches the capability of the product.

## Implementation Decisions

- The work is a progressive modernization of the existing application shell and
  workflows, not a replacement frontend or a backend redesign.
- Existing Data Source, metadata, query, history, task, editor, result, settings,
  and localization stores remain the behavioral source of truth.
- Existing IPC contracts and database-driver behavior should remain unchanged
  unless a separately reviewed functional requirement requires an extension.
- The workspace uses explicit UI states derived from existing application state:
  disconnected landing, connected start, and active working tab.
- The connected start state is not persisted as an editor tab.
- The Object Tree remains mounted within the primary workspace model and is not
  replaced by a separate navigation concept.
- Sidebar resizing and collapse state are user interface preferences and should
  persist locally.
- Fixed environment classification is removed from the visual information
  architecture. Existing environment-named values must not remain as required UI
  semantics. Optional user-defined grouping is neutral and purpose-based.
- General actions use the shared application icon family. Database object types
  use dedicated compact glyphs designed as one coherent set.
- Visual state colors are semantic and limited: primary interaction, connected or
  successful, warning, error or danger, and neutral.
- The design system should express workspace surfaces, landing cards, overlays,
  dividers, selection, focus, typography, icon sizes, spacing, and motion through
  shared tokens rather than page-specific values.
- The first release uses one balanced compact density. Density preferences are
  deferred until user evidence justifies them.
- Native title bars and operating-system menus remain responsible for system
  window behavior.
- Workspace content responds to available width without creating a separate
  mobile layout.
- The read-only grid contract remains explicit. No edit affordances, pending
  change states, or update submission controls are introduced.
- Full Data Source management remains a working tab; focused create/edit actions
  may use dialogs.
- The global command entry is designed after the visible information
  architecture stabilizes and is delivered in Phase 2.
- The old Object Tree and IDE Workflow PRD remains a historical v1 capability
  record. This PRD governs the UI/UX modernization effort.

## Non-functional Requirements

### Performance

- The redesigned shell must not materially increase application startup time.
- Large Object Trees and result grids must preserve lazy loading and
  virtualization behavior.
- Resizing panels, switching tabs, scrolling the Object Tree, and scrolling data
  grids should remain visually responsive.
- Decorative effects must not add continuous animation or expensive backdrop
  processing to the active workspace.

### Accessibility

- All icon-only controls require accessible names and hover/focus explanations.
- Keyboard access must be preserved for navigation, menus, tabs, Object Tree
  actions, SQL execution, dialogs, and primary connection workflows.
- Focus indicators must remain visible in both themes.
- Text and essential state indicators must meet appropriate contrast expectations
  and may not rely on color alone.
- Compact controls must retain practical desktop pointer targets.
- Functional animation must respect reduced-motion preferences where applicable.

### Cross-platform Compatibility

- The core workspace must behave consistently on supported macOS and Windows
  builds.
- System menus, title bars, window controls, and shortcut notation may adapt to
  platform conventions.
- Layout and typography must remain stable under common Windows scaling factors.
- The application must remain usable at the configured 800x600 minimum size.

### Localization

- Every new user-facing string must be available in Chinese and English.
- Locale key parity must remain enforced.
- Components must tolerate language expansion without clipping critical actions
  or depending on a language-specific fixed width.
- Runtime language switching must continue to work.

### Theme Quality

- Light and dark themes must share component behavior, hierarchy, and semantic
  state meaning.
- No surface may be considered complete until both themes have been reviewed.
- Light theme is the primary screenshot and visual-comparison baseline.

### Reliability and Safety

- Existing Data Source binding, SQL execution, cancellation, dangerous-SQL
  confirmation, secret redaction, and read-only data-preview boundaries must not
  regress.
- A visual control must not imply an action is safe, connected, complete, or
  available when the underlying state disagrees.
- Connection and query failures must remain recoverable without restarting the
  application.

### Maintainability

- Shared visual rules must be expressed through reusable application-level
  components and tokens.
- New visual states must avoid duplicating business or connection logic already
  owned by application stores and services.
- Platform and locale variations should be centralized rather than scattered
  through individual pages.

## Testing Decisions

### Test Philosophy

- Tests should assert externally observable behavior and product boundaries, not
  exact component markup, utility-class strings, pixel values, or internal state
  shape.
- High-level workflow seams are preferred over isolated implementation tests.
- Visual polish requires deterministic screenshots and human comparison because
  hierarchy, spacing, icon balance, and perceived quality cannot be fully proven
  by source-string assertions.
- Existing smoke tests that currently inspect implementation strings should be
  evolved toward rendered behavior where practical during this modernization.

### Existing High-level Seams to Extend

- Opening workflow: disconnected landing, connected start, recent SQL restore,
  and no automatic SQL tab creation.
- Data Source switcher: search, recent items, favorites, optional groups,
  one-click connection, local feedback, and management separation.
- Object Tree workflow: initial business-schema orientation, lazy loading,
  system-object visibility, selection, double-click open, keyboard navigation,
  search, and contextual actions.
- Object Tree visual semantics: distinct database-object glyphs, muted system
  objects, selected state, loading state, and invalid-object warning.
- SQL editor workflow: shortcut execution, visible connection context, run,
  cancel, row limit, error placement, and non-blocking tabs.
- Tab workflow: explicit Data Source binding, renaming, restore, overflow,
  changed-state indication, closing, and pinning.
- Read-only grid workflow: no edit affordances, cell/range selection, copy,
  `NULL` presentation, pagination, filtering, sorting, and export.
- Internationalization: Chinese/English key parity, no hard-coded user-facing
  Chinese strings, runtime switching, and long-label layout review.
- Minimum-window workflow: 800x600 landing, connected workspace, collapsed
  Object Tree, SQL toolbar, grid, and status-bar fallback.
- Theme workflow: equivalent interaction and state visibility in light and dark
  themes.

### New Visual Review Matrix

Capture and review deterministic scenarios for both Chinese and English where
applicable:

1. Light theme, 1200x800, no active connection.
2. Dark theme, 1200x800, no active connection.
3. Light theme, connected Data Source Start Workspace.
4. Connected Object Tree with a business schema expanded.
5. Object Tree showing system objects and an invalid object state.
6. Multiple SQL tabs with an overflow condition.
7. SQL execution in progress and cancellation available.
8. SQL error displayed in the result area.
9. Compact read-only data grid containing text, numbers, dates, booleans, empty
   strings, and `NULL` values.
10. Data Source switcher with many saved connections, search results, favorites,
    and groups.
11. Windows-style shortcut notation at 125% and 150% scaling.
12. Minimum 800x600 window with responsive degradation active.

### Regression Gates

- Existing build, lint, TypeScript, Rust, and default clone-safe checks continue
  to pass.
- Existing connection readiness, Object Tree lifecycle, SQL execution, query
  history, task/session, import/export, diagnostics, and driver behavior remain
  covered.
- Live database verification remains manual and must not become a default CI
  requirement.

## Acceptance Criteria

1. With no active connection and no working tab, the application displays the
   Connection-first Landing Workspace with Data Source connection as the clear
   primary task.
2. Recent SQL is present on the disconnected landing state but is visually and
   structurally secondary to Data Source connection.
3. Clicking a recent Data Source initiates connection and displays progress on
   that item without blocking unrelated navigation.
4. Landing Data Source items do not expose credentials and do not require a full
   connection URL to identify the target.
5. Clicking recent SQL restores the SQL and its original Data Source binding
   without automatically connecting.
6. After a Data Source connects and before a working tab opens, the Data Source
   Start Workspace is shown without creating a permanent tab.
7. The connected start state emphasizes New SQL and Object Tree navigation and
   does not display unrelated recent Data Sources.
8. Closing all working tabs returns the appropriate landing or connected start
   state based on connection status.
9. The Object Tree remains the primary connected navigation surface and is not
   removed or replaced.
10. The Object Tree panel can be resized and collapsed, and its last state is
    restored in a later application session.
11. The first useful business schema is selected or emphasized after connection,
    while system schemas remain hidden by default.
12. The Object Tree uses distinguishable specialized glyphs for database object
    types and neutral consistent icons for general actions.
13. Hovering Object Tree rows does not expose multiple competing inline actions;
    lower-frequency actions remain available through context menus.
14. The persistent Workbench heading row is removed or consolidated so that
    connection and action context is not repeated across stacked toolbar rows.
15. The left tool-window rail remains available but is visually narrower and less
    prominent than the Object Tree and editor content.
16. Workspace regions use a flat Continuous Work Surface rather than enclosing
    the Object Tree, editor, and results in large rounded cards.
17. Cards and elevated shadows are limited to landing content, dialogs, menus,
    and temporary overlays.
18. Blue is used selectively for primary interaction and selection rather than
    across most icons and surfaces.
19. No fixed development, testing, staging, or production badge is required or
    persistently displayed.
20. Data Sources can be found through search and recent items, with favorites and
    optional neutral groups available for larger collections.
21. Workspace tabs remain on one row, provide overflow access, and keep the
    active tab visible.
22. SQL tabs retain explicit Data Source binding and do not silently follow
    global Data Source selection.
23. Tab context is concise, with full Data Source information available through
    the SQL toolbar or tooltip rather than a large bordered badge on every tab.
24. The SQL toolbar permanently prioritizes Execute, Cancel, Data Source,
    database/schema, row limit, and execution state.
25. Existing SQL execution shortcuts retain their selection-or-current-statement
    behavior.
26. SQL connection, progress, and error states are displayed in the relevant
    workspace and do not depend solely on global notifications.
27. Query execution or metadata loading in one area does not unnecessarily block
    other tabs or unrelated controls.
28. Query results and table previews remain read-only with no cell-editing
    affordance.
29. The data grid presents a compact DataGrip-like density, restrained cell
    boundaries, clear selection, type-aware alignment, and a distinct `NULL`
    treatment.
30. Existing grid copy, filtering, sorting, pagination, generated SQL, and export
    workflows continue to function.
31. The status bar prioritizes current Data Source context, active queries,
    sessions, tasks, and abnormal status.
32. Routine backend health, version, and theme controls no longer permanently
    compete with operational status information.
33. All redesigned icon-only actions provide accessible labels, tooltips, and
    visible keyboard focus.
34. Light and dark themes both preserve readable hierarchy, state contrast, and
    functional parity.
35. Chinese and English interfaces both render without clipped critical actions,
    broken tabs, or language-specific fixed-layout failures.
36. The application remains usable at 800x600 without application-level
    horizontal scrolling.
37. The workspace remains usable under common Windows display scaling, with
    platform-appropriate shortcut notation.
38. Functional transitions are brief and do not introduce decorative or
    continuous motion.
39. The redesign does not introduce a custom frameless title bar.
40. Existing connection, metadata, SQL, query history, session/task,
    import/export, diagnostics, and driver workflows continue to pass their
    regression gates.

## Out of Scope

- Editing table data or adding inline cell-editing workflows.
- Adding new database families, ODBC, or changing the native/JDBC driver strategy.
- Replacing the React/Tauri application architecture.
- Changing database IPC contracts solely for visual modernization.
- Building a custom frameless title bar or reproducing macOS window controls on
  Windows.
- Creating separate macOS and Windows workspace designs.
- Cloning DataGrip's theme, proprietary icons, layout, or product identity.
- Introducing glassmorphism, prominent gradients, decorative illustration-heavy
  welcome screens, or ornamental animation.
- Adding mandatory development, testing, staging, or production classifications.
- Adding a full configurable dangerous-SQL policy engine.
- Adding a compact/comfortable density setting in the first release.
- Turning Data Source management into a connection-only sidebar list.
- Removing or replacing the Object Tree.
- Making live private databases or proprietary JDBC JARs required for default CI.
- Rewriting all existing documentation as part of the UI implementation. Design
  and testing documents should be updated only where this PRD changes their
  responsibilities.

## Further Notes

- The historical Object Tree and IDE Workflow PRD remains the record of completed
  v1 capabilities. This document defines the next UI/UX modernization effort.
- Product vocabulary is defined in the repository context glossary. PRD and
  implementation language should use Data Source, Object Tree, Connection-first
  Landing Workspace, Data Source Start Workspace, Lightweight IDE Workspace,
  Continuous Work Surface, Semantic Icon Language, Professional Finish, and
  Progressive Workspace Interaction consistently.
- The primary measure of success is not visual novelty. Success means users can
  identify context, choose the next action, recover from failures, and complete
  common database tasks with less searching and less interface noise.
- No ADR is required for the current visual direction because it is incremental,
  reversible, and does not change architecture or persistence boundaries.
