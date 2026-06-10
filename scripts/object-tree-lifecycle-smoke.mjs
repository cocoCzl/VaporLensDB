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
    '连接后浏览对象',
    '连接失败',
    '编辑连接',
    '缺少外部驱动',
    '导入驱动',
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

const connectionList = read('src/components/connection/ConnectionList.tsx')
includesAll(connectionList, ['setActiveConnection(id)'], 'left connection selection')
excludesAll(
  connectionList,
  ['updateTabConnection', 'ensureTab', 'activeTabId'],
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
