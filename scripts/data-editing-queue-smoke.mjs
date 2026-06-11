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

const editSql = read('src/lib/dataEditSql.ts')
includesAll(
  editSql,
  [
    'export interface PendingCellChange',
    'buildPendingCellChange',
    'upsertPendingCellChange',
    'buildTransactionalEditSql',
    'transactionStartSql',
    'START TRANSACTION;',
    'BEGIN TRANSACTION;',
    'COMMIT;',
    'UPDATE ${qualifiedName',
    'primaryKeyColumns',
    'parseEditedValue',
  ],
  'transactional edit SQL builder',
)

const dataGrid = read('src/components/grid/DataGrid.tsx')
includesAll(
  dataGrid,
  [
    'editable?: boolean',
    'pendingChanges?: PendingCellChange[]',
    'failedChanges?: PendingCellChange[]',
    'onEditCell?:',
    'onDoubleClick',
    'InlineCellEditor',
    '待提交变更',
  ],
  'editable data grid',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    'pendingChanges',
    'buildPendingCellChange({',
    'buildTransactionalEditSql(',
    'primary-key 定位信息',
    'Pending changes',
    '预览 SQL',
    '提交事务',
    '事务提交失败，查看查询错误详情。',
    'editable={canEditData}',
    'failedChanges=',
  ],
  'data tab editing queue UI',
)

const useQuery = read('src/hooks/useQuery.ts')
includesAll(
  useQuery,
  ['return true', 'return false'],
  'query hook success mapping',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:data-editing-queue', 'scripts/data-editing-queue-smoke.mjs'],
  'data editing queue smoke script registration',
)

if (failures.length > 0) {
  console.error('Data editing queue smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Data editing queue smoke passed.')
