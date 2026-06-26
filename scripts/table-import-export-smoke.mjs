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
    'failed_writes',
    'csv_parser_handles_quotes_commas_and_newlines',
    'import_preview_validation_reports_bad_headers_and_row_widths',
  ],
  'table import/export backend',
)

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
    'previewTableCsvImport({',
    'importTableCsv({',
    "t('workbench.exportTable')",
    'CSV import path',
    "t('workbench.previewImport')",
    "t('workbench.runImport')",
  ],
  'Data tab table import/export UI',
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
