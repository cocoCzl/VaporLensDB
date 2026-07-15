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

const dataGrid = read('src/components/grid/DataGrid.tsx')
includesAll(
  dataGrid,
  [
    'nextCellSelection',
    'selectionContains(selection, virtualRow.index, columnIndex)',
    'copyToClipboard(value)',
    'copyToClipboard(rowValue)',
    'const ROW_HEIGHT = 26',
    'cellAlignment(column.dataType)',
    "isNull ? 'font-sans text-[11px] italic text-muted-foreground' : ''",
  ],
  'compact read-only data grid selection, copy, and NULL semantics',
)
excludesAll(
  dataGrid,
  [
    'editable?: boolean',
    'pendingChanges?:',
    'failedChanges?:',
    'onEditCell?:',
    'onDoubleClick',
    'InlineCellEditor',
    'Pencil',
    "t('result.pendingChange')",
  ],
  'read-only data grid must not expose edit affordances',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  ['Data tab · read-only', "t('workbench.readOnlyDataPreview')", '<DataGrid result={displayResult} />', 'aria-label="generated SQL"'],
  'read-only data tab UI',
)
excludesAll(
  mainPanel,
  [
    'pendingChanges',
    'buildPendingCellChange',
    'buildTransactionalEditSql',
    'onOpenEditPreview',
    'onSubmitEdits',
    'editable={',
    'failedChanges=',
    '提交事务',
    'Pending changes',
  ],
  'data tab edit queue UI',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:data-grid-read-only', 'scripts/data-grid-read-only-smoke.mjs'],
  'read-only data grid smoke script registration',
)
assert(
  !packageJson.includes('test:data-editing-queue'),
  'data editing queue smoke script should be removed from package scripts',
)

if (failures.length > 0) {
  console.error('Read-only data grid smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Read-only data grid smoke passed.')
