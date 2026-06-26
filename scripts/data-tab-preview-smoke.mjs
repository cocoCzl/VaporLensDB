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
    'kind?:',
    "| 'sql'",
    "| 'data'",
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
    "t('explorer.openRows'",
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
    "t('workbench.readOnlyDataPreview')",
    'max={10_000}',
    "t('workbench.dataPreviewLimitTitle')",
    'updateDataTabContext',
    'buildDataTabSql',
    '<DataGrid',
    'result={result}',
  ],
  'read-only data tab rendering',
)

const settings = read('src/components/settings/SettingsWorkspacePanel.tsx')
includesAll(
  settings,
  [
    "type SettingsDraft",
    "const [draft, setDraft]",
    'hasSettingsChanges',
    'applySettingsDraft',
    'discardSettingsDraft',
    'restoreDefaultSettingsDraft',
    "t('settings.apply')",
    "t('settings.discard')",
    "t('settings.restoreDefaults')",
    "t('settings.language.zh')",
    "t('settings.language.en')",
    'SegmentButton',
    "updateDraft({ language: 'zh' })",
    "updateDraft({ language: 'en' })",
    'DEFAULT_QUERY_MAX_ROWS',
    'DEFAULT_DATA_PREVIEW_ROWS',
    'DEFAULT_EDITOR_FONT_SIZE',
    'defaultValue={DEFAULT_DATA_PREVIEW_ROWS}',
    'presets={[50, 100, 200, 500, 1_000]}',
    "t('settings.dataPreviewRows')",
    'setDataPreviewDefaultRows(draft.dataPreviewDefaultRows)',
  ],
  'settings panel',
)
assert(!settings.includes('<select\\n                      className="ide-select"'), 'language setting should not use the native select control')

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
