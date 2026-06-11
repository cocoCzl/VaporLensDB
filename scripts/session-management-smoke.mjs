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

const uiStore = read('src/stores/uiStore.ts')
includesAll(
  uiStore,
  ["'sessions'", "type SidebarView = 'dataSources' | 'sql' | 'sessions' | 'settings'"],
  'session sidebar view state',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(
  sidebar,
  [
    "{ view: 'sessions', icon: Activity, label: '会话' }",
    'SessionManagementPanel',
    'runtimeSessions',
    'runningQueryCount',
    'cancelRunningQuery(tab.id, connection.id, tab.runningQueryId)',
    'disconnectConnection(connectionId)',
    'driverCanCancel',
    "return driverType === 'postgres'",
    '当前驱动暂不报告可取消的 running queries。',
    '当前驱动不支持取消',
    '没有活动会话',
  ],
  'session management panel',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:session-management', 'scripts/session-management-smoke.mjs'],
  'session management smoke script registration',
)

if (failures.length > 0) {
  console.error('Session management smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Session management smoke passed.')
