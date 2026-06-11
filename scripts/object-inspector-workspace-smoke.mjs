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

const store = read('src/stores/objectInspectorStore.ts')
includesAll(
  store,
  [
    'ObjectInspection',
    "kind: 'table' | 'view' | 'materializedView'",
    'metadata.loadColumns',
    'metadata.loadIndexes',
    'metadata.loadForeignKeys',
    'getTableDdl',
  ],
  'object inspector store',
)

const panel = read('src/components/inspector/ObjectInspectorPanel.tsx')
includesAll(
  panel,
  [
    'Object Inspector',
    'aria-label="Object Inspector workspace"',
    'STRUCTURE_EDITING_ENABLED = false',
    'ColumnsTable',
    'IndexesTable',
    'ForeignKeysTable',
    'DdlBlock',
    '编辑结构',
  ],
  'object inspector panel',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'openTableInspector',
    'tableInspectorKind',
    '打开 Object Inspector',
    '打开 Structure Tab',
    'inspectTable(activeConnectionId',
  ],
  'object tree inspector actions',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    '<ObjectInspectorPanel />',
    "activeTab.kind === 'data'",
    "activeTab.kind === 'structure'",
    "activeTab.kind === 'definition'",
    "activeTab.kind === 'diagram'",
  ],
  'object inspector workspace placement',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:object-inspector-workspace', 'scripts/object-inspector-workspace-smoke.mjs'],
  'object inspector smoke script registration',
)

if (failures.length > 0) {
  console.error('Object inspector workspace smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Object inspector workspace smoke passed.')
