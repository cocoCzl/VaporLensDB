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
    'emptyCategoryNode',
    'errorCategoryNode',
    'No ${parent.label}',
    'Load failed',
    'children.length === 0 && isObjectCategoryNode(node)',
    'setChildIds((state) => ({ ...state, [id]: [errorNode.id] }))',
    'clearNodeMetadataCache(node)',
    'metadata.clearConnection(activeConnectionId)',
    'metadata.clearSchema(activeConnectionId, node.meta.schema)',
    'metadata.clearSchemaObjectKind(activeConnectionId, node.meta.schema, kind)',
  ],
  'object tree lazy states',
)

const metadataStore = read('src/stores/metadataStore.ts')
includesAll(
  metadataStore,
  [
    'clearSchema:',
    'clearSchemaObjectKind:',
    'schemaObjectKindKey(connectionId, schema, kind)',
    'schemaObjectKey(connectionId, schema)',
  ],
  'metadata refresh cache clearing',
)

if (failures.length > 0) {
  console.error('Object Tree lazy state smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree lazy state smoke passed.')
