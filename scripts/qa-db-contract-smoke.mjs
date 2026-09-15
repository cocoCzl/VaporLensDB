import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const compose = readFileSync(resolve(root, 'docker-compose.qa.yml'), 'utf8')
const helper = readFileSync(resolve(root, 'scripts/qa-db.sh'), 'utf8')
const profileHelper = readFileSync(resolve(root, 'scripts/qa-dev-profile.sh'), 'utf8')
const jdbcTests = readFileSync(resolve(root, 'src-tauri/tests/jdbc_template_driver.rs'), 'utf8')
const buildScript = readFileSync(resolve(root, 'build.sh'), 'utf8')
const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

assert(compose.includes('mysql:8.4'), 'QA Compose must pin MySQL 8.4')
assert(compose.includes('postgres:16'), 'QA Compose must pin PostgreSQL 16')
assert(compose.includes('13306') && compose.includes('15432'), 'QA Compose must use isolated default ports')
assert(compose.includes('vaporlensdb_qa'), 'QA Compose must use the dedicated QA database')
assert(helper.includes('wait_for_health') && helper.includes('docker inspect'), 'QA helper must poll real health status')
assert(helper.includes('VAPORLENSDB_QA_MYSQL_PORT:-13306'), 'QA env output must honor a MySQL port override')
assert(helper.includes('VAPORLENSDB_QA_POSTGRES_PORT:-15432'), 'QA env output must honor a PostgreSQL port override')
assert(helper.includes('down --volumes --remove-orphans'), 'QA reset must be scoped to Compose project volumes')
assert(!helper.includes('system prune') && !helper.includes('volume prune'), 'QA helper must not invoke Docker-wide prune')
assert(profileHelper.includes('VAPORLENSDB_USE_DEV_KEY=1'), 'isolated QA profile must opt into the development key explicitly')
assert(profileHelper.includes('run-keychain') && profileHelper.includes('VAPORLENSDB_CONFIG_DIR'), 'Keychain QA must isolate config without replacing the logged-in Keychain')
assert(profileHelper.includes('Refusing to remove a non-QA profile directory'), 'profile cleanup must fail closed')
assert(jdbcTests.includes('VAPORLENSDB_QA_ENVIRONMENT=1'), 'fixture-mutating JDBC tests must require explicit QA opt-in')
assert(jdbcTests.includes('vaporlensdb_qa_marker'), 'fixture-mutating JDBC tests must verify the QA marker')
assert(buildScript.includes('VAPORLENSDB_LIVE_TEST_ENV_FILE'), 'live integration must support an explicit QA env file')
assert(helper.includes("rolcreatedb FROM pg_roles"), 'QA verification must prove the PostgreSQL app account cannot create databases')

if (failures.length > 0) {
  console.error(`QA database contract smoke failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exit(1)
}

console.log('QA database contract smoke passed.')
