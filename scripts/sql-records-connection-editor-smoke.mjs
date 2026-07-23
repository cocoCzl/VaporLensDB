import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const assert = (condition, message) => { if (!condition) failures.push(message) }

const mainPanel = read('src/components/layout/MainPanel.tsx')
for (const marker of [
  "const [statusFilter, setStatusFilter] = useState<'all' | QueryHistoryStatus>('all')",
  "const [timeRange, setTimeRange] = useState<'all' | 'day' | 'week' | 'month'>('all')",
  "const [sortDirection, setSortDirection] = useState<'newest' | 'oldest'>('newest')",
  "loadHistory(500)",
  "<ConnectionEditorPanel",
  "window.matchMedia('(max-width: 959px)')",
  "<SheetContent side=\"right\"",
  "t('connectionForm.discardChanges')",
  "t('connection.manageDataSources')",
  "<FolderPlus className=\"size-4\" />",
  "groupCreatorOpen",
  "t('connection.createGroup')",
]) assert(mainPanel.includes(marker), `MainPanel missing: ${marker}`)
assert(!mainPanel.includes("label={t('connection.new')} variant=\"secondary\" onClick={() => requestEditor({ mode: 'new', connectionId: null })}"), 'manager header must not duplicate the global new connection action')
assert(!mainPanel.includes("label={t('connection.refresh')}\n            variant=\"ghost\"\n            disabled={loading}"), 'manager header must not duplicate the saved-connections reload action')

const list = read('src/components/connection/ConnectionList.tsx')
assert(list.includes('onManagerSelect?: (connection: ConnectionConfig) => void'), 'manager list must expose an independent editor selection callback')
assert(list.includes('onEdit={managerMode && onManagerSelect'), 'manager edit action must select the detail editor rather than open a dialog')
assert(list.includes('role="checkbox"'), 'manager batch selection must use the themed checkbox control')
assert(!list.includes('accent-primary'), 'manager batch selection must not use the browser-native checkbox appearance')

const connectionEditor = read('src/components/connection/ConnectionEditorPanel.tsx')
assert(connectionEditor.includes("t('connection.selectToEdit')"), 'detail panel must distinguish no selection from an empty data-source list')

const objectTree = read('src/components/explorer/DatabaseTree.tsx')
assert(objectTree.includes("h-[clamp(19rem,45vh,30rem)]"), 'compact object tree must have a useful default height')
assert(objectTree.includes('resize-y'), 'compact object tree must be vertically resizable')
assert(!objectTree.includes('max-h-80'), 'compact object tree must not be limited to 320px')

const form = read('src/components/connection/ConnectionForm.tsx')
assert(form.includes("layout?: 'dialog' | 'panel'"), 'connection form must support a reusable panel layout')
assert(form.includes('onDirtyChange?: (dirty: boolean) => void'), 'connection form must report unsaved changes')

if (failures.length) {
  console.error('SQL records and connection editor smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log('SQL records and connection editor smoke passed.')
