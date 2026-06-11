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

const exportCommand = read('src-tauri/src/commands/export.rs')
includesAll(
  exportCommand,
  [
    'create_task(',
    '"export.csv.result"',
    'tokio::spawn(async move',
    'handle.is_cancel_requested()',
    'update_progress(',
    'finish_failed(handle.id',
    'csv_export_quotes_special_values_and_nulls',
    'csv_export_quotes_headers_and_json_values',
    'BufWriter',
    'yield_now().await',
  ],
  'task-backed CSV export command',
)

const exportIpc = read('src/ipc/export.ts')
includesAll(
  exportIpc,
  ['import type { TaskInfo }', 'invokeCommand<TaskInfo>(COMMANDS.exportQueryResultCsv'],
  'CSV export IPC contract',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    "import { downloadDir, join } from '@tauri-apps/api/path'",
    'exportQueryResultCsv',
    'const directory = await downloadDir()',
    'const path = await join(directory, fileName)',
    'upsertTask(task)',
    "title: 'CSV 导出已开始'",
  ],
  'CSV export UI task launch',
)

assert(!mainPanel.includes('new Blob([csv]'), 'CSV export should not build Blob on the UI thread')
assert(!mainPanel.includes('function toCsv('), 'CSV export should not stringify result sets on the UI thread')

const contracts = read('src/shared/command-contracts.json')
includesAll(
  contracts,
  ['"name": "export_query_result_csv"', '"response": "TaskInfo"'],
  'CSV export command contract',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:result-export', 'scripts/result-export-smoke.mjs'],
  'result export smoke script registration',
)

if (failures.length > 0) {
  console.error('Result export smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Result export smoke passed.')
