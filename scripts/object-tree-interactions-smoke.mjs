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

const treeNode = read('src/components/explorer/TreeNode.tsx')
includesAll(
  treeNode,
  [
    'selected?: boolean',
    'data-selected',
    'aria-selected',
    'role="treeitem"',
    'onClick={() => onSelect?.(node.id)}',
    'onDoubleClick?.(node.id)',
    'onNodeKeyDown?.(node, event)',
  ],
  'tree node selection and keyboard hooks',
)
excludesAll(
  treeNode,
  ['onClick={() => node.expandable && onToggle(node.id)}'],
  'single click must not toggle',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'selectedNodeId',
    'moveSelection',
    'handleNodeKeyDown',
    "event.key === 'ArrowDown'",
    "event.key === 'ArrowUp'",
    "event.key === 'Enter'",
    "event.key === ' '",
    "event.key === 'F5'",
    "event.key.toLowerCase() === 'r'",
    "event.key.toLowerCase() === 'c'",
    'openTableData(nodeId)',
    'openGenericObjectDdl(nodeId)',
    'toggleNode(nodeId)',
    '生成 SELECT',
    'selectSql',
    '打开 Object Inspector',
    '打开 Structure Tab',
    '查看 DDL/Source',
    '复制全限定名',
    '设为当前 Schema',
    'role="tree"',
  ],
  'object tree interactions',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:object-tree-interactions', 'scripts/object-tree-interactions-smoke.mjs'],
  'interactions smoke script registration',
)

if (failures.length > 0) {
  console.error('Object Tree interactions smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree interactions smoke passed.')
