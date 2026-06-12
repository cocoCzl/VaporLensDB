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
    "{ view: 'sessions', icon: Activity, labelKey: 'nav.sessions' }",
    'SessionManagementPanel',
    'runtimeSessions',
    'runningQueryCount',
    'cancelRunningQuery(tab.id, connection.id, tab.runningQueryId)',
    'disconnectConnection(connectionId)',
    'driverCanCancel',
    "return driverType === 'postgres'",
    "t('sessions.runningQueriesUnavailable')",
    "t('sessions.cancelUnsupported')",
    "t('sessions.emptyTitle')",
  ],
  'session management panel',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(
  zh,
  ['"sessions": "会话"', '"runningQueriesUnavailable": "当前驱动暂不报告可取消的 running queries。"', '"cancelUnsupported": "当前驱动不支持取消"', '"emptyTitle": "没有活动会话"'],
  'Chinese session management locale',
)
includesAll(
  en,
  ['"sessions": "Sessions"', '"runningQueriesUnavailable": "The current driver does not report cancellable running queries."', '"cancelUnsupported": "The current driver does not support cancel"', '"emptyTitle": "No active sessions"'],
  'English session management locale',
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
