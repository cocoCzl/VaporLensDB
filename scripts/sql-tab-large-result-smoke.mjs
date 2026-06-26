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

const uiStore = read('src/stores/uiStore.ts')
includesAll(
  uiStore,
  ['const DEFAULT_QUERY_MAX_ROWS = 5_000', 'queryMaxRows: DEFAULT_QUERY_MAX_ROWS'],
  'SQL tab default render cap',
)

const useQuery = read('src/hooks/useQuery.ts')
includesAll(
  useQuery,
  [
    'options: { maxRows?: number } = {}',
    'executeQueryStream({',
    'connectionId,',
    'sql,',
    'queryId,',
    'maxRows: options.maxRows ?? useUiStore.getState().queryMaxRows',
  ],
  'SQL query execution preserves caller SQL and applies render cap',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    'const sql = sqlToRun()',
    'runQuery(activeTab.id, connectionId, sql)',
    'largeResultNotice(activeResult)',
    "i18n.t('workbench.largeResultNotice'",
    'runQuery(activeTab.id, activeTab.connectionId, activeTab.sql, {',
    'maxRows: activeDataContext.limit',
    'maxRows: nextContext.limit',
    'exportQueryResultCsv({ result, path, includeHeader: true })',
  ],
  'SQL tab large-result UI and CSV behavior',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'runQuery(tabId, entry.connectionId, sql, { maxRows: dataPreviewDefaultRows })',
    'runQuery(tabId, activeConnectionId, sql, { maxRows: dataPreviewDefaultRows })',
  ],
  'Data tab initial load keeps preview limit independent from SQL tab cap',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:sql-tab-large-result', 'scripts/sql-tab-large-result-smoke.mjs'],
  'large-result smoke script registration',
)

if (failures.length > 0) {
  console.error('SQL tab large-result smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('SQL tab large-result smoke passed.')
