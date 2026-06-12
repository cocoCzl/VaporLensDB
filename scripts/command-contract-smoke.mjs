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

function unique(values) {
  return [...new Set(values)]
}

const contracts = JSON.parse(read('src/shared/command-contracts.json'))
const activeContracts = contracts.filter((contract) => contract.status === 'active')
const activeNames = activeContracts.map((contract) => contract.name)

const namespaces = new Set(contracts.map((contract) => contract.namespace))
for (const namespace of ['connection', 'query', 'metadata', 'driver', 'settings', 'history', 'task']) {
  assert(namespaces.has(namespace), `contract namespace missing: ${namespace}`)
}

assert(unique(contracts.map((contract) => contract.name)).length === contracts.length, 'duplicate command contract name')

for (const contract of contracts) {
  assert(contract.name && typeof contract.name === 'string', `invalid command name: ${JSON.stringify(contract)}`)
  assert(contract.args && typeof contract.args === 'string', `missing args shape: ${contract.name}`)
  assert(contract.response && typeof contract.response === 'string', `missing response shape: ${contract.name}`)
  assert(['active', 'planned'].includes(contract.status), `invalid command status: ${contract.name}`)
}

assert(activeContracts.some((contract) => contract.namespace === 'task'), 'active task commands are not documented')

const lib = read('src-tauri/src/lib.rs')
const handlerBlock = lib.match(/tauri::generate_handler!\s*\[\s*([\s\S]*?)\s*\]/)?.[1] ?? ''
const registeredNames = unique(
  [...handlerBlock.matchAll(/commands::[a-z_]+::([a-z_]+)/g)].map((match) => match[1]),
)

for (const name of activeNames) {
  assert(registeredNames.includes(name), `active contract is not registered in Rust handler: ${name}`)
}

for (const name of registeredNames) {
  assert(activeNames.includes(name), `Rust handler command missing from active contracts: ${name}`)
}

const contractsTs = read('src/ipc/contracts.ts')
const frontendNames = unique(
  [...contractsTs.matchAll(/:\s*'([a-z_]+)'/g)].map((match) => match[1]),
).filter((name) => !['active', 'planned'].includes(name))

for (const name of activeNames) {
  assert(frontendNames.includes(name), `active contract missing from frontend COMMANDS: ${name}`)
}

for (const name of frontendNames) {
  assert(activeNames.includes(name), `frontend COMMANDS value missing from active contracts: ${name}`)
}

const ipcSources = [
  'src/ipc/connection.ts',
  'src/ipc/diagnostics.ts',
  'src/ipc/driver.ts',
  'src/ipc/export.ts',
  'src/ipc/health.ts',
  'src/ipc/metadata.ts',
  'src/ipc/query.ts',
  'src/ipc/queryHistory.ts',
]

for (const path of ipcSources) {
  const source = read(path)
  const literalInvokes = [...source.matchAll(/invokeCommand<[^>]+>\('([a-z_]+)'/g)].map((match) => match[1])
  for (const name of literalInvokes) {
    assert(false, `${path} should use COMMANDS instead of literal command name: ${name}`)
  }
}

if (failures.length > 0) {
  console.error('Command contract smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Command contract smoke passed.')
