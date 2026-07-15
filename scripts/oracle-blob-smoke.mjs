import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const bridge = readFileSync(
  resolve(root, 'tools/jdbc-bridge/src/com/vaporlensdb/jdbcbridge/JdbcBridge.java'),
  'utf8',
)
for (const value of [
  'import java.sql.Blob;',
  'if (value instanceof Blob blob)',
  'return blobPlaceholder(blob);',
  'long bytes = blob.length();',
  'BLOB · ',
]) {
  assert(bridge.includes(value), `JDBC bridge BLOB support missing: ${value}`)
}
assert(!bridge.includes('return resultSet.getString(index);\n    }\n\n    private static String readClob'), 'BLOB handling must run before generic string conversion')

const jdbcDriver = readFileSync(resolve(root, 'src-tauri/src/drivers/jdbc.rs'), 'utf8')
assert(
  jdbcDriver.includes('AppError::ConnectionFailed { driver, message } if command == "query" => AppError::QueryFailed'),
  'JDBC query-side connection wrappers must be reported as query failures',
)

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
assert(packageJson.includes('test:oracle-blob'), 'Oracle BLOB smoke script must be registered')

if (failures.length) {
  console.error('Oracle BLOB smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Oracle BLOB smoke passed.')
