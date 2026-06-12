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
  for (const value of values) {
    assert(source.includes(value), `${label} missing: ${value}`)
  }
}

const importLib = read('src/lib/dbeaverImport.ts')
includesAll(
  importLib,
  [
    'previewDbeaverConfiguration',
    'dbeaverPreviewToConnectionInput',
    'parseDbeaverJson',
    'parseDbeaverXml',
    'collectCredentialConnectionIds',
    'manualEntryRequired',
    'unsupported driver',
    'driverDefinitionId',
    'postgres',
    'mysql',
    'oracle',
    'sqlite',
    'mssql',
  ],
  'DBeaver import parser',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
includesAll(
  sidebar,
  [
    'DbeaverImportSettings',
    'previewDbeaverConfiguration(Array.from(files))',
    'dbeaverPreviewToConnectionInput(connection)',
    "t('dbeaver.title')",
    'Driver templates',
    'Import report',
    'password manual entry',
    'skipped',
  ],
  'DBeaver import settings UI',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(zh, ['"title": "DBeaver 配置导入"'], 'Chinese DBeaver import locale')
includesAll(en, ['"title": "DBeaver Configuration Import"'], 'English DBeaver import locale')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:dbeaver-import', 'scripts/dbeaver-import-smoke.mjs'],
  'DBeaver import smoke script registration',
)

if (failures.length > 0) {
  console.error('DBeaver import smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('DBeaver import smoke passed.')
