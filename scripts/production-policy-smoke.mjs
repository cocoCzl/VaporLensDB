import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const rustFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name)
  return entry.isDirectory() ? rustFiles(path) : entry.name.endsWith('.rs') ? [path] : []
})
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const cargo = read('src-tauri/Cargo.toml')
const crypto = read('src-tauri/src/utils/crypto.rs')
const capability = read('src-tauri/capabilities/default.json')
const policy = read('docs/release/production-policy.md')
const packageJson = read('package.json')
const activeCrypto = crypto.split('\n#[cfg(test)]\nmod tests')[0]
const securityFrameworkOwners = rustFiles(resolve(root, 'src-tauri/src'))
  .filter((path) => /security_framework::|SecItem(?:CopyMatching|Add|Update|Delete)/.test(readFileSync(path, 'utf8')))
  .map((path) => relative(root, path))

assert(
  cargo.includes('default-features = false') && cargo.includes('"wry"') && !cargo.includes('"devtools"'),
  'Tauri release dependency must use an explicit feature list without devtools',
)
assert(
  crypto.includes('ItemSearchOptions')
    && crypto.includes('skip_authenticated_items(true)')
    && crypto.includes('kSecUseAuthenticationUISkip')
    && crypto.includes('add_macos_generic_password_silently'),
  'macOS Keychain reads and writes must explicitly skip authentication UI',
)
assert(!crypto.includes('Command::new("/usr/bin/security")'), 'macOS Keychain must not launch security(1)')
assert(!crypto.includes('"-w",\n            secret'), 'macOS Keychain secret must not be passed through argv')
assert(
  JSON.stringify(securityFrameworkOwners) === JSON.stringify(['src-tauri/src/utils/crypto.rs']),
  'Security.framework secret access must have exactly one Rust gateway: utils/crypto.rs',
)
assert(
  /const MACOS_DATASOURCE_PASSWORD_SERVICE: &str = "com\.vaporlensdb\.datasource-password\.v1";/.test(activeCrypto)
    && activeCrypto.includes('MACOS_DATASOURCE_PASSWORD_REFERENCE_PREFIX')
    && activeCrypto.includes('store_macos_datasource_password')
    && activeCrypto.includes('read_macos_datasource_password'),
  'macOS datasource passwords must use the direct V1 Keychain gateway',
)
assert(
  !/const (?:LEGACY_KEYCHAIN_SERVICE|V2_KEYCHAIN_SERVICE)/.test(activeCrypto),
  'active macOS credential code must not define V1/V2/V3 Keychain services',
)
assert(
  !/load_legacy_key|load_v2_key|read_macos_legacy|migrated_ciphertext/.test(activeCrypto),
  'active macOS credential flow must not probe or migrate legacy Keychain items',
)
const configStore = read('src-tauri/src/services/config_store.rs')
assert(
  configStore.includes('save_connection_password')
    && configStore.includes('update_connection_password')
    && configStore.includes('read_macos_datasource_password')
    && configStore.includes('is_macos_datasource_password_reference'),
  'macOS connection persistence must store only direct Keychain references',
)
assert(
  !configStore.includes('load_legacy_key') && !configStore.includes('migrated_ciphertext'),
  'connection persistence must not restore legacy Keychain credentials',
)
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

console.log('Production policy smoke passed: macOS datasource passwords use direct non-interactive Keychain reads, writes avoid argv, and release builds exclude DevTools.')
