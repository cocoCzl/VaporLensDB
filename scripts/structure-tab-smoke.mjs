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

const editorStore = read('src/stores/editorStore.ts')
includesAll(
  editorStore,
  [
    "'sql' | 'data' | 'structure'",
    'structureContext?: StructureTabContext | null',
    'export interface StructureTabContext',
    "objectKind: 'table' | 'view' | 'materializedView'",
  ],
  'structure tab editor contract',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'openTableStructure(node.id)',
    "kind: 'structure'",
    'structureContext:',
    'database: node.meta.database',
    'schema: node.meta.schema',
    'object: node.meta.table',
    '打开 Structure Tab',
  ],
  'object tree structure tab action',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "activeTab.kind === 'structure'",
    '<StructureTabPanel',
    "type StructureSection = 'columns' | 'indexes' | 'foreignKeys' | 'triggers' | 'ddl'",
    'metadata.loadColumns(tab.connectionId, context.schema, context.object, force)',
    'metadata.loadIndexes(tab.connectionId, context.schema, context.object, force)',
    'metadata.loadForeignKeys(tab.connectionId, context.schema, context.object, force)',
    "metadata.loadSchemaObjects(tab.connectionId, context.schema, 'trigger', force)",
    'getTableDdl(tab.connectionId, context.schema, context.object)',
    'readOnly',
    'ColumnsView',
    'IndexesView',
    'ForeignKeysView',
    'TriggersView',
    '打开 Source/DDL',
    '刷新结构',
    'Structure tab · read-only',
  ],
  'structure tab panel',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:structure-tab', 'scripts/structure-tab-smoke.mjs'],
  'structure smoke script registration',
)

if (failures.length > 0) {
  console.error('Structure tab smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Structure tab smoke passed.')
