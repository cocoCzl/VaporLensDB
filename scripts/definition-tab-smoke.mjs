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

const editorStore = read('src/stores/editorStore.ts')
includesAll(
  editorStore,
  [
    "kind?:",
    "| 'sql'",
    "| 'data'",
    "| 'structure'",
    "| 'definition'",
    'definitionContext?: DefinitionTabContext | null',
    'export interface DefinitionTabContext',
    "definitionKind: 'DDL' | 'Source'",
    "operation: 'tableDdl' | 'objectDdl'",
  ],
  'definition tab editor contract',
)

const sqlEditor = read('src/components/editor/SqlEditor.tsx')
includesAll(
  sqlEditor,
  [
    'readOnly?: boolean',
    'readOnly = false',
    'if (!readOnly)',
    'readOnly,',
    'domReadOnly: readOnly',
  ],
  'read-only SQL editor',
)

const metadataService = read('src-tauri/src/services/metadata_service.rs')
includesAll(
  metadataService,
  [
    'force: bool',
    'if !force',
    'if let Some(cached)',
    '["schema", schema, "table", table, "ddl"]',
    '["schema", schema, "object", name, &kind_key, "ddl"]',
  ],
  'definition cache and force refresh',
)

const metadataCommand = read('src-tauri/src/commands/metadata.rs')
includesAll(
  metadataCommand,
  ['force: Option<bool>', 'force.unwrap_or(false)'],
  'definition command force option',
)

const metadataIpc = read('src/ipc/metadata.ts')
includesAll(
  metadataIpc,
  [
    'force = false',
    '{ connectionId, schema, table, force }',
    '{ connectionId, schema, name, kind, force }',
  ],
  'definition IPC force option',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    "kind: 'definition'",
    'definitionContext:',
    "operation: 'tableDdl'",
    "operation: 'objectDdl'",
    'sourceLikeObjectKind',
    "t('explorer.viewDdlSource')",
  ],
  'object tree definition actions',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "activeTab.kind === 'definition'",
    '<DefinitionTabPanel',
    'getTableDdl(tab.connectionId, context.schema, context.object, force)',
    'getObjectDdl(',
    'readOnly',
    "t('common.copy')",
    "t('workbench.openInSqlTab')",
    "t('workbench.refreshDefinition'",
    'DefinitionError',
    "t('workbench.definitionFailureReason')",
  ],
  'definition tab panel',
)
excludesAll(
  mainPanel.slice(mainPanel.indexOf('function DefinitionTabPanel')),
  ['<EditorToolbar'],
  'definition tab must not show execution toolbar',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:definition-tab', 'scripts/definition-tab-smoke.mjs'],
  'definition smoke script registration',
)

if (failures.length > 0) {
  console.error('Definition tab smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Definition tab smoke passed.')
