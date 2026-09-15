import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const cargo = read('src-tauri/Cargo.toml')
const crypto = read('src-tauri/src/utils/crypto.rs')
const capability = read('src-tauri/capabilities/default.json')
const policy = read('docs/release/production-policy.md')
const packageJson = read('package.json')

assert(
  cargo.includes('default-features = false') && cargo.includes('"wry"') && !cargo.includes('"devtools"'),
  'Tauri release dependency must use an explicit feature list without devtools',
)
assert(
  crypto.includes('security_framework::passwords::{get_generic_password, set_generic_password}'),
  'macOS credential store must use Security.framework generic-password APIs',
)
assert(!crypto.includes('Command::new("/usr/bin/security")'), 'macOS Keychain must not launch security(1)')
assert(!crypto.includes('"-w",\n            secret'), 'macOS Keychain secret must not be passed through argv')
assert(
  capability.includes('Release artifacts do not compile Tauri\'s DevTools feature'),
  'desktop capability must document the release DevTools boundary',
)
assert(
  policy.includes('debug assertions') && /not compiled into release\s+artifacts/.test(policy),
  'production policy must document debug and release behavior',
)
assert(packageJson.includes('test:production-policy'), 'production policy smoke must be registered')

if (failures.length > 0) {
  console.error('Production policy smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Production policy smoke passed: Keychain writes avoid argv and release builds exclude DevTools.')
