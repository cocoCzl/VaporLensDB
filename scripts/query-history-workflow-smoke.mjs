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

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(
  sidebar,
  [
    'historyStatusFilter',
    'historyConnectionFilter',
    'filteredHistory',
    'historyFilteredEmpty',
    'uniqueHistoryConnections',
    'expandedHistoryId',
    'historySqlPreview',
    'historyErrorPreview',
    'connectionNameSnapshot',
  ],
  'query history workflow UI',
)

const en = read('src/locales/en.json')
const zh = read('src/locales/zh.json')
includesAll(
  en,
  [
    'historyStatusFilter',
    'historyConnectionFilter',
    'historyFilterSuccess',
    'historyFilterFailed',
    'historyErrorPreview',
  ],
  'query history English locale',
)
includesAll(
  zh,
  [
    'historyStatusFilter',
    'historyConnectionFilter',
    'historyFilterSuccess',
    'historyFilterFailed',
    'historyErrorPreview',
  ],
  'query history Chinese locale',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:query-history-workflow', 'scripts/query-history-workflow-smoke.mjs'],
  'query history workflow smoke registration',
)

if (failures.length > 0) {
  console.error('Query history workflow smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Query history workflow smoke passed.')
