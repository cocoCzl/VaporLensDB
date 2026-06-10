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

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'selectCurrentDatabase',
    'selectDefaultSchema',
    'schemaCategoryNodes',
    'objectCategoryFolders',
    'metadata.loadSchemas(activeConnectionId, database.name, force)',
    'metadata.setCatalogSchemaPath',
    "connection?.driverType === 'postgres' ? 'public'",
    "connection?.driverType === 'oracle' ? username?.toUpperCase()",
    "activeConnection?.driverType === 'mysql'",
  ],
  'catalog/schema auto-expand path',
)
includesAll(
  databaseTree,
  [
    "label: 'Tables'",
    "label: 'Views'",
    "label: 'Materialized Views'",
    "label: 'Packages'",
  ],
  'fixed category folders',
)

const metadataStore = read('src/stores/metadataStore.ts')
includesAll(
  metadataStore,
  ['CatalogSchemaPath', 'catalogSchemaPaths', 'setCatalogSchemaPath', 'omitByPrefix(state.catalogSchemaPaths, connectionId)'],
  'metadata path cache',
)

if (failures.length > 0) {
  console.error('Object Tree auto path smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree auto path smoke passed.')
