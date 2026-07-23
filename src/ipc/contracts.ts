import { invokeCommand } from '@/ipc/client'
import commandContracts from '@/shared/command-contracts.json'

export type CommandNamespace =
  | 'contract'
  | 'connection'
  | 'driver'
  | 'export'
  | 'history'
  | 'metadata'
  | 'query'
  | 'settings'
  | 'sqlDraft'
  | 'task'

export type CommandStatus = 'active' | 'planned'

export interface CommandContract {
  name: string
  namespace: CommandNamespace
  args: string
  response: string
  status: CommandStatus
}

export const COMMAND_CONTRACTS = commandContracts as CommandContract[]

export const COMMANDS = {
  listCommandContracts: 'list_command_contracts',
  healthCheck: 'health_check',
  exportDiagnosticsPackage: 'export_diagnostics_package',
  setApplicationMenuLanguage: 'set_application_menu_language',
  createConnection: 'create_connection',
  updateConnection: 'update_connection',
  deleteConnection: 'delete_connection',
  listConnections: 'list_connections',
  testConnection: 'test_connection',
  connect: 'connect',
  disconnect: 'disconnect',
  connectionStatus: 'connection_status',
  listConnectionStatuses: 'list_connection_statuses',
  setConnectionSessionPolicy: 'set_connection_session_policy',
  listDataSourceGroups: 'list_data_source_groups',
  createDataSourceGroup: 'create_data_source_group',
  renameDataSourceGroup: 'rename_data_source_group',
  deleteDataSourceGroup: 'delete_data_source_group',
  reorderDataSourceGroups: 'reorder_data_source_groups',
  setConnectionDataSourceGroup: 'set_connection_data_source_group',
  listDriverDefinitions: 'list_driver_definitions',
  saveCustomDriverDefinition: 'save_custom_driver_definition',
  deleteCustomDriverDefinition: 'delete_custom_driver_definition',
  importJdbcDriverArtifacts: 'import_jdbc_driver_artifacts',
  removeJdbcDriverArtifact: 'remove_jdbc_driver_artifact',
  validateExternalDriver: 'validate_external_driver',
  exportQueryResultCsv: 'export_query_result_csv',
  exportTableCsv: 'export_table_csv',
  previewTableCsvImport: 'preview_table_csv_import',
  importTableCsv: 'import_table_csv',
  getDatabases: 'get_databases',
  getSchemas: 'get_schemas',
  getTables: 'get_tables',
  getColumns: 'get_columns',
  getIndexes: 'get_indexes',
  getForeignKeys: 'get_foreign_keys',
  getViews: 'get_views',
  getFunctions: 'get_functions',
  getTableDdl: 'get_table_ddl',
  getSchemaObjects: 'get_schema_objects',
  getObjectDdl: 'get_object_ddl',
  startMetadataIndexTask: 'start_metadata_index_task',
  searchMetadataIndex: 'search_metadata_index',
  clearMetadataIndex: 'clear_metadata_index',
  executeQuery: 'execute_query',
  executeQueryStream: 'execute_query_stream',
  explainQuery: 'explain_query',
  cancelQuery: 'cancel_query',
  analyzeSqlRisk: 'analyze_sql_risk',
  addQueryHistory: 'add_query_history',
  listQueryHistory: 'list_query_history',
  clearQueryHistory: 'clear_query_history',
  upsertSqlDraft: 'upsert_sql_draft',
  listSqlDrafts: 'list_sql_drafts',
  markSqlDraftClosed: 'mark_sql_draft_closed',
  deleteSqlDraft: 'delete_sql_draft',
  clearSqlDrafts: 'clear_sql_drafts',
  listTasks: 'list_tasks',
  cancelTask: 'cancel_task',
  clearCompletedTasks: 'clear_completed_tasks',
  revealTaskOutput: 'reveal_task_output',
} as const

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS]

export function listCommandContracts() {
  return invokeCommand<CommandContract[]>(COMMANDS.listCommandContracts)
}
