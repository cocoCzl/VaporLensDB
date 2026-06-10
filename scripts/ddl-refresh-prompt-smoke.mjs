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

const useQuery = read('src/hooks/useQuery.ts')
includesAll(
  useQuery,
  [
    'if (containsLikelyDdl(sql)) {',
    "title: '对象结构可能已变化'",
    "message: '可手动刷新对象树、Structure tab 或 DDL/Source tab。'",
    'function containsLikelyDdl(sql: string)',
    "normalized.startsWith('create ')",
    "normalized.startsWith('alter ')",
    "normalized.startsWith('drop ')",
    "normalized.startsWith('truncate ')",
    "normalized.startsWith('rename ')",
  ],
  'DDL success refresh prompt',
)
excludesAll(
  useQuery,
  ['loadRoot(', 'clearConnection(', 'clearSchema(', 'clearSchemaObjectKind('],
  'DDL success must not auto-refresh metadata',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  ['刷新结构', '刷新 ${context.definitionKind}'],
  'manual refresh affordances for structure and definition tabs',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:ddl-refresh-prompt', 'scripts/ddl-refresh-prompt-smoke.mjs'],
  'DDL prompt smoke registration',
)

if (failures.length > 0) {
  console.error('DDL refresh prompt smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('DDL refresh prompt smoke passed.')
