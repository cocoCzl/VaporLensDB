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
    "kind?:",
    "| 'sql'",
    "| 'data'",
    "| 'structure'",
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
    "t('explorer.openStructure')",
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
    'getTableDdl(tab.connectionId, context.schema, context.object)',
    'readOnly',
    'ColumnsView',
    'IndexesView',
    'ForeignKeysView',
    'TableTriggers',
    "t('workbench.refreshStructure')",
    'Structure tab · read-only',
  ],
  'structure tab panel',
)

const triggers = read('src/components/inspector/TableTriggers.tsx')
includesAll(triggers, ['getTableTriggers(connectionId, schema, table)', 'UNSUPPORTED_OPERATION', 'current = false', 'state.request !== request', "t('workbench.noTriggers')", "t('workbench.loadTriggersFailed')", "t('workbench.triggersUnsupported')", "t('workbench.openSourceDdl')"], 'table trigger lifecycle')
assert(!triggers.includes('.catch(() => [])'), 'trigger failures must not become empty results')

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
