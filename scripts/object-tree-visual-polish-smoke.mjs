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
    'Database',
    'ListTree',
    'Folder',
    'table: Table2',
    'view: Eye',
    'materializedView: Layers3',
    'procedure: SquareCode',
    'function: FunctionSquare',
    'package: Package',
    'trigger: Zap',
    'index: KeyRound',
    'foreignKey: KeyRound',
    'TriangleAlert',
    'DatabaseObjectGlyph',
    'databaseGlyphContent',
    'DATABASE_OBJECT_KINDS',
    "node.detail?.toUpperCase() === 'INVALID'",
    "muted) return 'text-muted-foreground/50'",
    'nodeIconTone',
  ],
  'object tree icon and status polish',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'Server',
    '<Server className="size-4 shrink-0 text-muted-foreground" />',
    "detail: status && status !== 'VALID' ? status : undefined",
    'muted: isSystemSchema',
    'isSystemDatabase',
  ],
  'object tree connection and system visual state',
)
excludesAll(
  databaseTree,
  ['rowCount', 'row count', 'table size', 'tableSize'],
  'object tree must not show table row count or size',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:object-tree-visual-polish', 'scripts/object-tree-visual-polish-smoke.mjs'],
  'visual polish smoke registration',
)

if (failures.length > 0) {
  console.error('Object Tree visual polish smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree visual polish smoke passed.')
