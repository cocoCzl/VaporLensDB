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
    'create_task_with_output(',
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
includesAll(
  exportCommand,
  [
    'fn staged_export_path(',
    'async fn cleanup_stale_export_parts(',
    '.vaporlensdb-export-',
    'STALE_EXPORT_PART_AGE',
    'async fn finalize_staged_export(',
    '.part',
    'tokio::fs::hard_link(staged_path, final_path)',
    'tokio::fs::remove_file(staged_path)',
    'write_query_result_csv(\n            &input.result,\n            &staged_path,',
    'write_streamed_query_csv(\n                        &input,\n                        operation.clone(),\n                        &staged_path,',
    'write_table_csv(&input, operation, columns, &staged_path,',
  ],
  'staged atomic CSV export delivery',
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
    'const directory = exportDirectory ?? await downloadDir()',
    'const path = await join(directory, fileName)',
    'upsertTask(task)',
    "title: i18n.t('workbench.csvExportStarted')",
  ],
  'CSV export UI task launch',
)

assert(!mainPanel.includes('new Blob([csv]'), 'CSV export should not build Blob on the UI thread')
assert(!mainPanel.includes('function toCsv('), 'CSV export should not stringify result sets on the UI thread')
const currentResultExport = mainPanel.slice(
  mainPanel.indexOf('async function exportCurrentResult('),
  mainPanel.indexOf('async function exportFullQueryResult('),
)
assert(!currentResultExport.includes('exportQueryCsv'), 'current-result export must not re-execute editor SQL')
assert(mainPanel.includes('captureResultExport(result)'), 'export must capture rows before asynchronous filesystem work')
includesAll(
  mainPanel,
  [
    'async function exportFullQueryResult(',
    "i18n.t('workbench.exportAllRowsConfirmation')",
    'connectionGeneration: snapshot.connectionGeneration',
    'sql: snapshot.sql',
    'consoleId: snapshot.consoleId',
  ],
  'explicit full-query export from immutable execution snapshot',
)

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
