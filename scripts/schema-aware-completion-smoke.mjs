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

function excludesAll(source, values, label) {
  for (const value of values) {
    assert(!source.includes(value), `${label} should not include: ${value}`)
  }
}

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "case 'postgres'",
    "case 'mysql'",
    "case 'oracle'",
    'canComplete: true',
    'driverType={activeDriverType}',
    'showSystemObjects={showSystemObjects}',
    'loadTables(connectionId, selectedSchema)',
    'loadViews(connectionId, selectedSchema)',
    'loadFunctions(connectionId, selectedSchema)',
  ],
  'completion driver support and current schema preload',
)
excludesAll(
  mainPanel,
  ['loadSchemaObjects(connectionId, selectedSchema,'],
  'editor open must not scan all schema object categories',
)

const sqlEditor = read('src/components/editor/SqlEditor.tsx')
includesAll(
  sqlEditor,
  [
    'driverType?: DriverType | null',
    'showSystemObjects?: boolean',
    'getDriverType: () => driverTypeRef.current',
    'getShowSystemObjects: () => showSystemObjectsRef.current',
  ],
  'SQL editor completion context',
)

const autoComplete = read('src/components/editor/AutoComplete.ts')
includesAll(
  autoComplete,
  [
    'schemaObjectSuggestions',
    'schemaForOwner',
    "state.loadTables(connectionId, schema).catch(() => [])",
    "state.loadViews(connectionId, schema).catch(() => [])",
    "state.loadFunctions(connectionId, schema).catch(() => [])",
    "state.loadSchemaObjects(connectionId, schema, 'materializedView').catch(() => [])",
    'findAlias(context.memberOwner, context.aliases)',
    'findColumnsForOwner(',
    'tableObjectKey(connectionId, schema, table.name)',
    'schema.name === preferredSchema ? `0_schema_',
    'item.schema === preferredSchema ? `0_table_',
    'schema === preferredSchema ? `0_function_',
    'showSystemObjects || !isSystemSchema(driverType, schema.name)',
    'showSystemObjects || !isSystemSchema(driverType, schema)',
    'catalogSchemaPaths[connectionId]',
  ],
  'schema-aware completion behavior',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:schema-aware-completion', 'scripts/schema-aware-completion-smoke.mjs'],
  'schema-aware completion smoke registration',
)

if (failures.length > 0) {
  console.error('Schema-aware completion smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Schema-aware completion smoke passed.')
