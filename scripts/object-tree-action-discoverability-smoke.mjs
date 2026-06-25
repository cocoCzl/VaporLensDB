import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} missing: ${value}`)
  }
}

const treeNode = read('src/components/explorer/TreeNode.tsx')
includesAll(
  treeNode,
  [
    'export interface TreeNodeQuickAction',
    "icon: 'data' | 'structure' | 'ddl'",
    'QUICK_ACTION_ICONS',
    'PanelRightOpen',
    'group-hover:opacity-100',
    'group-focus-within:opacity-100',
    'action.onSelect()',
    'aria-label={action.label}',
  ],
  'object tree quick action node UI',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'setShowSystemObjects',
    'title="刷新对象"',
    "title={showSystemObjects ? '隐藏系统对象' : '显示系统对象'}",
    'onClick={() => setShowSystemObjects(!showSystemObjects)}',
    'placeholder="搜索对象"',
    'function openObjectSummary(node: NodeRecord | undefined)',
    "tab.kind === 'objectSummary'",
    "kind: 'objectSummary'",
    'objectSummaryContext',
    'type TreeNodeQuickAction',
    'function quickActions(node: NodeRecord): TreeNodeQuickAction[]',
    'isTableLikeNode(node)',
    "id: 'open-data'",
    "id: 'open-structure'",
    "id: 'view-ddl'",
    'void openTableData(node.id)',
    'openTableStructure(node.id)',
    'openTableDdl(node.id)',
    'quickActions={quickActions(nodes[node.id])}',
  ],
  'object tree quick action wiring',
)
assert(!databaseTree.includes('title="连接"'), 'Object Tree toolbar should not expose connection switching')
assert(!databaseTree.includes('placeholder="搜索连接"'), 'Object Tree search should not search connections')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:object-tree-action-discoverability', 'scripts/object-tree-action-discoverability-smoke.mjs'],
  'object tree action discoverability smoke registration',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "activeTab.kind === 'objectSummary'",
    'ObjectSummaryTabPanel',
    'onOpenDataPreview',
    "kind: 'data'",
    "kind: 'structure'",
    "kind: 'definition'",
    "kind: 'diagram'",
    'void inspectTable(',
    'Preview data',
    'Structure',
    'DDL',
    'Inspector',
    'ER Diagram',
  ],
  'object summary workspace panel',
)

const editorStore = read('src/stores/editorStore.ts')
includesAll(
  editorStore,
  ["'objectSummary'", 'ObjectSummaryContext', 'objectSummaryContext'],
  'object summary tab contract',
)

if (failures.length > 0) {
  console.error('Object Tree action discoverability smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Object Tree action discoverability smoke passed.')
