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
    'connectionStatusSummary',
    "t('explorer.browseAfterConnect')",
    "t('connection.failed')",
    "t('explorer.editConnection')",
    "t('explorer.missingExternalDriver')",
    "t('explorer.importDriver')",
    'requiresExternalDriver',
    'canSearchCurrentConnection',
    'searchAllMetadata',
  ],
  'object tree lifecycle',
)

const connectionStore = read('src/stores/connectionStore.ts')
includesAll(
  connectionStore,
  [
    "status: 'failed'",
    'activeConnectionId: id',
    'useMetadataStore.getState().clearConnection(id)',
  ],
  'connection lifecycle store',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(sidebar, ['setActiveConnection(connection.id)'], 'left connection selection')
excludesAll(
  sidebar,
  ['updateTabConnection', 'ensureTab'],
  'left connection selection must not rewrite SQL tabs',
)

if (failures.length > 0) {
  console.error('Object Tree lifecycle smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree lifecycle smoke passed.')
