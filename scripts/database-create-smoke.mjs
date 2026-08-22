import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

const tabBar = read('src/components/layout/TabBar.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
assert(!tabBar.includes('CreateDatabaseDialog'), 'workspace tab bar must not expose database creation')
assert(!sidebar.includes('CreateDatabaseDialog'), 'data-source sidebar must not expose database creation')

const appMenu = read('src-tauri/src/app_menu.rs')
assert(!appMenu.includes('DATABASE_CREATE_ID'), 'native menu must not expose database creation')
assert(!appMenu.includes('create_database'), 'native menu must not expose database creation')

const app = read('src/App.tsx')
assert(!app.includes("case 'create-database'"), 'workspace command bridge must not expose database creation')

if (failures.length) {
  console.error('Database create smoke failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Database create smoke passed.')
