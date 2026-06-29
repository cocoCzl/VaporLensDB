import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} missing: ${value}`)
  }
}

function excludesAll(source, values, label) {
  for (const value of values) {
    assert(!source.includes(value), `${label} should not include: ${value}`)
  }
}

const form = read('src/components/connection/ConnectionForm.tsx')
includesAll(
  form,
  [
    "PRIMARY_DRIVER_IDS: DriverType[] = ['postgres', 'mysql', 'oracle'",
    'compareDriverChoices',
    "t('connectionForm.description.oracle')",
    'onSaveOnly',
    'onSaveAndConnect',
    "t('connectionForm.saveOnly')",
    "t('connectionForm.saveAndConnect')",
    'connectionReadinessIssue',
    "t('connectionForm.validation.missingJarReadiness')",
    'requireExternalDriver: false',
    'requireExternalDriver: true',
    "t('connectionForm.doNotSave')",
    "t('connectionForm.sessionOnly')",
    "t('connectionForm.secureStorage')",
    "t('connectionForm.testConnection')",
  ],
  'connection form readiness and actions',
)
excludesAll(form, ['实验性'], 'connection form primary copy')

const dialog = read('src/components/connection/ConnectionDialog.tsx')
includesAll(
  dialog,
  [
    "t('connection.dialogSubtitle')",
    "t('connection.driverHelp')",
    'onSaveOnly={async (input) =>',
    'onSaveAndConnect={async (input) =>',
    'await connectConnection(saved.id)',
    'onTest={testConnectionInput}',
  ],
  'connection dialog save and connect flow',
)
excludesAll(dialog, ['实验性 JDBC'], 'connection dialog copy')

const list = read('src/components/connection/ConnectionList.tsx')
includesAll(
  list,
  [
    'connectionReadinessIssue(connection)',
    "? 'bg-amber-500'",
    "readinessIssue ? t('connection.notReady')",
    'disabled={loading || Boolean(readinessIssue)}',
    'Missing local JDBC JAR',
  ],
  'connection list readiness',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(zh, ['配置 PostgreSQL、MySQL、Oracle', '需要本地 ojdbc', '"oracleRequirement"', '"saveAndConnect": "保存并连接"'], 'Chinese connection dialog copy')
includesAll(en, ['PostgreSQL, MySQL, Oracle', 'requires a local ojdbc', '"oracleRequirement"', '"saveAndConnect": "Save and connect"'], 'English connection dialog copy')

const store = read('src/stores/connectionStore.ts')
includesAll(
  store,
  [
    'saveConnection: (input: ConnectionInput) => Promise<ConnectionConfig>',
    'const saved = input.id ? await updateConnection(input) : await createConnection(input)',
    'return saved',
  ],
  'connection store returns saved connection',
)

const catalog = read('src-tauri/src/services/driver_catalog.rs')
includesAll(
  catalog,
  ['Oracle 需要本地 ojdbc；连接、查询、对象浏览、DDL/source 和补全可用。'],
  'oracle driver catalog copy',
)
excludesAll(catalog, ['Oracle 为实验性 JDBC 支持'], 'oracle driver catalog copy')

const packageJson = read('package.json')
includesAll(
  packageJson,
  ['test:connection-readiness', 'scripts/connection-readiness-smoke.mjs'],
  'connection readiness smoke registration',
)

if (failures.length > 0) {
  console.error('Connection readiness smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Connection readiness smoke passed.')
