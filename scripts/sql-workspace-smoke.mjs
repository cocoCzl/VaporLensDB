import { verifyBehavior } from './verify-behavior.mjs'
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
// Reveal/compact-height contracts are exercised on the actual pane hook below.
assert(panel.includes("setWorkspaceView('results')"), 'maximizing results must use the explicit results-only state transition')
assert(panel.includes('useSqlPaneLayout('), 'SQL execution must use the tested tab-local layout')
assert(panel.includes("className={resultResizing ? 'ide-splitter ide-splitter--dragging'"), 'splitter must distinguish dragging from resting state')
assert(toolbar.includes('<SqlMoreActions'), 'secondary SQL actions must be consolidated into More')
assert(toolbar.includes('<PopoverContent align="end" className="w-60 gap-0 p-1.5">'), 'SQL More Actions must override the shared popover gap without changing nested popovers')
assert(toolbar.includes('aria-label={`${label}: ${currentValue}`}') && toolbar.includes('<span>{currentValue}</span><ChevronDown'), 'row limit control must expose its current value and menu affordance')
assert(toolbar.includes('<span>{modeLabel}</span><ChevronDown') && toolbar.includes("variant=\"outline\" className=\"border-border/70 bg-surface disabled:border-border/55"), 'transaction controls must expose the current mode and visible button boundaries')
assert(toolbar.includes("<Button type=\"button\" size=\"sm\" disabled={disabled || contextDisabled}"), 'Run must remain an explicit primary action')
assert(toolbar.includes("t('editor.maximizeResults')") && toolbar.includes("t('editor.restoreSplit')"), 'More must expose workspace layout controls')
assert(workspace.includes('SqlWorkspaceView') && workspace.includes('editor/results spatial relationship'), 'workspace frame must own the editor/result layout contract')
assert(results.includes('data-first shell') && results.includes('fillAvailableSpace'), 'result panel must support normal and maximized layouts')
assert(results.includes('const contentVisible = !collapsed || fillAvailableSpace'), 'results-only view must render its body even if split view was persisted as collapsed')
assert(store.includes('DEFAULT_RESULT_PANEL_HEIGHT = 520'), 'new workspaces must give results a larger default share')
assert(!panel.includes("t('workbench.lightSqlInput')"), 'SQL workspace must not retain a permanent editor helper bar')

verifyBehavior(['src/hooks/useSqlPaneLayout.test.ts', 'src/components/layout/MainPanel.commands.test.tsx'])

if (failures.length) {
  console.error('SQL workspace smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('SQL workspace smoke passed.')
