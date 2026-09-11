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
  for (const value of values) assert(source.includes(value), `${label} missing: ${value}`)
}

const policy = read('src/hooks/useDisconnectRequest.tsx')
const sidebar = read('src/components/sidebar/DataSourcesSidebar.tsx')
const management = read('src/components/connection/ConnectionList.tsx')
const manager = read('src-tauri/src/services/connection_manager.rs')
const en = read('src/locales/en.json')
const zh = read('src/locales/zh.json')

includesAll(policy, [
  'getDisconnectPreflight',
  'connectionCapabilities',
  'cancelRunningQuery',
  "preflight.kind === 'uncommittedTransaction'",
  "prompt?.preflight.kind === 'runningQuery'",
  'await disconnectConnection(connection.id)',
], 'shared disconnect policy')
assert(!policy.includes('commitConsoleTransaction'), 'disconnect policy must not commit transactions')
assert(!policy.includes('rollbackConsoleTransaction'), 'disconnect policy must not roll back transactions')

for (const [source, label] of [[sidebar, 'Data Sources sidebar'], [management, 'Data Sources management']]) {
  includesAll(source, ['useDisconnectRequest', 'requestDisconnect'], label)
  assert(!source.includes('disconnectConnection'), `${label} must not bypass shared disconnect policy`)
}

includesAll(manager, ['DisconnectBlocked', 'RunningOperations', 'UncommittedTransaction'], 'backend final disconnect protection')
includesAll(en, ['"disconnectSafety"', '"Keep Connected"', '"Uncommitted transaction"'], 'English disconnect safety locale')
includesAll(zh, ['"disconnectSafety"', '"保持连接"', '"存在未提交事务"'], 'Chinese disconnect safety locale')

const packageJson = read('package.json')
includesAll(packageJson, ['test:disconnect-safety', 'scripts/disconnect-safety-smoke.mjs'], 'disconnect safety smoke registration')

if (failures.length > 0) {
  console.error('Disconnect safety smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Disconnect safety smoke passed.')
