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
    'catalogSchemaPaths',
    'setCatalogSchemaPath',
    'catalogSchemaPath?.database',
    'catalogSchemaPath?.schema',
    'onDatabaseChange={(database) =>',
    'schema: null',
    'onSchemaChange={(schema) =>',
    'schema={selectedSchema}',
    'driverType={activeDriverType}',
    'showSystemObjects={showSystemObjects}',
  ],
  'toolbar-driven catalog/schema context',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'const activePath = activeConnectionId ? metadata.catalogSchemaPaths[activeConnectionId] : null',
    'activePath?.database',
    'activePath?.schema',
    'selectCurrentDatabase(',
    'activePath?.database',
    "activeConnection?.driverType === 'postgres'\n          ? activeConnection.database",
    'selectDefaultSchema(activeConnection, schemas, activePath?.schema)',
    'defaultSchemaName = schema.name',
    'function selectNode(nodeId: string)',
    'metadata.setCatalogSchemaPath({',
    'onSelect={selectNode}',
  ],
  'object tree catalog/schema path linkage',
)

includesAll(
  mainPanel,
  [
    "activeDriverType === 'postgres'",
    "? activeConnection?.database ?? null",
    "? [{ name: activeConnection.database }]",
  ],
  'PostgreSQL toolbar is scoped to the active connection database',
)

const sourceBundle = [
  'src/components/layout/MainPanel.tsx',
  'src/components/explorer/DatabaseTree.tsx',
  'src/components/editor/AutoComplete.ts',
  'src/hooks/useQuery.ts',
  'src/ipc/query.ts',
].map(read).join('\n')
excludesAll(
  sourceBundle,
  ['ALTER SESSION SET CURRENT_SCHEMA', 'SET search_path', 'USE ${', 'USE `', 'USE "'],
  'catalog/schema linkage must not execute implicit session SQL',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:catalog-schema-linkage', 'scripts/catalog-schema-linkage-smoke.mjs'],
  'catalog/schema linkage smoke registration',
)

if (failures.length > 0) {
  console.error('Catalog/schema linkage smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Catalog/schema linkage smoke passed.')
