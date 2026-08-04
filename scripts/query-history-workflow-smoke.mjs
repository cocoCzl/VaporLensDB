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

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(
  sidebar,
  [
    'historyStatusFilter',
    'historyConnectionFilter',
    'filteredHistory',
    'historyFilteredEmpty',
    'uniqueHistoryConnections',
    'expandedHistoryId',
    'historySqlPreview',
    'historyErrorPreview',
    'connectionNameSnapshot',
  ],
  'query history workflow UI',
)

const en = read('src/locales/en.json')
const zh = read('src/locales/zh.json')
includesAll(
  en,
  [
    'historyStatusFilter',
    'historyConnectionFilter',
    'historyFilterSuccess',
    'historyFilterFailed',
    'historyErrorPreview',
    'clearHistoryDescription',
    'clearDraftsDescription',
    'draftsCleared',
    'recordCount',
    'searchRecords',
    'searchHistory',
    'searchScripts',
    'historyFilterAllStatus',
    'recordSql',
    'recordSourceTime',
  ],
  'query history English locale',
)
includesAll(
  zh,
  [
    'historyStatusFilter',
    'historyConnectionFilter',
    'historyFilterSuccess',
    'historyFilterFailed',
    'historyErrorPreview',
    'clearHistoryDescription',
    'clearDraftsDescription',
    'draftsCleared',
    'recordCount',
    'searchRecords',
    'searchHistory',
    'searchScripts',
    'historyFilterAllStatus',
    'recordSql',
    'recordSourceTime',
  ],
  'query history Chinese locale',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    'uniqueRecordConnections(entries, connections)',
    'selectedConnectionFilter',
    'clearDialogOpen',
    'clearDrafts',
    'clearLabel',
    'clearDescription',
    "mode === 'scripts'",
    "t('sql.clearHistoryDescription'",
    "t('sql.recordCount'",
    'variant="ide"',
    "t('sql.historyFilterAllStatus')",
    "t('sql.recordSourceTime')",
  ],
  'query history records workspace',
)

const appSelect = read('src/components/ui/app-select.tsx')
includesAll(
  appSelect,
  [
    "variant?: 'default' | 'toolbar' | 'ide'",
    'const selectedLabel',
    '<SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>',
    "'ide-combobox-content max-h-56 min-w-0 rounded-md border p-1'",
    "variant === 'ide' ? 'ide-combobox-content max-h-56 min-w-[7rem] rounded-md border p-1'",
    "'ide-combobox-item rounded-[4px] px-2.5'",
    'const useIdeSkin = variant !== \'toolbar\'',
    'alignItemWithTrigger={false}',
  ],
  'toolbar select localization',
)

const styles = read('src/styles/globals.css')
includesAll(
  styles,
  [
    '--ide-combo-surface',
    '--ide-combo-menu',
    '.ide-combobox-trigger',
    '.ide-combobox-content',
    '.ide-combobox-item[data-selected]',
  ],
  'IDE combobox theme tokens',
)

const select = read('src/components/ui/select.tsx')
includesAll(
  select,
  [
    'w-(--anchor-width) min-w-0',
    'data-slot="select-item-text"',
    'min-w-0 flex-1 gap-2 truncate',
  ],
  'equal-width select menu foundation',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:query-history-workflow', 'scripts/query-history-workflow-smoke.mjs'],
  'query history workflow smoke registration',
)

if (failures.length > 0) {
  console.error('Query history workflow smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Query history workflow smoke passed.')
