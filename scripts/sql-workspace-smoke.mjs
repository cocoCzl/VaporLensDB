import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const assert = (condition, message) => { if (!condition) failures.push(message) }

const panel = read('src/components/layout/MainPanel.tsx')
const toolbar = read('src/components/editor/EditorToolbar.tsx')
const workspace = read('src/components/workspace/SqlWorkspace.tsx')
const results = read('src/components/workspace/ResultPanel.tsx')
const store = read('src/stores/uiStore.ts')

assert(panel.includes('<SqlWorkspace view={workspaceView}>'), 'SQL workspace must use the dedicated workspace frame')
assert(panel.includes('<ResultPanel'), 'SQL workspace must use the dedicated result panel shell')
assert(panel.includes("workspaceView === 'results'"), 'SQL workspace must support maximizing results')
assert(panel.includes('<EmptyState className="h-full"'), 'unexecuted SQL tabs must use the compact empty state')
assert(panel.includes("className={resultResizing ? 'ide-splitter ide-splitter--dragging'"), 'splitter must distinguish dragging from resting state')
assert(toolbar.includes('<SqlMoreActions'), 'secondary SQL actions must be consolidated into More')
assert(toolbar.includes("<Button type=\"button\" size=\"sm\" disabled={disabled}"), 'Run must remain an explicit primary action')
assert(toolbar.includes("t('editor.maximizeResults')") && toolbar.includes("t('editor.restoreSplit')"), 'More must expose workspace layout controls')
assert(workspace.includes('SqlWorkspaceView') && workspace.includes('editor/results spatial relationship'), 'workspace frame must own the editor/result layout contract')
assert(results.includes('data-first shell') && results.includes('fillAvailableSpace'), 'result panel must support normal and maximized layouts')
assert(store.includes('DEFAULT_RESULT_PANEL_HEIGHT = 520'), 'new workspaces must give results a larger default share')
assert(!panel.includes("t('workbench.lightSqlInput')"), 'SQL workspace must not retain a permanent editor helper bar')

if (failures.length) {
  console.error('SQL workspace smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('SQL workspace smoke passed.')
