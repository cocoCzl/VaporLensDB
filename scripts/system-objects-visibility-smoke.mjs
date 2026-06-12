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

const systemObjects = read('src/lib/systemObjects.ts')
includesAll(
  systemObjects,
  [
    'pg_catalog',
    'information_schema',
    'pg_toast',
    'performance_schema',
    'SYS',
    'SYSTEM',
    'XDB',
    'MDSYS',
    'CTXSYS',
    'AUDSYS',
    'isSystemDatabase',
    'isSystemSchema',
  ],
  'system object rules',
)

const uiStore = read('src/stores/uiStore.ts')
includesAll(
  uiStore,
  [
    'showSystemObjects: boolean',
    'setShowSystemObjects',
    'parsed.showSystemObjects === true',
  ],
  'show system objects setting',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'filterDatabases',
    'filterSchemas',
    'showSystemObjects',
    'isSystemDatabase',
    'isSystemSchema',
    "'system'",
    'muted:',
  ],
  'object tree system filtering',
)

const treeNode = read('src/components/explorer/TreeNode.tsx')
includesAll(treeNode, ['muted?: boolean', 'data-muted', 'text-muted-foreground'], 'muted system nodes')

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  ['filterCompletionSchemas', 'showSystemObjects', 'isSystemSchema'],
  'completion system filtering',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(sidebar, ["t('settings.showSystemObjects')", 'setShowSystemObjects', 'type="checkbox"'], 'settings toggle')

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(zh, ['"showSystemObjects": "显示系统对象"'], 'Chinese system object locale')
includesAll(en, ['"showSystemObjects": "Show system objects"'], 'English system object locale')

if (failures.length > 0) {
  console.error('System objects visibility smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('System objects visibility smoke passed.')
