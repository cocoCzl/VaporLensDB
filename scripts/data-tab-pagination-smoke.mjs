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

const sql = read('src/lib/dataTabSql.ts')
includesAll(
  sql,
  [
    'buildDataTabSql',
    'wherePredicate',
    'sortColumn',
    'sortDirection',
    'primaryKeyColumns',
    'dataTabFetchLimit',
    'ORDER BY',
    'OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY',
    'LIMIT ${limit} OFFSET ${offset};',
  ],
  'data tab SQL generation',
)

const editorStore = read('src/stores/editorStore.ts')
includesAll(
  editorStore,
  [
    'offset: number',
    'wherePredicate?: string | null',
    'sortColumn?: string | null',
    'sortDirection?: DataTabSortDirection | null',
    'primaryKeyColumns: string[]',
    'updateDataTabContext',
  ],
  'data tab context fields',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'buildDataTabSql',
    'primaryKeyColumns',
    'offset: 0',
    'limit: dataPreviewDefaultRows',
  ],
  'object tree creates ordered data tabs',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    'onContextChange',
    'wherePredicate: whereText.trim() || null',
    'sortColumn',
    'sortDirection',
    'dataTabDisplayResult',
    'hasNextPage',
    'result.rows.length > tab.dataContext.limit',
    'disabled={running || !hasNextPage}',
    'offset: tab.dataContext.offset + tab.dataContext.limit',
    'Math.max(0, tab.dataContext.offset - tab.dataContext.limit)',
    "t('workbench.noPrimaryKeyUnstable')",
    "t('workbench.primaryKeyAscending')",
    'aria-label="generated SQL"',
    'readOnly',
    "t('workbench.openInSqlTab')",
    'dataContextToSqlInput',
  ],
  'data tab pagination UI',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:data-tab-pagination', 'scripts/data-tab-pagination-smoke.mjs'],
  'pagination smoke script registration',
)

if (failures.length > 0) {
  console.error('Data tab pagination smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Data tab pagination smoke passed.')
