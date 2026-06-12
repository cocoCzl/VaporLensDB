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

const editorStore = read('src/stores/editorStore.ts')
includesAll(
  editorStore,
  [
    "kind?: 'sql' | 'data'",
    'DataTabContext',
    'dataContext?: DataTabContext | null',
    'updateDataTabLimit',
    "kind: 'sql'",
  ],
  'editor data tab model',
)

const uiStore = read('src/stores/uiStore.ts')
includesAll(
  uiStore,
  [
    'DEFAULT_DATA_PREVIEW_ROWS = 200',
    'dataPreviewDefaultRows',
    'setDataPreviewDefaultRows',
    'clampNumber(dataPreviewDefaultRows, 1, 10_000)',
  ],
  'data preview default setting',
)

const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
includesAll(
  databaseTree,
  [
    'dataPreviewDefaultRows',
    "kind: 'data'",
    'dataContext:',
    'objectKind:',
    'limit: dataPreviewDefaultRows',
    '`打开前 ${dataPreviewDefaultRows} 行`',
  ],
  'object tree opens data tabs',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "activeTab.kind === 'data'",
    'DataTabPanel',
    'read-only',
    '只读数据预览',
    'max={10_000}',
    '数据预览行数过大',
    'updateDataTabContext',
    'buildDataTabSql',
    '<DataGrid',
    'result={result}',
  ],
  'read-only data tab rendering',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(sidebar, ["t('settings.dataPreviewRows')", 'setDataPreviewDefaultRows'], 'settings panel')

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(zh, ['"dataPreviewRows": "数据预览默认行数"'], 'Chinese data preview locale')
includesAll(en, ['"dataPreviewRows": "Default data preview rows"'], 'English data preview locale')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:data-tab-preview', 'scripts/data-tab-preview-smoke.mjs'],
  'data tab smoke script registration',
)

if (failures.length > 0) {
  console.error('Data tab preview smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Data tab preview smoke passed.')
