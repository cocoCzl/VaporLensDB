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
    'event.shiftKey',
    'includeHeaders',
    "formatRange(result, range, includeHeaders, 'text')",
    "formatRange(result, range, includeHeaders, 'csv')",
    "formatRange(result, range, includeHeaders, 'json')",
    'ColumnResizeHandle',
    'writeColumnWidths',
    'readColumnWidths',
    'ValueViewer',
    'formatJsonIfPossible',
    'Search value',
    'Open value viewer',
  ],
  'read-only grid copy, widths, and viewer',
)
excludesAll(
  dataGrid,
  ['onDoubleClick', 'InlineCellEditor', 'onEditCell', 'pendingChanges', 'Pencil'],
  'read-only grid editing affordances',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    '<ErrorDetails message={activeTab.error} sql={activeTab.sql} />',
    'navigator.clipboard?.writeText(copyText)',
    '<Copy className="size-3.5" />',
    '<DataGrid result={activeResult} />',
  ],
  'result-area error display',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:p1-read-only-result-workflow', 'scripts/p1-read-only-result-workflow-smoke.mjs'],
  'P1 smoke registration',
)

if (failures.length > 0) {
  console.error('P1 read-only result workflow smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('P1 read-only result workflow smoke passed.')
