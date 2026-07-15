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
    "sidebarView === 'dataSources'",
    '<DataSourcesSelectorPanel />',
    'function DataSourcesSelectorPanel()',
    'void loadConnections()',
    "searchInputRef.current?.focus()",
    'filterConnections(connections, query)',
    'recentDataSourceIds',
    'favoriteDataSourceIds',
    '<ConnectionSwitcherSection title={t(\'connection.recent\')}>',
    '<ConnectionSwitcherSection title={t(\'connection.favorites\')}>',
    'recentConnections.map((connection) =>',
    '!recentConnections.some((recentConnection) => recentConnection.id === connection.id)',
    'groupConnections(',
    'groupSortKey(',
    "t('connection.ungrouped')",
    'connectionTargetSummary(connection)',
    'setActiveConnection(connection.id)',
    'connectConnection(connection.id)',
    'disconnectConnection(connection.id)',
    'function toggleActiveConnection(',
    'event.stopPropagation()',
    '<ConnectionDialog',
    'connection={activeConnection}',
    'connection={connection}',
    "t('connection.disconnect')",
    "t('connection.edit')",
    "setSidebarView('explorer')",
    "setSidebarView('dataSources')",
    'function openDataSourceManagement()',
    "tabs.find((tab) => tab.kind === 'dataSources')",
    "kind: 'dataSources'",
    "t('connection.manageDataSources')",
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
    "view: 'sql'",
    "view: 'sessions'",
    "title={t('connection.edit')}\n                      onClick={(event) => event.stopPropagation()}",
    "title={t('connection.edit')}\n            onClick={(event) => event.stopPropagation()}",
  ],
  'Explorer default surface',
)

excludesAll(
  sidebar,
  ['EnvironmentBadge', 'isProductionConnection', 'environmentSortKey', 'colorTag'],
  'neutral Data Source semantics',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(
  zh,
  ['"connected": "已连接"', '"connecting": "连接中"', '"failed": "连接失败"', '"searchDataSources": "搜索数据源"', '"noMatches": "没有匹配的数据源"', '"recent": "最近"', '"favorites": "收藏"', '"favorite": "加入收藏"', '"unfavorite": "取消收藏"', '"allDataSources": "全部数据源"', '"manageDataSources": "管理数据源"'],
  'Chinese Data Source switcher locale',
)
includesAll(
  en,
  ['"connected": "Connected"', '"connecting": "Connecting"', '"failed": "Connection failed"', '"searchDataSources": "Search Data Sources"', '"noMatches": "No matching Data Sources"', '"recent": "Recent"', '"favorites": "Favorites"', '"favorite": "Add to favorites"', '"unfavorite": "Remove from favorites"', '"allDataSources": "All Data Sources"', '"manageDataSources": "Manage Data Sources"'],
  'English Data Source switcher locale',
)

const connectionStore = read('src/stores/connectionStore.ts')
includesAll(
  connectionStore,
  [
    'RECENT_DATA_SOURCES_STORAGE_KEY',
    'MAX_RECENT_DATA_SOURCES',
    'recentDataSourceIds',
    'favoriteDataSourceIds',
    'readStoredRecentDataSourceIds()',
    'readStoredFavoriteDataSourceIds()',
    'rememberRecentDataSource(state.recentDataSourceIds, id)',
    'currentIds.filter((currentId) => currentId !== id)',
    'forgetRecentDataSource(state.recentDataSourceIds, id)',
    'toggleFavoriteDataSource: (id)',
    'toggleFavoriteDataSource(state.favoriteDataSourceIds, id)',
    'forgetFavoriteDataSource(state.favoriteDataSourceIds, id)',
  ],
  'recent Data Source persistence',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "activeTab.kind === 'dataSources'",
    'function DataSourcesManagementPanel()',
    '<ConnectionList mode="manager" />',
    "t('connection.new')",
    "t('connection.refresh')",
  ],
  'Data Sources management workspace tab',
)

const app = read('src/App.tsx')
includesAll(
  app,
  ['onContextMenu={(event) => {', 'event.preventDefault()'],
  'native WebView context menu suppression',
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
