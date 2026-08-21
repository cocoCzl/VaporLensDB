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

const packageJson = read('package.json')
const tasks = read('docs/TESTING.md')
const databaseTree = read('src/components/explorer/DatabaseTree.tsx')
const mainPanel = read('src/components/layout/MainPanel.tsx')
const connectionForm = read('src/components/connection/ConnectionForm.tsx')
const metadataStore = read('src/stores/metadataStore.ts')
const autoComplete = read('src/components/editor/AutoComplete.ts')
const editorStore = read('src/stores/editorStore.ts')
const metadataService = read('src-tauri/src/services/metadata_service.rs')
const jdbcDriver = read('src-tauri/src/drivers/jdbc.rs')
const pgTest = read('src-tauri/tests/postgres_driver.rs')
const mysqlTest = read('src-tauri/tests/mysql_driver.rs')
const oracleTest = read('src-tauri/tests/oracle_jdbc_driver.rs')

includesAll(
  packageJson,
  [
    'test:object-tree-workflow',
    'scripts/object-tree-workflow-smoke.mjs',
    'test:object-tree-autopath',
    'test:object-category-model',
    'test:data-tab-preview',
    'test:structure-tab',
    'test:definition-tab',
    'test:schema-aware-completion',
    'test:connection-readiness',
  ],
  'workflow smoke registration and prerequisites',
)

includesAll(
  databaseTree,
  [
    'selectCurrentDatabase(',
    'selectDefaultSchema(',
    'objectCategoryFolders(driverType, t)',
    "label: 'Tables'",
    "label: 'Views'",
    "label: 'Procedures'",
    "label: 'Triggers'",
    "label: 'Events'",
    "label: 'Packages'",
    "kind: 'data'",
    "kind: 'structure'",
    "kind: 'definition'",
    'sourceLikeObjectKind',
    'supportsObjectBrowsing',
    "t('explorer.unsupportedTitle')",
  ],
  'object tree workflow coverage',
)

includesAll(
  mainPanel,
  [
    "case 'postgres'",
    "case 'mysql'",
    "case 'oracle'",
    'DataTabPanel',
    'StructureTabPanel',
    'DefinitionTabPanel',
    'loadTables(connectionId, selectedSchema)',
    'loadViews(connectionId, selectedSchema)',
    'loadFunctions(connectionId, selectedSchema)',
    'read-only',
    "t('workbench.refreshStructure')",
    "t('workbench.refreshDefinition'",
  ],
  'main panel workflow coverage',
)

includesAll(
  connectionForm,
  [
    'const validationError = validate(true)',
    "t('connectionForm.description.oracle')",
    "t('connectionForm.validation.missingJarReadiness')",
    "t('connectionForm.saveAndConnect')",
    "t('connectionForm.testConnection')",
  ],
  'oracle external driver readiness coverage',
)

includesAll(
  metadataStore,
  [
    'catalogSchemaPaths',
    'setCatalogSchemaPath',
    'loadTables',
    'loadViews',
    'loadFunctions',
    'loadSchemaObjects',
    'loadColumns',
    'loadIndexes',
    'loadForeignKeys',
  ],
  'metadata store workflow coverage',
)

includesAll(
  autoComplete,
  [
    'catalogSchemaPaths[connectionId]',
    'findAlias(context.memberOwner, context.aliases)',
    'findColumnsForOwner(',
    'schemaObjectSuggestions',
    'showSystemObjects || !isSystemSchema',
  ],
  'completion workflow coverage',
)

includesAll(
  editorStore,
  [
    "kind?:",
    "| 'sql'",
    "| 'data'",
    "| 'structure'",
    "| 'definition'",
    'DataTabContext',
    'StructureTabContext',
    'DefinitionTabContext',
  ],
  'tab workflow contract coverage',
)

includesAll(
  metadataService,
  [
    'get_tables',
    'get_views',
    'get_schema_objects',
    'get_columns',
    'get_indexes',
    'get_foreign_keys',
    'get_table_ddl',
    'get_object_ddl',
  ],
  'backend metadata workflow coverage',
)

includesAll(
  jdbcDriver,
  [
    'databases: Option<String>',
    'schemas: Option<String>',
    'tables: Option<String>',
    'views: Option<String>',
    'columns: Option<String>',
    'indexes: Option<String>',
    'foreign_keys: Option<String>',
    'schema_objects: Option<String>',
    'table_ddl: Option<String>',
    'object_ddl: Option<String>',
  ],
  'oracle JDBC workflow coverage',
)

includesAll(
  pgTest,
  [
    'connects_and_reads_postgres_metadata',
    'TEST_PG_URL or TEST_PG_JDBC_URL',
    'get_schemas',
    'execute_query_stream',
  ],
  'postgres integration workflow coverage',
)

includesAll(
  mysqlTest,
  [
    'connects_and_reads_mysql_metadata',
    'TEST_MYSQL_JDBC_URL',
    'get_databases',
    'execute_query_stream',
  ],
  'mysql integration workflow coverage',
)

includesAll(
  oracleTest,
  [
    'connects_and_queries_oracle_with_jdbc_bridge',
    'reads_oracle_metadata_with_jdbc_bridge',
    'TEST_ORACLE_JDBC_URL and TEST_ORACLE_JDBC_DRIVER_PATH',
    'get_schemas',
    'get_tables',
    'get_views',
    'get_schema_objects',
    'get_object_ddl',
  ],
  'oracle integration workflow coverage',
)

includesAll(
  tasks,
  [
    'cd src-tauri && cargo test --test postgres_driver -- --ignored',
    'cd src-tauri && cargo test --test mysql_driver -- --ignored',
    'cd src-tauri && cargo test --test oracle_jdbc_driver -- --ignored',
    'Use `TEST_ORACLE_*`',
  ],
  'real database command documentation',
)

if (failures.length > 0) {
  console.error('Object Tree workflow smoke failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Object Tree workflow smoke passed.')
