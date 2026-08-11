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

const settingsWorkspace = read('src/components/settings/SettingsWorkspacePanel.tsx')
const connectionForm = read('src/components/connection/ConnectionForm.tsx')
const driverStore = read('src/stores/driverStore.ts')
const driverIpc = read('src/ipc/driver.ts')
const driverCommands = read('src-tauri/src/commands/driver.rs')
const driverTypes = read('src/types/driver.ts')
const rustDriverTypes = read('src-tauri/src/models/driver_catalog.rs')
const rustDriverCatalog = read('src-tauri/src/services/driver_catalog.rs')
const configStore = read('src-tauri/src/services/config_store.rs')
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
    'DriverSupportSummary',
    "t('connectionForm.nativeDriverReady')",
    "t('connectionForm.localDriverRequired')",
    'openExternalUrl(downloadUrl)',
    'connectionVariants',
    'applyUrlTemplate',
    'driverArtifactPathPlaceholder(selectedDriver?.driverArtifact)',
    "return fileName ? `/path/to/${fileName}` : '/path/to/driver.jar'",
  ],
  'connection dialog compact driver readiness and variants',
)

includesAll(
  rustDriverCatalog,
  [
    'driver_artifact: Some("ojdbc11.jar".to_string())',
    'driver_artifact: "postgresql-*.jar"',
    'driver_artifact: "mysql-connector-j-*.jar"',
    'driver_artifact: "sqlite-jdbc-*.jar"',
  ],
  'JDBC driver artifact examples',
)

excludesAll(
  connectionForm,
  [
    'DriverDefinitionSummary',
    "t('drivers.presetOrigin'",
    "t('connectionForm.builtInReadOnly')",
    "t('connectionForm.externalDriverRequirement')",
    "window.open(ORACLE_JDBC_DOWNLOAD_URL",
  ],
  'connection dialog should not show driver-template management detail',
)

includesAll(
  settingsWorkspace,
  [
    'DriverDefinitionsSettings',
    "t('drivers.summary'",
    "activeSection === 'drivers'",
    'createCustomDriver',
    "setEditing(newCustomDriverDefinition())",
    'DriverDefinitionEditor',
    "xl:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]",
    "md:grid-cols-2",
    'driverStateLabel',
    'driverStateBadgeClass',
    "2xl:grid-cols-2",
    "ide-input min-h-36 w-full min-w-0 resize-y overflow-auto font-mono text-xs",
    "t('drivers.downloadDriver')",
    'isVisibleJdbcDriver',
    'canManageJdbcArtifacts',
    'driverOriginLabel',
    "return driver.builtIn ? t('drivers.builtInTemplate') : t('drivers.customTemplate')",
    'driverRuntimeLabel',
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

excludesAll(
  settingsWorkspace,
  ['nativeRust', "status !== 'planned' ? false", "'built-in'", "'custom'"],
  'JDBC driver manager should not show native runtime copy or English origin tags',
)

const sidebar = read('src/components/layout/Sidebar.tsx')
assert(!sidebar.includes('DriverDefinitionsSettings'), 'driver manager should not live in the left sidebar')

const zh = read('src/locales/zh.json')
const en = read('src/locales/en.json')
includesAll(
  zh,
  ['"title": "JDBC 驱动"', '"summary": "{{count}} 个 JDBC 模板；内置模板只读，自定义可编辑。"', '"viewBuiltIn": "查看内置驱动"', '"editCustom": "编辑自定义驱动"', '"importJar": "导入 JAR"', '"validate": "校验驱动"'],
  'Chinese driver manager locale',
)
includesAll(
  en,
  ['"title": "JDBC Drivers"', '"summary": "{{count}} JDBC templates. Built-in templates are read-only; custom templates are editable."', '"viewBuiltIn": "View built-in driver"', '"editCustom": "Edit custom driver"', '"importJar": "Import JAR"', '"validate": "Validate driver"'],
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
    'ensure_managed_jdbc_artifacts_supported',
    'matches!(definition.backend, DriverBackend::Jdbc)',
  ],
  'driver command operations',
)

includesAll(
  configStore,
  [
    'update_driver_definition_artifacts',
    'driver_dialect',
    'download_url',
    "driver_type NOT IN ('mongo', 'redis')",
    "status <> 'planned'",
    'existing.built_in && !existing.driver_artifacts.is_empty()',
  ],
  'driver definition storage filters and artifact preservation',
)

excludesAll(
  rustDriverCatalog,
  ['planned_definition(', '"MongoDB"', '"Redis"'],
  'built-in driver catalog should not seed planned MongoDB or Redis',
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
