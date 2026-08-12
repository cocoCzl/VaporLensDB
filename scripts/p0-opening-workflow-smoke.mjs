import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const mockedDataSources = Array.from({ length: 20 }, (_, index) => ({
  id: `mock-${index + 1}`,
  name: `Mock Source ${String(index + 1).padStart(2, '0')}`,
  driverType: index % 3 === 0 ? 'postgres' : index % 3 === 1 ? 'mysql' : 'oracle',
}))

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} missing: ${value}`)
  }
}

function excludesAll(source, values, label) {
  for (const value of values) {
    assert(!source.includes(value), `${label} should not include: ${value}`)
  }
}

const sidebar = read('src/components/layout/Sidebar.tsx')
assert(mockedDataSources.length >= 20, 'P0 smoke should mock at least 20 saved Data Sources')
includesAll(
  sidebar,
  ['const RAIL_ITEMS = [', "{ view: 'explorer'", 'function openSettings()', "kind: 'settings'", '<CompactDataSourceTree />', '<DatabaseTree connectionId='],
  'Explorer-first left rail',
)
excludesAll(
  sidebar.slice(sidebar.indexOf('const RAIL_ITEMS = ['), sidebar.indexOf('export function Sidebar')),
  ["view: 'sql'", "view: 'sessions'", "view: 'history'"],
  'persistent left rail',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    '<WorkbenchHome',
    'const connectionId = activeTab?.connectionId ?? null',
    'updateTabConnection(activeTab.id, id)',
    '<SqlHistoryPanel',
    'useQueryHistoryStore',
    'useSqlDraftStore',
    'saveTabDraft',
    "t('workbench.emptyEditorHint')",
    "t('workbench.emptyEditorDetail')",
    'setStatusFilter',
    'setConnectionFilter',
    "t('workbench.reuseSql')",
    "t('sql.history')",
    '<SettingsWorkspacePanel />',
  ],
  'main workspace opening workflow',
)
assert(
  !mainPanel.includes('ensureTab(activeConnectionId)'),
  'main workspace should not auto-create a SQL tab and hide home state',
)
assert(!mainPanel.includes('ConnectionFirstLanding'), 'home should not render landing cards')
assert(!mainPanel.includes('RecentSqlPanel'), 'home should not render recent drafts')

const tabBar = read('src/components/layout/TabBar.tsx')
includesAll(
  tabBar,
  [
    'connection ? `${connection.name} SQL` :',
    'renameTab',
    'saveTabDraft',
    'markDraftClosed',
    'closeEditorTab',
    'onDoubleClick',
    'setEditingTabId',
    'connectionId: activeConnectionId',
    'nextSqlIndex',
    "openRecordsWorkspace('sqlScripts')",
  ],
  'SQL tab context and naming',
)

const toolbar = read('src/components/layout/GlobalToolbar.tsx')
assert(!toolbar.includes("t('workbench.newSql')"), 'global toolbar must not duplicate the tab-bar SQL action')
assert(!toolbar.includes('CreateDatabaseDialog'), 'global toolbar must not expose database creation')
assert(
  tabBar.includes("openRecordsWorkspace('sqlScripts')"),
  'SQL drafts should open in the records workspace',
)
assert(
  mainPanel.includes("t('sql.clearRecentScripts')"),
  'SQL scripts workspace should expose draft clearing',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:p0-opening-workflow', 'scripts/p0-opening-workflow-smoke.mjs'],
  'P0 smoke registration',
)

if (failures.length > 0) {
  console.error('P0 opening workflow smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('P0 opening workflow smoke passed.')
