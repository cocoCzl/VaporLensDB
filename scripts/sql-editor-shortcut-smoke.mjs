import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const sqlEditor = readFileSync(resolve(root, 'src/components/editor/SqlEditor.tsx'), 'utf8')
assert(sqlEditor.includes('const onRunRef = useRef(onRun)'), 'shortcut must retain the latest run callback')
assert(sqlEditor.includes('onRunRef.current(sqlAtCursor(instance))'), 'shortcut must execute editor selection or cursor statement')
assert(sqlEditor.includes('function statementAtOffset(sql: string, offset: number)'), 'cursor statement extraction is missing')
assert(sqlEditor.includes("character === ';' && !inSingleQuote && !inDoubleQuote"), 'statement splitting must ignore quoted semicolons')
assert(sqlEditor.includes('if (inLineComment)') && sqlEditor.includes('if (inBlockComment)'), 'statement splitting must ignore comment semicolons')
assert(sqlEditor.includes('statementBeforeTrailingDelimiter'), 'cursor after a statement delimiter must execute the preceding statement')

const mainPanel = readFileSync(resolve(root, 'src/components/layout/MainPanel.tsx'), 'utf8')
assert(mainPanel.includes('async function execute(sqlOverride?: string)'), 'SQL execution must accept shortcut SQL')
assert(mainPanel.includes('const sql = (sqlOverride ?? sqlToRun()).trim()'), 'toolbar execution must retain its existing SQL selection behavior')
assert(mainPanel.includes('function sqlForToolbarExecution('), 'toolbar execution must choose a script when no SQL is selected')
assert(mainPanel.includes('selectedSql.sql.trim() ? selectedSql.sql : tab.sql'), 'empty selections must fall back to the full SQL script')

const toolbar = readFileSync(resolve(root, 'src/components/editor/EditorToolbar.tsx'), 'utf8')
assert(toolbar.includes('IconTooltipButton'), 'SQL toolbar actions must be icon buttons with tooltips')
assert(toolbar.includes('ChartNoAxesCombined'), 'query plan must use a dedicated icon')
assert(toolbar.includes("t('editor.explain')"), 'query plan label must be localized')

const iconButton = readFileSync(resolve(root, 'src/components/common/IconTooltipButton.tsx'), 'utf8')
assert(iconButton.includes('TooltipContent'), 'icon actions must provide hover explanations')
assert(iconButton.includes('aria-label={label}'), 'icon actions must provide accessible labels')
assert(mainPanel.includes('label={t(\'sql.history\')}'), 'result history must be an icon action')
assert(mainPanel.includes('label={t(\'workbench.exportCsv\')}'), 'result export must be an icon action')

const dataGrid = readFileSync(resolve(root, 'src/components/grid/DataGrid.tsx'), 'utf8')
assert(dataGrid.includes("t('result.noRows')"), 'empty result grids must show a zero-row state')

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
assert(packageJson.includes('test:sql-editor-shortcut'), 'shortcut smoke script must be registered')

if (failures.length > 0) {
  console.error('SQL editor shortcut smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('SQL editor shortcut smoke passed.')
