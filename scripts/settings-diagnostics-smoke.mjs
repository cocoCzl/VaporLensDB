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

const healthCommand = read('src-tauri/src/commands/health.rs')
includesAll(
  healthCommand,
  [
    'config_path',
    'config_schema_version',
    'password_storage',
    'key_backend',
    'applied_schema_version()',
    'db_path()',
    'crypto::key_backend_label()',
  ],
  'health diagnostics command',
)

const configStore = read('src-tauri/src/services/config_store.rs')
includesAll(configStore, ['pub fn db_path', 'pub fn applied_schema_version'], 'config store diagnostics facts')

const crypto = read('src-tauri/src/utils/crypto.rs')
includesAll(crypto, ['pub fn key_backend_label', 'macOS Keychain', 'local development key file'], 'key backend fact')

const healthIpc = read('src/ipc/health.ts')
includesAll(
  healthIpc,
  ['configPath: string', 'configSchemaVersion: number', 'passwordStorage: string', 'keyBackend: string'],
  'health IPC type',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(
  sidebar,
  [
    'healthCheck',
    'settings.backendVersion',
    'health?.configPath',
    'health.configSchemaVersion',
    'health?.passwordStorage',
    'health?.keyBackend',
  ],
  'settings diagnostics UI',
)

const contracts = read('src/shared/command-contracts.json')
includesAll(
  contracts,
  ['configPath', 'configSchemaVersion', 'passwordStorage', 'keyBackend'],
  'health command contract',
)

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:settings-diagnostics', 'scripts/settings-diagnostics-smoke.mjs'],
  'settings diagnostics smoke script registration',
)

if (failures.length > 0) {
  console.error('Settings diagnostics smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Settings diagnostics smoke passed.')
