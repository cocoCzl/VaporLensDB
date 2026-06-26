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

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'showAllSchemasActionNode',
    "t('explorer.folders.showAllSchemas')",
    "action?: 'showAllSchemas'",
    "node.meta?.action === 'showAllSchemas'",
    'showAllSchemas(node)',
    'childrenLoaded && !force',
    'expanded: false',
    "t('explorer.searchAll')",
    "t('explorer.loadedFilterDetail')",
    'indexSearchActive',
    'searchAllMetadata',
    'await searchIndex(query, activeConnectionId)',
    'loadedNodes.filter',
  ],
  'safe schema expansion and loaded-tree search',
)
excludesAll(
  databaseTree,
  ['window.setTimeout'],
  'object tree search input must not auto-query global index',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:object-tree-schema-search', 'scripts/object-tree-schema-search-smoke.mjs'],
  'schema search smoke script registration',
)

if (failures.length > 0) {
  console.error('Object Tree schema/search smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree schema/search smoke passed.')
