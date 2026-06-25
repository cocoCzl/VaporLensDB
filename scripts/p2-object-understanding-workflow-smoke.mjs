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

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'function quickActions(node: NodeRecord): TreeNodeQuickAction[]',
    "id: 'open-structure'",
    "id: 'view-ddl'",
    'openTableDiagram',
    'tables: [node.meta.table]',
    'openObjectSummary',
    'void inspectTable(',
  ],
  'object context actions',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    'onOpenStructure',
    'onOpenDefinition',
    'onOpenInspector',
    'onOpenDiagram',
    'copyDefinition',
    'navigator.clipboard.writeText(tab.sql)',
    'loadDefinition(true)',
    "readOnly",
    '<ERDiagram',
    'tables={activeDiagramContext.tables}',
  ],
  'object understanding workspace',
)

const erDiagram = read('src/components/diagram/ERDiagram.tsx')
includesAll(
  erDiagram,
  ['tables && tables.length > 0', 'metadata.loadForeignKeys', 'ReactFlow'],
  'selected-table ER diagram',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:p2-object-understanding-workflow', 'scripts/p2-object-understanding-workflow-smoke.mjs'],
  'P2 smoke registration',
)

if (failures.length > 0) {
  console.error('P2 object understanding workflow smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('P2 object understanding workflow smoke passed.')
