import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}
const includesAll = (source, values, label) => {
  for (const value of values) assert(source.includes(value), `${label} missing: ${value}`)
}

const taskCommand = read('src-tauri/src/commands/task.rs')
includesAll(taskCommand, ['clear_completed_tasks', 'reveal_task_output', 'Command::new("open")', 'path.is_file()'], 'task backend commands')

const taskManager = read('src-tauri/src/services/task_manager.rs')
includesAll(taskManager, ['output_path', 'create_task_with_output', 'clear_completed_tasks', 'output_path(&self'], 'task output metadata')
assert(!taskManager.includes('"No-op"'), 'no-op task should be removed')

const taskPanel = read('src/components/layout/StatusBar.tsx')
includesAll(taskPanel, ['clearCompleted', 'revealTaskOutput', 'task.outputPath', 'status.clearCompleted', 'status.revealOutput'], 'task panel controls')
assert(!taskPanel.includes('startNoop'), 'test task control should be removed')

const settings = read('src/components/settings/SettingsWorkspacePanel.tsx')
includesAll(settings, ['exportDirectory', 'chooseExportDirectory', 'settings.exportDirectory.title', 'exportDirectory ?? await downloadDir()'], 'export directory settings')

const contracts = read('src/shared/command-contracts.json')
includesAll(contracts, ['"name": "clear_completed_tasks"', '"name": "reveal_task_output"'], 'task command contracts')
assert(!contracts.includes('start_noop_task'), 'no-op command contract should be removed')

if (failures.length > 0) {
  console.error('Task output workflow smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Task output workflow smoke passed.')
