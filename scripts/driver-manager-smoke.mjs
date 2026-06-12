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

const sidebar = read('src/components/layout/Sidebar.tsx')
const connectionForm = read('src/components/connection/ConnectionForm.tsx')
const driverStore = read('src/stores/driverStore.ts')
const driverIpc = read('src/ipc/driver.ts')
const driverCommands = read('src-tauri/src/commands/driver.rs')
const driverTypes = read('src/types/driver.ts')
const rustDriverTypes = read('src-tauri/src/models/driver_catalog.rs')
const packageJson = read('package.json')

includesAll(
  driverTypes,
  [
    'builtIn: boolean',
    "export type DriverBackend = 'nativeRust' | 'jdbc' | 'planned'",
    "export type DriverStatus = 'ready' | 'configurable' | 'planned'",
    'connectionVariants: DriverConnectionVariant[]',
    'metadataDialectSql?: string | null',
  ],
  'typed driver definition model',
)

includesAll(
  rustDriverTypes,
  [
    'pub built_in: bool',
    'pub enum DriverBackend',
    'pub enum DriverStatus',
    'pub connection_variants: Vec<DriverConnectionVariant>',
    'pub metadata_dialect_sql: Option<String>',
  ],
  'rust driver definition model',
)

includesAll(
  connectionForm,
  [
    'DriverDefinitionSummary',
    'driverOriginLabel',
    "return 'Custom'",
    "return 'Preset'",
    "return 'Built-in'",
    'driverOriginBadgeClass',
    '内置定义只读',
    '需本地驱动文件',
    'connectionVariants',
    'applyUrlTemplate',
  ],
  'connection dialog driver origin and variants',
)

includesAll(
  sidebar,
  [
    'DriverDefinitionsSettings',
    "t('drivers.summary'",
    "driver.builtIn ? 'built-in' : 'custom'",
    "t('drivers.viewBuiltIn')",
    "t('drivers.editCustom')",
    "t('drivers.importJar')",
    "t('drivers.importPath')",
    "t('drivers.removeJar')",
    "t('drivers.metadataSql')",
    "t('drivers.validate')",
    'newCustomDriverDefinition',
    'normalizeDriverDefinition',
  ],
  'settings driver manager UI',
)

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(
  zh,
  ['"viewBuiltIn": "查看内置驱动"', '"editCustom": "编辑自定义驱动"', '"importJar": "导入 JAR"', '"validate": "校验驱动"'],
  'Chinese driver manager locale',
)
includesAll(
  en,
  ['"viewBuiltIn": "View built-in driver"', '"editCustom": "Edit custom driver"', '"importJar": "Import JAR"', '"validate": "Validate driver"'],
  'English driver manager locale',
)

includesAll(
  driverStore,
  [
    'loadDrivers',
    'saveDriver',
    'deleteDriver',
    'importJdbcArtifacts',
    'removeJdbcArtifact',
    'validateDriver',
  ],
  'driver store operations',
)

includesAll(
  driverIpc,
  [
    'listDriverDefinitions',
    'saveCustomDriverDefinition',
    'deleteCustomDriverDefinition',
    'importJdbcDriverArtifacts',
    'removeJdbcDriverArtifact',
    'validateExternalDriver',
  ],
  'driver IPC operations',
)

includesAll(
  driverCommands,
  [
    'list_driver_definitions',
    'save_custom_driver_definition',
    'delete_custom_driver_definition',
    'import_jdbc_driver_artifacts',
    'remove_jdbc_driver_artifact',
    'validate_external_driver',
    'validate_jdbc_prerequisites',
    'ensure_custom_jdbc_definition',
  ],
  'driver command operations',
)

excludesAll(
  sidebar + connectionForm + driverStore + driverIpc + driverCommands + driverTypes + rustDriverTypes,
  [
    '选择系统 ODBC 驱动',
    '刷新 ODBC 驱动',
    'loadOdbcDrivers',
    'listSystemOdbcDrivers',
    'list_system_odbc_drivers',
    'validate_odbc_prerequisites',
    "'odbc'",
    'DriverBackend::Odbc',
    'DriverType::Odbc',
  ],
  'removed ODBC product surface',
)

includesAll(
  packageJson,
  ['test:driver-manager', 'scripts/driver-manager-smoke.mjs'],
  'driver manager smoke registration',
)

if (failures.length > 0) {
  console.error('Driver manager smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Driver manager smoke passed.')
