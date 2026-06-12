import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message)
  }
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
includesAll(sidebar, ["view: 'dataSources'", "view: 'sql'", "sidebarView === 'settings'"], 'left rail')
excludesAll(sidebar, ["view: 'structure'", 'StructurePanel', 'ObjectDetails'], 'left rail')
includesAll(sidebar, ["t('sql.history')", 'handleClearHistory', 'clearHistory'], 'settings history clear')

const uiStore = read('src/stores/uiStore.ts')
assert(
  uiStore.includes("type SidebarView = 'dataSources' | 'sql' | 'sessions' | 'settings'"),
  'SidebarView should expose current task-approved views',
)

const connectionForm = read('src/components/connection/ConnectionForm.tsx')
excludesAll(connectionForm, ['SSH/SSL', '架构', 'Options', '选项'], 'connection dialog tabs')
includesAll(
  connectionForm,
  ["{ id: 'postgres'", "{ id: 'mysql'", "{ id: 'oracle'", "{ id: 'sqlite'", "{ id: 'mssql'"],
  'primary database choices',
)
assert(
  connectionForm.includes("disabled={driver.status === 'planned'}"),
  'planned database choices should be disabled',
)
includesAll(connectionForm, ['Oracle 需要至少填写一个本地 ojdbc JAR 路径'], 'Oracle local validation')

const dataGrid = read('src/components/grid/DataGrid.tsx')
excludesAll(dataGrid, ['UPDATE '], 'data grid should not execute SQL directly')
includesAll(dataGrid, ['copyToClipboard(value)', 'copyToClipboard(rowValue)'], 'read-only data grid copy actions')

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(mainPanel, ['analyzeSqlRisk', 'confirmDangerousSql', 'driverQueryCapabilities'], 'query controls')
includesAll(mainPanel, ['canCancel: false', 'canExplain: false', 'canComplete: false'], 'driver capability gates')

if (failures.length > 0) {
  console.error('V1 UI scope smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('V1 UI scope smoke passed.')
