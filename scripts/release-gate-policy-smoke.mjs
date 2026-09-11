import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const buildScript = readFileSync(resolve(root, 'build.sh'), 'utf8')
const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const deterministicStart = buildScript.indexOf('run_checks() {')
const liveStart = buildScript.indexOf('run_selected_live_tests() {')
assert(deterministicStart >= 0 && liveStart > deterministicStart, 'build.sh gate functions are missing')

const deterministicGate = buildScript.slice(deterministicStart, liveStart)
assert(!deterministicGate.includes('load_live_test_env'), 'deterministic build gate must not load .env')
assert(!deterministicGate.includes('--include-ignored'), 'deterministic build gate must not run ignored live tests')
assert(deterministicGate.includes('cargo test)'), 'deterministic build gate must retain Rust tests')

assert(buildScript.includes('live-tests)\n    ensure_dependencies\n    build_jdbc_bridge\n    run_selected_live_tests "$@"'), 'live integration must require explicit target selectors')
assert(buildScript.includes('destructive-live-tests)'), 'destructive integration target is missing')
assert(buildScript.includes('VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1'), 'destructive integration must require explicit confirmation')

if (failures.length > 0) {
  console.error('Release gate policy smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Release gate policy smoke passed: deterministic, live, and destructive gates are separated.')
