import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

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

includesAll(
  sidebar,
  [
    'function DataSourceHeader()',
    '<DataSourceHeader />',
    '<DatabaseTree />',
    'void loadConnections()',
    'Popover open={open} onOpenChange={setOpen}',
    'searchInputRef.current?.focus()',
    'filterConnections(connections, query)',
    'recentDataSourceIds',
    '<ConnectionSwitcherSection title={t(\'connection.recent\')}>',
    'recentConnections.map((connection) =>',
    '!recentConnections.some((recentConnection) => recentConnection.id === connection.id)',
    'groupConnectionsByEnvironment(',
    'environmentSortKey(',
    "t('connection.ungrouped')",
    '{connection.driverType} · {connection.group?.trim() || t(\'connection.ungrouped\')}',
    'setActiveConnection(connection.id)',
    'connectConnection(connection.id)',
    'function openDataSourceManagement()',
    "tabs.find((tab) => tab.kind === 'dataSources')",
    "kind: 'dataSources'",
    "t('connection.manageDataSources')",
    'isProductionConnection(activeConnection)',
    'runtimeStatusLabel(activeStatus, t)',
    "t('connection.searchDataSources')",
    "t('connection.noMatches')",
  ],
  'Data Source header and switcher workflow',
)

excludesAll(
  sidebar,
  [
    "import { ConnectionList }",
    '<ConnectionList />',
    "view: 'dataSources'",
    "view: 'sql'",
    "view: 'sessions'",
  ],
  'Explorer default surface',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(
  zh,
  ['"connected": "已连接"', '"connecting": "连接中"', '"failed": "连接失败"', '"searchDataSources": "搜索 Data Sources"', '"noMatches": "没有匹配的数据源"', '"recent": "最近"', '"allDataSources": "全部数据源"', '"manageDataSources": "管理 Data Sources"'],
  'Chinese Data Source switcher locale',
)
includesAll(
  en,
  ['"connected": "Connected"', '"connecting": "Connecting"', '"failed": "Connection failed"', '"searchDataSources": "Search Data Sources"', '"noMatches": "No matching Data Sources"', '"recent": "Recent"', '"allDataSources": "All Data Sources"', '"manageDataSources": "Manage Data Sources"'],
  'English Data Source switcher locale',
)

const connectionStore = read('src/stores/connectionStore.ts')
includesAll(
  connectionStore,
  [
    'RECENT_DATA_SOURCES_STORAGE_KEY',
    'MAX_RECENT_DATA_SOURCES',
    'recentDataSourceIds',
    'readStoredRecentDataSourceIds()',
    'rememberRecentDataSource(state.recentDataSourceIds, id)',
    'currentIds.filter((currentId) => currentId !== id)',
    'forgetRecentDataSource(state.recentDataSourceIds, id)',
  ],
  'recent Data Source persistence',
)
assert(!sidebar.toLowerCase().includes('favorite'), 'P0 switcher should not introduce favorites')

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "activeTab.kind === 'dataSources'",
    'function DataSourcesManagementPanel()',
    '<ConnectionList mode="manager" />',
  ],
  'Data Sources management workspace tab',
)

const connectionList = read('src/components/connection/ConnectionList.tsx')
includesAll(
  connectionList,
  ["mode = 'sidebar'", "'sidebar' | 'manager'", "mode === 'manager'"],
  'ConnectionList management mode',
)

const tabBar = read('src/components/layout/TabBar.tsx')
includesAll(
  tabBar,
  ['if (tab.connectionId)', 'setActiveConnection(tab.connectionId)'],
  'workspace tabs should not clear active Data Source for management tabs',
)

if (failures.length > 0) {
  console.error('Data Source switcher smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Data Source switcher smoke passed.')
