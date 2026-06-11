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

const editorStore = read('src/stores/editorStore.ts')
includesAll(
  editorStore,
  [
    "'diagram'",
    'DiagramTabContext',
    'diagramContext?: DiagramTabContext | null',
    'tables?: string[] | null',
  ],
  'diagram tab model',
)

const erDiagram = read('src/components/diagram/ERDiagram.tsx')
includesAll(
  erDiagram,
  [
    '@xyflow/react',
    'ReactFlow',
    'Controls',
    'MiniMap',
    'Background',
    'metadata.loadTables',
    'metadata.loadColumns',
    'metadata.loadForeignKeys',
    'MAX_SCHEMA_TABLES = 40',
    'gridPosition',
    'Missing metadata',
  ],
  'ER diagram workspace',
)

const tableNode = read('src/components/diagram/TableNode.tsx')
includesAll(
  tableNode,
  ['columns: ColumnInfo[]', 'isPrimaryKey', 'FK out', 'FK in', 'more columns'],
  'ER diagram table node',
)

const relationEdge = read('src/components/diagram/RelationEdge.tsx')
includesAll(
  relationEdge,
  ['BaseEdge', 'EdgeLabelRenderer', 'getBezierPath', 'RelationEdgeData'],
  'ER diagram relation edge',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  ["activeTab.kind === 'diagram'", '<ERDiagram', 'activeDiagramContext.tables'],
  'ER diagram tab rendering',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'openTableDiagram',
    'openSchemaDiagram',
    "kind: 'diagram'",
    '打开 ER Diagram',
    'tables: [node.meta.table]',
    'tables: null',
  ],
  'ER diagram object tree actions',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:er-diagram', 'scripts/er-diagram-smoke.mjs'],
  'ER diagram smoke script registration',
)

if (failures.length > 0) {
  console.error('ER diagram smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('ER diagram smoke passed.')
