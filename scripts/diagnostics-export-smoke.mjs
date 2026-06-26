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

const configCommand = read('src-tauri/src/commands/config.rs')
includesAll(
  configCommand,
  [
    'export_diagnostics_package',
    'DiagnosticsPackage',
    'DiagnosticsPrivacyInfo',
    'excludes_passwords: true',
    'excludes_decrypted_secrets: true',
    'excludes_sql_result_data: true',
    'diagnostics_sql_text(&entry.sql, include_sql_text)',
    'format!("[redacted: {} chars]"',
    'list_query_history(5_000)',
    'list_tasks().await',
    'fs::write(&output_path, content)',
  ],
  'diagnostics backend command',
)

assert(!configCommand.includes('password_encrypted: connection.password_encrypted'), 'diagnostics must not export encrypted passwords')
assert(!configCommand.includes('username: connection.username'), 'diagnostics must not export usernames')
assert(!configCommand.includes('host: connection.host'), 'diagnostics must not export hosts')
assert(!configCommand.includes('connection_url: connection.connection_url'), 'diagnostics must not export connection URLs')

const lib = read('src-tauri/src/lib.rs')
assert(
  lib.includes('commands::config::export_diagnostics_package'),
  'diagnostics command must be registered in Tauri handler',
)

const contracts = read('src/shared/command-contracts.json')
includesAll(
  contracts,
  ['"name": "export_diagnostics_package"', '"response": "ExportDiagnosticsPackageResponse"'],
  'diagnostics command contract',
)

const ipc = read('src/ipc/diagnostics.ts')
includesAll(
  ipc,
  ['COMMANDS.exportDiagnosticsPackage', 'includeSqlText?: boolean', 'outputPath: string'],
  'diagnostics IPC wrapper',
)

const settings = read('src/components/settings/SettingsWorkspacePanel.tsx')
includesAll(
  settings,
  [
    'exportDiagnosticsPackage',
    'includeDiagnosticsSqlText',
    'vaporlensdb-diagnostics-${stamp}.json',
    "t('settings.diagnostics.includeSqlText')",
    "t('settings.diagnostics.exportComplete')",
  ],
  'diagnostics settings UI',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(zh, ['"diagnostics"', '"包含 SQL 文本"', '结果数据和密码永不导出'], 'Chinese diagnostics locale')
includesAll(en, ['"diagnostics"', '"Include SQL text"', 'Result data and passwords are never exported'], 'English diagnostics locale')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:diagnostics-export', 'scripts/diagnostics-export-smoke.mjs'],
  'diagnostics smoke script registration',
)

if (failures.length > 0) {
  console.error('Diagnostics export smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Diagnostics export smoke passed.')
