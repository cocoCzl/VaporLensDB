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
const dataTabSql = read('src/lib/dataTabSql.ts')
includesAll(
  databaseTree,
  [
    'tooltip:',
    'rawPath',
    "t('explorer.copyName')",
    "t('explorer.copyQualifiedName')",
    'qualifiedNodeName',
    "driverType === 'mysql' ? '`' : '\"'",
    'quoteIdentifier',
    'node.label.toLowerCase().includes(normalizedFilter)',
    'detail?.toLowerCase().includes(normalizedFilter)',
    'label: name',
  ],
  'object tree naming and quoting',
)
includesAll(
  dataTabSql,
  ['quoteIdentifier', 'value.replaceAll(quote, `${quote}${quote}`)'],
  'shared quoted identifier helper',
)

const treeNode = read('src/components/explorer/TreeNode.tsx')
includesAll(treeNode, ['tooltip?: string', 'title={node.tooltip ?? node.detail ?? node.label}'], 'node tooltip')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:object-tree-naming', 'scripts/object-tree-naming-smoke.mjs'],
  'naming smoke script registration',
)

if (failures.length > 0) {
  console.error('Object Tree naming smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree naming smoke passed.')
