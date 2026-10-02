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
const commands = read('src-tauri/src/commands/connection.rs')
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
const deletion = commands.slice(commands.indexOf('async fn delete_connection_state'), commands.indexOf('pub fn list_connections'))
includesAll(deletion, ['manager.disconnect(id).map_err(String::from)?', 'metadata_service.clear_connection(id)', 'config_store.delete_connection(id)'], 'saved connection deletion safety')
assert(deletion.indexOf('manager.disconnect') < deletion.indexOf('metadata_service.clear_connection'), 'delete must disconnect successfully before clearing metadata')
assert(deletion.indexOf('metadata_index.clear_connection') < deletion.indexOf('config_store.delete_connection'), 'delete must clear metadata before deleting persisted configuration')
assert(!deletion.includes('.ok()'), 'delete must not discard disconnect failures')
const update = commands.slice(commands.indexOf('async fn update_connection_state'), commands.indexOf('fn requires_runtime_invalidation'))
includesAll(update, ['requires_runtime_invalidation', 'preflight_configuration_change', 'if refresh', 'manager.disconnect(id).map_err(String::from)?'], 'connection update safety')
assert(update.indexOf('preflight_configuration_change') < update.indexOf('.update_connection(config'), 'update must preflight before modifying persisted configuration')
assert(!update.includes('invalidate_connection('), 'configuration updates must not forcibly retire active sessions')
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
