import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const assert = (condition, message) => { if (!condition) failures.push(message) }

const panel = read('src/components/layout/MainPanel.tsx')
assert(panel.includes('await connectConnection(connectionId, { selectForBrowsing: false })'), 'run and explain must connect a bound disconnected data source on demand')
assert(!panel.includes('connectionIsConnected &&\n      queryCapabilities.canQuery'), 'run button must not be disabled only because the saved data source is disconnected')
assert(panel.includes('initialConnectionFilter={activeTab.recordsConnectionFilter ?? null}'), 'history workspace must receive its requested data-source scope')

const toolbar = read('src/components/editor/EditorToolbar.tsx')
assert(toolbar.includes('title={`${t(\'editor.run\')} (${runShortcut})`}'), 'run button must be a direct native button with a visible hint')
assert(toolbar.includes('onClick={() => onRun()}'), 'run button must not pass its MouseEvent as the SQL override')
assert(toolbar.includes('onClick={() => onExplain()}'), 'explain button must not receive a browser event argument')
assert(toolbar.includes('onClick={() => onFormat()}'), 'format button must not receive a browser event argument')
assert(toolbar.includes('disabled={formatDisabled || running}'), 'format must not depend on connection readiness')

const tabBar = read('src/components/layout/TabBar.tsx')
assert(tabBar.includes("<FileCode2 />"), 'tab bar must expose SQL scripts with a direct workspace icon')
assert(tabBar.includes("onClick={() => openRecordsWorkspace('sqlScripts')}"), 'SQL scripts icon must open the complete scripts workspace directly')
assert(!tabBar.includes('recentOpen'), 'tab bar must not retain the duplicate recent SQL popup')
assert(tabBar.includes("openRecordsWorkspace('queryHistory')"), 'tab bar must expose query history directly')
assert(tabBar.includes("return 'bg-emerald-500'"), 'connected tabs must be green')
assert(tabBar.includes("return 'bg-muted-foreground/40'"), 'disconnected tabs must be gray')

if (failures.length) {
  console.error('SQL execution and recall smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('SQL execution and recall smoke passed.')
