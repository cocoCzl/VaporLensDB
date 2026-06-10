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
    'OBJECT_CATEGORY_ORDER',
    "label: 'Tables'",
    "label: 'Views'",
    "label: 'Materialized Views'",
    "label: 'Indexes'",
    "label: 'Procedures'",
    "label: 'Functions'",
    "label: 'Packages'",
    "label: 'Sequences'",
    "label: 'Triggers'",
    "label: 'Synonyms'",
    "label: 'Events'",
  ],
  'object category labels',
)

const orderedLabels = [
  "label: 'Tables'",
  "label: 'Views'",
  "label: 'Materialized Views'",
  "label: 'Indexes'",
  "label: 'Procedures'",
  "label: 'Functions'",
  "label: 'Packages'",
  "label: 'Sequences'",
  "label: 'Triggers'",
  "label: 'Synonyms'",
  "label: 'Events'",
]
let previous = -1
for (const label of orderedLabels) {
  const index = databaseTree.indexOf(label)
  assert(index > previous, `category order mismatch at ${label}`)
  previous = index
}

includesAll(
  databaseTree,
  [
    "drivers: ['postgres', 'mysql', 'oracle']",
    "drivers: ['postgres', 'oracle']",
    "drivers: ['mysql']",
    'objectCategoryFolders(driverType)',
  ],
  'category driver support',
)

const metadataTypes = read('src/types/metadata.ts')
const treeNode = read('src/components/explorer/TreeNode.tsx')
const rustMetadata = read('src-tauri/src/models/metadata.rs')
const jdbcDriver = read('src-tauri/src/drivers/jdbc.rs')
includesAll(metadataTypes, ["| 'event'"], 'typescript metadata event kind')
includesAll(treeNode, ["| 'event'", 'CalendarClock', 'event: CalendarClock'], 'tree event icon')
includesAll(rustMetadata, ['Event,'], 'rust metadata event kind')
includesAll(jdbcDriver, ['DbObjectKind::Event => "event"', '"event" => DbObjectKind::Event'], 'jdbc event mapping')

if (failures.length > 0) {
  console.error('Object Category model smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Category model smoke passed.')
