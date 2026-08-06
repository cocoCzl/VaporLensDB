import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const assert = (condition, message) => { if (!condition) failures.push(message) }

const icon = readFileSync(resolve(root, 'src/components/common/DatabaseVendorIcon.tsx'), 'utf8')
for (const driverType of ['postgres', 'mysql', 'oracle', 'sqlite', 'mssql']) {
  assert(icon.includes(`case '${driverType}':`), `missing dedicated ${driverType} icon mapping`)
}
assert(icon.includes('default:\n      return <Database'), 'custom and unknown drivers must retain the generic database fallback')

for (const file of [
  'src/components/layout/Sidebar.tsx',
  'src/components/connection/ConnectionList.tsx',
  'src/components/editor/EditorToolbar.tsx',
  'src/components/layout/StatusBar.tsx',
  'src/components/connection/ConnectionForm.tsx',
]) {
  const source = readFileSync(resolve(root, file), 'utf8')
  assert(source.includes('DatabaseVendorIcon'), `${file} must use the shared database vendor icon`)
}

if (failures.length) {
  console.error('Database vendor icon smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Database vendor icon smoke passed.')
