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
    'pub struct ExportTableCsvInput',
    'pub struct PreviewTableCsvImportInput',
    'pub struct ImportTableCsvInput',
    'pub async fn export_table_csv',
    'pub async fn preview_table_csv_import',
    'pub async fn import_table_csv',
    'execute_query_stream(',
    'handle.is_cancel_requested()',
    'update_progress(',
    '.import-report.json',
    'invalid_row_count',
    'invalid_rows_omitted',
    'failed_write_count',
    'failed_writes_omitted',
    'failed_writes',
    'csv_parser_handles_quotes_commas_and_newlines',
    'import_preview_validation_reports_bad_headers_and_row_widths',
  ],
  'table import/export backend',
)
const importRows = exportCommand.slice(
  exportCommand.indexOf('async fn import_csv_rows('),
  exportCommand.indexOf('async fn write_query_result_csv('),
)
includesAll(
  importRows,
  [
    'CsvRecordReader::new(file, IMPORT_MAX_RECORD_BYTES)',
    'while let Some(row) = next',
    'BoundedRowReports::default()',
  ],
  'streaming table CSV import',
)
assert(!importRows.includes('read_to_string'), 'table CSV import must not buffer the whole file')

const exportIpc = read('src/ipc/export.ts')
includesAll(
  exportIpc,
  [
    'export interface ExportTableCsvInput',
    'export interface PreviewTableCsvImportInput',
    'export interface ImportTableCsvInput',
    'export interface ImportPreview',
    'export function exportTableCsv',
    'export function previewTableCsvImport',
    'export function importTableCsv',
  ],
  'table import/export IPC',
)

const mainPanel = read('src/components/layout/MainPanel.tsx')
includesAll(
  mainPanel,
  [
    'exportTableCsv({',
    'useCsvPreview({',
    'csvPreview.start({',
    'csvPreview.cancel()',
    'importTableCsv({',
    "t('workbench.exportTable')",
    'CSV import path',
    "t('workbench.previewImport')",
    "t('workbench.runImport')",
  ],
  'Data tab table import/export UI',
)

const previewHook = read('src/hooks/useCsvPreview.ts')
includesAll(
  previewHook,
  [
    'crypto.randomUUID()',
    'previewTableCsvImport({ ...input, taskId })',
    'await cancelTask(taskId)',
    "setStatus('cancelling')",
    'if (!result.cancelled)',
    'generation.current !== requestGeneration',
  ],
  'CSV Preview cancellation hook',
)

const contracts = read('src/shared/command-contracts.json')
includesAll(
  contracts,
  [
    '"name": "export_table_csv"',
    '"name": "preview_table_csv_import"',
    '"name": "import_table_csv"',
  ],
  'table import/export command contracts',
)

const lib = read('src-tauri/src/lib.rs')
includesAll(
  lib,
  [
    'commands::export::export_table_csv',
    'commands::export::preview_table_csv_import',
    'commands::export::import_table_csv',
  ],
  'table import/export command registration',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:table-import-export', 'scripts/table-import-export-smoke.mjs'],
  'table import/export smoke script registration',
)

if (failures.length > 0) {
  console.error('Table import/export smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Table import/export smoke passed.')
