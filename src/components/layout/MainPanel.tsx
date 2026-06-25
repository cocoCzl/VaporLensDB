import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { downloadDir, join } from '@tauri-apps/api/path'
import { AlertCircle, ArrowDownAZ, ArrowUpAZ, Clock3, Copy, Database as DatabaseIcon, Download, FileCode2, History, LockKeyhole, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { ConnectionList } from '@/components/connection/ConnectionList'
import { DataGrid } from '@/components/grid/DataGrid'
import { ERDiagram } from '@/components/diagram/ERDiagram'
import { ObjectInspectorPanel } from '@/components/inspector/ObjectInspectorPanel'
import { Button } from '@/components/ui/button'
import { useQuery } from '@/hooks/useQuery'
import {
  exportQueryResultCsv,
  exportTableCsv,
  importTableCsv,
  previewTableCsvImport,
  type ImportPreview,
} from '@/ipc/export'
import { getObjectDdl, getTableDdl } from '@/ipc/metadata'
import { buildDataTabSql } from '@/lib/dataTabSql'
import { isSystemSchema } from '@/lib/systemObjects'
import { normalizeAppError } from '@/ipc/client'
import { analyzeSqlRisk, type SqlRiskAnalysis, type SqlRiskReason } from '@/ipc/query'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useTaskStore } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig, DriverType } from '@/types/connection'
import type { AppError } from '@/types/error'
import type { ColumnInfo, DbObjectInfo, ForeignKeyInfo, IndexInfo } from '@/types/metadata'
import type { QueryResult } from '@/types/query'
import type { QueryHistoryEntry, QueryHistoryStatus } from '@/types/queryHistory'
import type { TaskInfo } from '@/types/task'
import type { EditorTab } from '@/stores/editorStore'
import type { AppNotification } from '@/stores/uiStore'

type SqlEditorModule = { default: typeof import('@/components/editor/SqlEditor').SqlEditor }

interface QueryCapabilities {
  canQuery: boolean
  canExplain: boolean
  canCancel: boolean
  canReadMetadata: boolean
  canComplete: boolean
}

let sqlEditorPreload: Promise<SqlEditorModule> | null = null

function loadSqlEditor() {
  sqlEditorPreload ??= import('@/components/editor/SqlEditor').then((module) => ({
    default: module.SqlEditor,
  }))
  return sqlEditorPreload
}

const SqlEditor = lazy(loadSqlEditor)

export function MainPanel() {
  const { connections, statuses, activeConnectionId, setActiveConnection } = useConnectionStore()
  const {
    tabs,
    activeTabId,
    addTab,
    updateTabSql,
    updateDataTabContext,
    updateTabConnection,
    setTabQueryState,
  } = useEditorStore()
  const results = useQueryResultStore((state) => state.results)
  const explains = useQueryResultStore((state) => state.explains)
  const metadataDatabases = useMetadataStore((state) => state.databases)
  const metadataSchemas = useMetadataStore((state) => state.schemas)
  const catalogSchemaPaths = useMetadataStore((state) => state.catalogSchemaPaths)
  const setCatalogSchemaPath = useMetadataStore((state) => state.setCatalogSchemaPath)
  const inspectTable = useObjectInspectorStore((state) => state.inspectTable)
  const loadDatabases = useMetadataStore((state) => state.loadDatabases)
  const loadSchemas = useMetadataStore((state) => state.loadSchemas)
  const loadTables = useMetadataStore((state) => state.loadTables)
  const loadViews = useMetadataStore((state) => state.loadViews)
  const loadFunctions = useMetadataStore((state) => state.loadFunctions)
  const notifyError = useUiStore((state) => state.notifyError)
  const notify = useUiStore((state) => state.notify)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const dataPreviewDefaultRows = useUiStore((state) => state.dataPreviewDefaultRows)
  const showSystemObjects = useUiStore((state) => state.showSystemObjects)
  const { runQuery, runExplain, cancelRunningQuery } = useQuery()
  const [selectedSql, setSelectedSql] = useState('')
  const [editorLoaded, setEditorLoaded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [resultIndexes, setResultIndexes] = useState<Record<string, number>>({})

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const connectionId = activeTab?.connectionId ?? null
  const activeConnection = connections.find((connection) => connection.id === connectionId)
  const activeDriverType = activeConnection?.driverType ?? 'postgres'
  const catalogSchemaPath = connectionId ? catalogSchemaPaths[connectionId] : null
  const queryCapabilities = activeConnection
    ? driverQueryCapabilities(activeConnection.driverType)
    : emptyQueryCapabilities()
  const selectedDatabase =
    connectionId != null
      ? catalogSchemaPath?.database ?? activeConnection?.database ?? null
      : null
  const selectedSchema = connectionId != null ? catalogSchemaPath?.schema ?? null : null
  const connectionIsConnected = Boolean(
    connectionId && statuses[connectionId]?.status === 'connected',
  )
  const canRun = Boolean(
    activeTab &&
      connectionId &&
      connectionIsConnected &&
      queryCapabilities.canQuery &&
      (selectedSql || activeTab.sql).trim(),
  )
  const activeQueryId = activeTab?.lastQueryId ?? null
  const activeResults = activeQueryId ? results[activeQueryId] : undefined
  const activeExplain = activeQueryId ? explains[activeQueryId] : undefined
  const rawResultIndex = activeQueryId ? resultIndexes[activeQueryId] ?? 0 : 0
  const selectedResultIndex = activeResults?.length
    ? Math.min(rawResultIndex, activeResults.length - 1)
    : 0
  const activeResult = activeResults?.[selectedResultIndex]
  const toolbarDatabases = connectionId ? metadataDatabases[connectionId] ?? [] : []
  const toolbarSchemas =
    connectionId && selectedDatabase
      ? filterCompletionSchemas(
          activeDriverType,
          metadataSchemas[`${connectionId}::database::${selectedDatabase}::schemas`] ??
            metadataSchemas[`${connectionId}::database::::schemas`] ??
            [],
          showSystemObjects,
        )
      : []
  const completionHint = completionMetadataHint(
    connectionIsConnected,
    queryCapabilities.canComplete,
    selectedSchema,
  )

  function sqlToRun() {
    return (selectedSql || activeTab?.sql || '').trim()
  }

  useEffect(() => {
    if (!connectionId || !connectionIsConnected || !queryCapabilities.canReadMetadata) {
      return
    }

    let cancelled = false
    Promise.all([loadDatabases(connectionId), loadSchemas(connectionId, selectedDatabase)])
      .then(([, schemas]) => {
        if (!cancelled && !selectedSchema) {
          const visibleSchemas = filterCompletionSchemas(
            activeDriverType,
            schemas,
            showSystemObjects,
          )
          const preferredSchema =
            visibleSchemas.find((item) => item.name === 'public') ?? visibleSchemas[0]
          if (preferredSchema) {
            setCatalogSchemaPath({
              connectionId,
              database: selectedDatabase,
              schema: preferredSchema.name,
              schemaListAvailable: true,
            })
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          notifyError(normalizeAppError(error), '加载补全元数据失败')
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    connectionId,
    connectionIsConnected,
    activeDriverType,
    queryCapabilities.canReadMetadata,
    selectedDatabase,
    selectedSchema,
    showSystemObjects,
    loadDatabases,
    loadSchemas,
    setCatalogSchemaPath,
    notifyError,
  ])

  useEffect(() => {
    if (
      !connectionId ||
      !connectionIsConnected ||
      !selectedSchema ||
      !queryCapabilities.canReadMetadata
    ) {
      return
    }

    let cancelled = false
    Promise.all([
      loadTables(connectionId, selectedSchema),
      loadViews(connectionId, selectedSchema),
      loadFunctions(connectionId, selectedSchema),
    ]).catch((error) => {
      if (!cancelled) {
        notifyError(normalizeAppError(error), '加载补全对象失败')
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    connectionId,
    connectionIsConnected,
    queryCapabilities.canReadMetadata,
    selectedSchema,
    loadFunctions,
    loadTables,
    loadViews,
    notifyError,
  ])

  async function execute() {
    if (!activeTab || !connectionId || !connectionIsConnected || !queryCapabilities.canQuery) {
      return
    }
    const sql = sqlToRun()

    try {
      const risk = await analyzeSqlRisk(sql)
      if (risk.dangerous && !confirmDangerousSql(risk, activeConnection?.colorTag === 'prod')) {
        return
      }
    } catch (error) {
      notifyError(normalizeAppError(error), 'SQL 风险检查失败')
      return
    }

    runQuery(activeTab.id, connectionId, sql)
  }

  function explain() {
    if (!activeTab || !connectionId || !queryCapabilities.canExplain) {
      return
    }
    runExplain(activeTab.id, connectionId, sqlToRun())
  }

  function cancel() {
    if (!activeTab || !connectionId || !activeTab.runningQueryId || !queryCapabilities.canCancel) {
      return
    }
    cancelRunningQuery(activeTab.id, connectionId, activeTab.runningQueryId)
  }

  async function formatSql() {
    if (!activeTab) {
      return
    }
    try {
      const { format } = await import('sql-formatter')
      updateTabSql(activeTab.id, format(activeTab.sql, { language: 'postgresql' }))
      setTabQueryState(activeTab.id, activeTab.lastQueryId ?? null)
    } catch (error) {
      setTabQueryState(
        activeTab.id,
        activeTab.lastQueryId ?? null,
        error instanceof Error ? error.message : 'SQL 格式化失败',
      )
    }
  }

  if (!activeTab) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <WorkbenchHome
          connections={connections}
          activeConnectionId={activeConnectionId}
          onNewSql={() => {
            const connection = connections.find((item) => item.id === activeConnectionId)
            addTab({
              id: crypto.randomUUID(),
              kind: 'sql',
              title: connection ? `${connection.name} SQL` : `SQL ${nextSqlIndex(tabs.map((tab) => tab.title))}`,
              sql: '',
              connectionId: activeConnectionId,
            })
          }}
          onManageDataSources={() => {
            const existing = tabs.find((tab) => tab.kind === 'dataSources')
            if (existing) {
              useEditorStore.getState().setActiveTab(existing.id)
              return
            }
            addTab({
              id: crypto.randomUUID(),
              kind: 'dataSources',
              title: 'Data Sources',
              sql: '',
              connectionId: null,
            })
          }}
          onFocusExplorer={() => useUiStore.getState().setSidebarView('explorer')}
        />
      </main>
    )
  }

  const activeDataContext = activeTab.kind === 'data' ? activeTab.dataContext : null
  if (activeTab.kind === 'dataSources') {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <DataSourcesManagementPanel />
      </main>
    )
  }

  const activeObjectSummaryContext =
    activeTab.kind === 'objectSummary' ? activeTab.objectSummaryContext : null
  if (activeObjectSummaryContext) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ObjectSummaryTabPanel
            tab={{ ...activeTab, objectSummaryContext: activeObjectSummaryContext }}
            onOpenDataPreview={() => {
              if (!activeTab.connectionId) {
                return
              }
              const sql = buildDataTabSql({
                driverType: activeObjectSummaryContext.driverType,
                schema: activeObjectSummaryContext.schema,
                table: activeObjectSummaryContext.object,
                limit: dataPreviewDefaultRows,
                offset: 0,
                primaryKeyColumns: [],
              })
              const tabId = crypto.randomUUID()
              addTab({
                id: tabId,
                kind: 'data',
                title: `${activeObjectSummaryContext.object} 数据`,
                sql,
                connectionId: activeTab.connectionId,
                dataContext: {
                  database: activeObjectSummaryContext.database,
                  schema: activeObjectSummaryContext.schema,
                  object: activeObjectSummaryContext.object,
                  objectKind: activeObjectSummaryContext.objectKind,
                  driverType: activeObjectSummaryContext.driverType,
                  limit: dataPreviewDefaultRows,
                  offset: 0,
                  primaryKeyColumns: [],
                },
              })
              runQuery(tabId, activeTab.connectionId, sql, { maxRows: dataPreviewDefaultRows })
            }}
            onOpenStructure={() => {
              addTab({
                id: crypto.randomUUID(),
                kind: 'structure',
                title: `${activeObjectSummaryContext.object} Structure`,
                sql: '',
                connectionId: activeTab.connectionId,
                structureContext: {
                  database: activeObjectSummaryContext.database,
                  schema: activeObjectSummaryContext.schema,
                  object: activeObjectSummaryContext.object,
                  objectKind: activeObjectSummaryContext.objectKind,
                },
              })
            }}
            onOpenDefinition={() => {
              addTab({
                id: crypto.randomUUID(),
                kind: 'definition',
                title: `${activeObjectSummaryContext.object} DDL`,
                sql: '',
                connectionId: activeTab.connectionId,
                definitionContext: {
                  database: activeObjectSummaryContext.database,
                  schema: activeObjectSummaryContext.schema,
                  object: activeObjectSummaryContext.object,
                  objectKind: activeObjectSummaryContext.objectKind,
                  definitionKind: 'DDL',
                  operation: 'tableDdl',
                },
              })
            }}
            onOpenInspector={() => {
              if (!activeTab.connectionId) {
                return
              }
              void inspectTable(
                activeTab.connectionId,
                activeObjectSummaryContext.schema,
                activeObjectSummaryContext.object,
                activeObjectSummaryContext.objectKind,
              )
            }}
            onOpenDiagram={() => {
              addTab({
                id: crypto.randomUUID(),
                kind: 'diagram',
                title: `${activeObjectSummaryContext.schema} ER`,
                sql: '',
                connectionId: activeTab.connectionId,
                diagramContext: {
                  database: activeObjectSummaryContext.database,
                  schema: activeObjectSummaryContext.schema,
                  tables: [activeObjectSummaryContext.object],
                },
              })
            }}
          />
        </div>
        <ObjectInspectorPanel />
      </main>
    )
  }

  if (activeDataContext) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <DataTabPanel
            key={activeTab.id}
            tab={{ ...activeTab, dataContext: activeDataContext }}
            result={activeResult}
            error={activeTab.error ?? null}
            running={activeTab.running === true}
            onRefresh={() => {
              if (activeTab.connectionId) {
                runQuery(activeTab.id, activeTab.connectionId, activeTab.sql, {
                  maxRows: activeDataContext.limit,
                })
              }
            }}
            onLimitChange={(limit) => {
              if (!activeTab.connectionId || !activeTab.dataContext) {
                return
              }
              if (limit > 10_000) {
                notify({
                  kind: 'warning',
                  title: '数据预览行数过大',
                  message: '单个 Data tab 最多 10000 行，已回退到当前值。',
                })
                return
              }
              const nextContext = { ...activeTab.dataContext, limit, offset: 0 }
              const nextSql = buildDataTabSql(dataContextToSqlInput(nextContext))
              updateDataTabContext(activeTab.id, nextContext, nextSql)
              runQuery(activeTab.id, activeTab.connectionId, nextSql, { maxRows: nextContext.limit })
            }}
            onContextChange={(patch) => {
              if (!activeTab.connectionId || !activeTab.dataContext) {
                return
              }
              const nextContext = { ...activeTab.dataContext, ...patch }
              const nextSql = buildDataTabSql(dataContextToSqlInput(nextContext))
              updateDataTabContext(activeTab.id, nextContext, nextSql)
              runQuery(activeTab.id, activeTab.connectionId, nextSql, { maxRows: nextContext.limit })
            }}
            onOpenSqlTab={() => {
              addTab({
                id: crypto.randomUUID(),
                kind: 'sql',
                title: `${activeDataContext.object} generated SQL`,
                sql: activeTab.sql,
                connectionId: activeTab.connectionId,
              })
            }}
            onExport={() =>
              activeResult &&
              exportCurrentResult(activeResult, activeTab.title, notify, notifyError, upsertTask)
            }
          />
        </div>
        <ObjectInspectorPanel />
      </main>
    )
  }

  const activeStructureContext =
    activeTab.kind === 'structure' ? activeTab.structureContext : null
  if (activeStructureContext) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <StructureTabPanel
            key={activeTab.id}
            tab={{ ...activeTab, structureContext: activeStructureContext }}
            onOpenDefinition={(title, definitionContext) => {
              addTab({
                id: crypto.randomUUID(),
                kind: 'definition',
                title,
                sql: '',
                connectionId: activeTab.connectionId,
                definitionContext,
              })
            }}
          />
        </div>
        <ObjectInspectorPanel />
      </main>
    )
  }

  const activeDefinitionContext =
    activeTab.kind === 'definition' ? activeTab.definitionContext : null
  if (activeDefinitionContext) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <DefinitionTabPanel
            key={activeTab.id}
            tab={{ ...activeTab, definitionContext: activeDefinitionContext }}
            onTextLoaded={(text) => updateTabSql(activeTab.id, text)}
            onOpenSqlTab={() => {
              addTab({
                id: crypto.randomUUID(),
                kind: 'sql',
                title: `${activeDefinitionContext.object} SQL`,
                sql: activeTab.sql,
                connectionId: activeTab.connectionId,
              })
            }}
          />
        </div>
        <ObjectInspectorPanel />
      </main>
    )
  }

  const activeDiagramContext = activeTab.kind === 'diagram' ? activeTab.diagramContext : null
  if (activeDiagramContext) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ERDiagram
            connectionId={activeTab.connectionId}
            database={activeDiagramContext.database}
            schema={activeDiagramContext.schema}
            tables={activeDiagramContext.tables}
          />
        </div>
        <ObjectInspectorPanel />
      </main>
    )
  }

  return (
    <main className="flex flex-1 overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <EditorToolbar
        connections={connections}
        connectionStatuses={Object.fromEntries(
          Object.entries(statuses).map(([id, status]) => [id, status.status]),
        )}
        connectionId={connectionId}
        database={selectedDatabase}
        schema={selectedSchema}
        databases={toolbarDatabases}
        schemas={toolbarSchemas}
        running={activeTab.running}
        canCancel={Boolean(activeTab.runningQueryId && queryCapabilities.canCancel)}
        canExplain={queryCapabilities.canExplain}
        explainUnsupportedReason="当前驱动暂不支持 Explain"
        disabled={!canRun}
        onConnectionChange={(id) => {
          updateTabConnection(activeTab.id, id)
          setActiveConnection(id)
          if (id) {
            const nextConnection = connections.find((connection) => connection.id === id)
            setCatalogSchemaPath({
              connectionId: id,
              database: catalogSchemaPaths[id]?.database ?? nextConnection?.database ?? null,
              schema: catalogSchemaPaths[id]?.schema ?? null,
              schemaListAvailable: true,
            })
          }
        }}
        onDatabaseChange={(database) => {
          if (!connectionId) return
          setCatalogSchemaPath({
            connectionId,
            database,
            schema: null,
            schemaListAvailable: true,
          })
        }}
        onSchemaChange={(schema) => {
          if (!connectionId) return
          setCatalogSchemaPath({
            connectionId,
            database: selectedDatabase,
            schema,
            schemaListAvailable: true,
          })
        }}
        onRun={execute}
        onCancel={cancel}
        onExplain={explain}
        onFormat={formatSql}
        />

        <div className="min-h-0 flex-1">
        {editorLoaded ? (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-card text-xs text-muted-foreground">
                正在加载 SQL 编辑器
              </div>
            }
          >
            <SqlEditor
              value={activeTab.sql}
              connectionId={queryCapabilities.canComplete ? connectionId : null}
              schema={selectedSchema}
              driverType={activeDriverType}
              showSystemObjects={showSystemObjects}
              onChange={(sql) => updateTabSql(activeTab.id, sql)}
              onRun={execute}
              onSelectionChange={setSelectedSql}
            />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col bg-card">
            <div className="flex h-9 items-center justify-between border-b px-3 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                轻量 SQL 输入{completionHint ? ` · ${completionHint}` : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7"
                onFocus={loadSqlEditor}
                onClick={() => setEditorLoaded(true)}
                onPointerEnter={loadSqlEditor}
              >
                加载高级编辑器
              </Button>
            </div>
            <textarea
              className="min-h-0 flex-1 resize-none bg-card p-3 font-mono text-[13px] leading-5 text-foreground outline-none"
              style={{ fontSize: editorFontSize, lineHeight: `${Math.max(18, editorFontSize + 7)}px` }}
              value={activeTab.sql}
              spellCheck={false}
              onChange={(event) => updateTabSql(activeTab.id, event.target.value)}
              onSelect={(event) => {
                const target = event.currentTarget
                setSelectedSql(target.value.slice(target.selectionStart, target.selectionEnd))
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void execute()
                }
              }}
            />
          </div>
        )}
        </div>

        <section className="flex h-[38%] min-h-48 flex-col border-t bg-background">
        <div className="flex h-9 items-center justify-between border-b px-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-medium">结果</span>
            {activeResult && (
              <span
                className={activeResult.truncated ? 'text-amber-600' : 'text-muted-foreground'}
                title={
                  activeResult.truncated
                    ? largeResultNotice(activeResult)
                    : undefined
                }
              >
                {activeResult.truncated ? largeResultNotice(activeResult) : resultSummary(activeResult)}
              </span>
            )}
            {activeResults && activeResults.length > 1 && (
              <span className="text-muted-foreground">{activeResults.length} 个结果集</span>
            )}
            {activeExplain && (
              <span className="text-muted-foreground">Explain · {activeExplain.elapsedMs} ms</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant={historyOpen ? 'secondary' : 'ghost'}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History className="size-3.5" />
              History
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={!activeResult || activeResult.columns.length === 0}
              onClick={() =>
                activeResult &&
                exportCurrentResult(activeResult, activeTab.title, notify, notifyError, upsertTask)
              }
            >
              <Download className="size-3.5" />
              导出 CSV
            </Button>
          {activeTab.error && (
            <div className="flex min-w-0 items-center gap-1 text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">查询执行失败</span>
            </div>
          )}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <div className="flex h-full min-h-0">
            <div className="min-w-0 flex-1">
              {activeTab.error ? (
                <ErrorDetails message={activeTab.error} sql={activeTab.sql} />
              ) : activeExplain ? (
                <pre className="h-full overflow-auto p-3 text-xs">
                  {JSON.stringify(activeExplain.plan, null, 2)}
                </pre>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  {activeQueryId && activeResults && activeResults.length > 1 && (
                    <ResultSetTabs
                      queryId={activeQueryId}
                      results={activeResults}
                      selectedIndex={selectedResultIndex}
                      onSelect={(index) =>
                        setResultIndexes((state) => ({ ...state, [activeQueryId]: index }))
                      }
                    />
                  )}
                  <div className="min-h-0 flex-1">
                    <DataGrid result={activeResult} />
                  </div>
                </div>
              )}
            </div>
            {historyOpen && (
              <SqlHistoryPanel
                connections={connections}
                activeConnectionId={connectionId}
                onReuse={(entry) => {
                  addTab({
                    id: crypto.randomUUID(),
                    kind: 'sql',
                    title: `${entry.connectionNameSnapshot} history`,
                    sql: entry.sql,
                    connectionId: entry.connectionId,
                  })
                  setActiveConnection(entry.connectionId)
                }}
              />
            )}
          </div>
        </div>
        </section>
      </div>
      <ObjectInspectorPanel />
    </main>
  )
}

function DataSourcesManagementPanel() {
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Data Sources</h1>
          <p className="truncate text-xs text-muted-foreground">
            Manage saved connections, drivers, imports, SSH, and advanced options.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ConnectionList mode="manager" />
      </div>
    </section>
  )
}

function WorkbenchHome({
  connections,
  activeConnectionId,
  onNewSql,
  onManageDataSources,
  onFocusExplorer,
}: {
  connections: ConnectionConfig[]
  activeConnectionId: string | null
  onNewSql: () => void
  onManageDataSources: () => void
  onFocusExplorer: () => void
}) {
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId)
  const recentDataSourceIds = useConnectionStore((state) => state.recentDataSourceIds)
  const recentConnections = recentDataSourceIds
    .map((id) => connections.find((connection) => connection.id === id))
    .filter((connection): connection is ConnectionConfig => Boolean(connection))
    .slice(0, 4)

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Workbench</h1>
          <p className="truncate text-xs text-muted-foreground">
            {activeConnection
              ? `${activeConnection.name} · ${activeConnection.driverType}`
              : 'No Data Source connected'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onNewSql}>
            <Plus className="size-3.5" />
            New SQL
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onManageDataSources}>
            <DatabaseIcon className="size-3.5" />
            Data Sources
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid max-w-4xl gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-3">
            <button
              type="button"
              className="rounded-md border bg-card p-4 text-left hover:bg-muted/45"
              onClick={onNewSql}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <FileCode2 className="size-4 text-primary" />
                New SQL tab
              </div>
              <div className="text-xs text-muted-foreground">
                {activeConnection
                  ? `Bound to ${activeConnection.name}.`
                  : 'Starts without a Data Source until one is selected.'}
              </div>
            </button>
            <button
              type="button"
              className="rounded-md border bg-card p-4 text-left hover:bg-muted/45"
              onClick={onFocusExplorer}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Search className="size-4 text-primary" />
                Search objects
              </div>
              <div className="text-xs text-muted-foreground">
                Use the Explorer object tree for the current Data Source.
              </div>
            </button>
          </div>
          <aside className="rounded-md border bg-card">
            <div className="border-b px-3 py-2 text-xs font-semibold">Recent Data Sources</div>
            <div className="grid gap-1 p-2">
              {recentConnections.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
                  Manage or connect a Data Source to populate recents.
                </div>
              ) : (
                recentConnections.map((connection) => (
                  <button
                    key={connection.id}
                    type="button"
                    className="rounded px-2 py-2 text-left text-xs hover:bg-muted"
                    onClick={onFocusExplorer}
                  >
                    <span className="block truncate font-medium">{connection.name}</span>
                    <span className="block truncate text-muted-foreground">
                      {connection.driverType}
                      {connection.colorTag ? ` · ${connection.colorTag}` : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}

function SqlHistoryPanel({
  connections,
  activeConnectionId,
  onReuse,
}: {
  connections: ConnectionConfig[]
  activeConnectionId: string | null
  onReuse: (entry: QueryHistoryEntry) => void
}) {
  const history = useQueryHistoryStore((state) => state.entries)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const clearHistory = useQueryHistoryStore((state) => state.clear)
  const loading = useQueryHistoryStore((state) => state.loading)
  const notify = useUiStore((state) => state.notify)
  const [statusFilter, setStatusFilter] = useState<'all' | QueryHistoryStatus>('all')
  const [connectionFilter, setConnectionFilter] = useState(activeConnectionId ?? 'all')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const connectionOptions = useMemo(
    () => uniqueHistoryConnections(history, connections),
    [history, connections],
  )
  const filtered = history.filter((entry) => {
    const statusMatches = statusFilter === 'all' || entry.status === statusFilter
    const connectionMatches = connectionFilter === 'all' || entry.connectionId === connectionFilter
    return statusMatches && connectionMatches
  })

  async function handleClear() {
    if (history.length === 0 || loading) return
    if (!confirmClear) {
      setConfirmClear(true)
      window.setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    const cleared = await clearHistory()
    setConfirmClear(false)
    if (cleared) {
      notify({ kind: 'success', title: 'Query history cleared' })
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-card">
      <div className="flex h-9 items-center justify-between border-b px-3 text-xs">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <Clock3 className="size-3.5 text-muted-foreground" />
          <span>Query History</span>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant={confirmClear ? 'destructive' : 'ghost'}
          disabled={history.length === 0 || loading}
          title={confirmClear ? 'Confirm clear history' : 'Clear history'}
          onClick={() => void handleClear()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 border-b p-2">
        <select
          className="ide-select h-7 text-xs"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | QueryHistoryStatus)}
        >
          <option value="all">All status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
        <select
          className="ide-select h-7 text-xs"
          value={connectionFilter}
          onChange={(event) => setConnectionFilter(event.target.value)}
        >
          <option value="all">All Data Sources</option>
          {connectionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
            {history.length === 0 ? 'Executed SQL appears here.' : 'No history matches the filters.'}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.slice(0, 60).map((entry) => (
              <section key={entry.id} className="rounded-md border bg-background/70 text-xs">
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-left hover:bg-muted/45"
                  onClick={() => setPreviewId(previewId === entry.id ? null : entry.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px]">{sqlPreview(entry.sql)}</span>
                    <span className={entry.status === 'success' ? 'text-emerald-600' : 'text-destructive'}>
                      {entry.status === 'success' ? 'OK' : 'ERR'}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {entry.connectionNameSnapshot} · {formatHistoryTime(entry.startedAt)}
                  </div>
                </button>
                {previewId === entry.id && (
                  <div className="grid gap-2 border-t p-2">
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-muted/35 p-2 font-mono text-[11px]">
                      {entry.sql.trim() || 'Blank query'}
                    </pre>
                    {entry.errorMessage && (
                      <div className="max-h-20 overflow-auto whitespace-pre-wrap rounded border border-destructive/20 bg-destructive/10 p-2 text-[11px] text-destructive">
                        {entry.errorCode ? `${entry.errorCode}: ` : ''}
                        {entry.errorMessage}
                      </div>
                    )}
                    <Button type="button" size="xs" variant="secondary" onClick={() => onReuse(entry)}>
                      Reuse SQL
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function ObjectSummaryTabPanel({
  tab,
  onOpenDataPreview,
  onOpenStructure,
  onOpenDefinition,
  onOpenInspector,
  onOpenDiagram,
}: {
  tab: EditorTab & { objectSummaryContext: NonNullable<EditorTab['objectSummaryContext']> }
  onOpenDataPreview: () => void
  onOpenStructure: () => void
  onOpenDefinition: () => void
  onOpenInspector: () => void
  onOpenDiagram: () => void
}) {
  const context = tab.objectSummaryContext
  const qualified = [context.database, context.schema, context.object].filter(Boolean).join('.')

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border bg-muted/45 px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            {context.objectKind}
          </span>
          <h1 className="min-w-0 truncate text-lg font-semibold">{context.object}</h1>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{qualified}</p>
      </div>
      <div className="grid max-w-3xl gap-4 p-5">
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Summary</h2>
          <div className="grid gap-2 rounded-md border bg-card p-3 text-sm">
            <SummaryFact label="Data Source" value={tab.connectionId ?? '-'} />
            <SummaryFact label="Schema" value={context.schema} />
            <SummaryFact label="Object" value={context.object} />
            <SummaryFact label="Driver" value={context.driverType} />
          </div>
        </section>
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onOpenDataPreview}>
              <DatabaseIcon className="size-3.5" />
              Preview data
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenStructure}>
              <FileCode2 className="size-3.5" />
              Structure
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenDefinition}>
              <FileCode2 className="size-3.5" />
              DDL
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenInspector}>
              <FileCode2 className="size-3.5" />
              Inspector
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenDiagram}>
              <FileCode2 className="size-3.5" />
              ER Diagram
            </Button>
          </div>
        </section>
      </div>
    </section>
  )
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  )
}

function DataTabPanel({
  tab,
  result,
  error,
  running,
  onRefresh,
  onLimitChange,
  onContextChange,
  onOpenSqlTab,
  onExport,
}: {
  tab: EditorTab & { dataContext: NonNullable<EditorTab['dataContext']> }
  result?: QueryResult
  error: string | null
  running: boolean
  onRefresh: () => void
  onLimitChange: (limit: number) => void
  onContextChange: (patch: Partial<NonNullable<EditorTab['dataContext']>>) => void
  onOpenSqlTab: () => void
  onExport: () => void
}) {
  const notifyError = useUiStore((state) => state.notifyError)
  const notify = useUiStore((state) => state.notify)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const [limitText, setLimitText] = useState(String(tab.dataContext.limit))
  const [whereText, setWhereText] = useState(tab.dataContext.wherePredicate ?? '')
  const [importPath, setImportPath] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const page = Math.floor(tab.dataContext.offset / tab.dataContext.limit) + 1
  const hasPrimaryKeyOrder =
    !tab.dataContext.sortColumn && tab.dataContext.primaryKeyColumns.length > 0
  const hasNoStableOrder =
    !tab.dataContext.sortColumn && tab.dataContext.primaryKeyColumns.length === 0

  function applyLimit() {
    const value = Number(limitText)
    if (!Number.isFinite(value) || value < 1) {
      setLimitText(String(tab.dataContext.limit))
      return
    }
    if (value > 10_000) {
      setLimitText(String(tab.dataContext.limit))
      onLimitChange(Math.round(value))
      return
    }
    onLimitChange(Math.round(value))
  }

  function applyWhere() {
    onContextChange({ wherePredicate: whereText.trim() || null, offset: 0 })
  }

  function changeSort(column: string | null) {
    onContextChange({
      sortColumn: column,
      sortDirection: column ? tab.dataContext.sortDirection ?? 'asc' : null,
      offset: 0,
    })
  }

  async function exportSelectedTable() {
    if (!tab.connectionId) {
      return
    }

    try {
      const directory = await downloadDir()
      const fileName = `${safeFileName(`${tab.dataContext.schema}-${tab.dataContext.object}`)}-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.csv`
      const path = await join(directory, fileName)
      const task = await exportTableCsv({
        connectionId: tab.connectionId,
        driverType: tab.dataContext.driverType,
        schema: tab.dataContext.schema,
        table: tab.dataContext.object,
        path,
        includeHeader: true,
      })
      upsertTask(task)
      notify({
        kind: 'info',
        title: '整表 CSV 导出已开始',
        message: fileName,
      })
    } catch (exportError) {
      notifyError(normalizeAppError(exportError), '启动整表导出失败')
    }
  }

  async function previewCsvImport() {
    if (!tab.connectionId || !importPath.trim()) {
      return
    }

    setImportBusy(true)
    try {
      const preview = await previewTableCsvImport({
        connectionId: tab.connectionId,
        schema: tab.dataContext.schema,
        table: tab.dataContext.object,
        path: importPath.trim(),
        hasHeader: true,
        previewRows: 20,
      })
      setImportPreview(preview)
      notify({
        kind: preview.canImport && preview.invalidRows.length === 0 ? 'info' : 'warning',
        title: 'CSV 导入预览完成',
        message: `${preview.validRows.toLocaleString()} valid / ${preview.totalRows.toLocaleString()} rows`,
      })
    } catch (previewError) {
      setImportPreview(null)
      notifyError(normalizeAppError(previewError), 'CSV 导入预览失败')
    } finally {
      setImportBusy(false)
    }
  }

  async function startCsvImport() {
    if (!tab.connectionId || !importPreview?.canImport) {
      return
    }

    setImportBusy(true)
    try {
      const task = await importTableCsv({
        connectionId: tab.connectionId,
        driverType: tab.dataContext.driverType,
        schema: tab.dataContext.schema,
        table: tab.dataContext.object,
        path: importPreview.path,
        hasHeader: true,
        emptyAsNull: true,
      })
      upsertTask(task)
      notify({
        kind: 'info',
        title: 'CSV 导入已开始',
        message: `${importPreview.validRows.toLocaleString()} rows queued`,
      })
    } catch (importError) {
      notifyError(normalizeAppError(importError), '启动 CSV 导入失败')
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b ide-toolbar px-3 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{tab.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Data tab · read-only ·{' '}
              {tab.dataContext.database ? `${tab.dataContext.database} / ` : ''}
              {tab.dataContext.schema} / {tab.dataContext.object}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1 text-muted-foreground">
            <span>Limit</span>
            <input
              className="h-7 w-20 rounded-md border bg-background px-2 text-right text-foreground"
              type="number"
              min={1}
              max={10_000}
              value={limitText}
              onChange={(event) => setLimitText(event.target.value)}
              onBlur={applyLimit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyLimit()
                }
              }}
            />
          </label>
          <Button type="button" size="sm" variant="outline" disabled={running} onClick={onRefresh}>
            <RefreshCw />
            {running ? '刷新中' : '刷新'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onOpenSqlTab}>
            在 SQL Tab 中打开
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!result || result.columns.length === 0}
            onClick={onExport}
          >
            <Download className="size-3.5" />
            导出 CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!tab.connectionId}
            onClick={() => void exportSelectedTable()}
          >
            <Download className="size-3.5" />
            导出整表
          </Button>
        </div>
      </div>
      <div className="flex h-8 items-center gap-2 border-b bg-muted/20 px-3 text-[11px] text-muted-foreground">
        <span>只读数据预览</span>
        {result && <span>{resultSummary(result)}</span>}
        <span>Page {page}</span>
        {hasPrimaryKeyOrder && <span>按主键升序</span>}
        {hasNoStableOrder && <span className="text-amber-600">无主键，结果顺序不保证</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5 text-xs">
          <input
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px]"
            placeholder="WHERE predicate"
            value={whereText}
            onChange={(event) => setWhereText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyWhere()
              }
            }}
          />
          <Button type="button" size="xs" variant="secondary" disabled={running} onClick={applyWhere}>
            应用过滤
          </Button>
          <select
            className="ide-select h-7 min-w-32"
            value={tab.dataContext.sortColumn ?? ''}
            onChange={(event) => changeSort(event.target.value || null)}
          >
            <option value="">排序</option>
            {result?.columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!tab.dataContext.sortColumn}
            title="切换排序方向"
            onClick={() =>
              onContextChange({
                sortDirection: tab.dataContext.sortDirection === 'desc' ? 'asc' : 'desc',
                offset: 0,
              })
            }
          >
            {tab.dataContext.sortDirection === 'desc' ? <ArrowDownAZ /> : <ArrowUpAZ />}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={running || tab.dataContext.offset === 0}
            onClick={() =>
              onContextChange({
                offset: Math.max(0, tab.dataContext.offset - tab.dataContext.limit),
              })
            }
          >
            上一页
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={running}
            onClick={() =>
              onContextChange({
                offset: tab.dataContext.offset + tab.dataContext.limit,
              })
            }
          >
            下一页
          </Button>
        </div>
        <div className="flex min-h-10 items-center gap-2 border-b bg-muted/10 px-3 py-1.5 text-xs">
          <Upload className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px]"
            placeholder="CSV import path"
            value={importPath}
            onChange={(event) => {
              setImportPath(event.target.value)
              setImportPreview(null)
            }}
          />
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={importBusy || !importPath.trim()}
            onClick={() => void previewCsvImport()}
          >
            预览导入
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={importBusy || !importPreview?.canImport}
            onClick={() => void startCsvImport()}
          >
            执行导入
          </Button>
          {importPreview && (
            <span
              className={
                importPreview.invalidRows.length > 0
                  ? 'max-w-80 truncate text-amber-600'
                  : 'max-w-80 truncate text-muted-foreground'
              }
              title={importPreview.invalidRows[0]?.message}
            >
              {importPreview.validRows.toLocaleString()} valid /{' '}
              {importPreview.totalRows.toLocaleString()} rows
              {importPreview.invalidRows.length > 0
                ? ` · ${importPreview.invalidRows.length} invalid`
                : ''}
            </span>
          )}
        </div>
        <textarea
          className="h-20 shrink-0 resize-none border-b bg-muted/20 p-2 font-mono text-[11px] text-muted-foreground outline-none"
          readOnly
          value={tab.sql}
          aria-label="generated SQL"
        />
        <div className="min-h-0 flex-1">
        {error ? (
          <ErrorDetails message={error} />
        ) : (
          <DataGrid result={result} />
        )}
        </div>
      </div>
    </section>
  )
}

type StructureSection = 'columns' | 'indexes' | 'foreignKeys' | 'triggers' | 'ddl'

function StructureTabPanel({
  tab,
  onOpenDefinition,
}: {
  tab: EditorTab & { structureContext: NonNullable<EditorTab['structureContext']> }
  onOpenDefinition: (
    title: string,
    context: NonNullable<EditorTab['definitionContext']>,
  ) => void
}) {
  const metadata = useMetadataStore()
  const notifyError = useUiStore((state) => state.notifyError)
  const [section, setSection] = useState<StructureSection>('columns')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([])
  const [triggers, setTriggers] = useState<DbObjectInfo[]>([])
  const [ddl, setDdl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const context = tab.structureContext

  async function loadStructure(force = false) {
    if (!tab.connectionId) {
      return
    }

    setLoading(true)
    setError(null)
    try {
      const [nextColumns, nextIndexes, nextForeignKeys, nextTriggers, nextDdl] =
        await Promise.all([
          metadata.loadColumns(tab.connectionId, context.schema, context.object, force),
          metadata.loadIndexes(tab.connectionId, context.schema, context.object, force),
          metadata.loadForeignKeys(tab.connectionId, context.schema, context.object, force),
          metadata.loadSchemaObjects(tab.connectionId, context.schema, 'trigger', force),
          getTableDdl(tab.connectionId, context.schema, context.object),
        ])
      setColumns(nextColumns)
      setIndexes(nextIndexes)
      setForeignKeys(nextForeignKeys)
      setTriggers(nextTriggers)
      setDdl(nextDdl)
    } catch (loadError) {
      const appError = normalizeAppError(loadError)
      setError(appError.message)
      notifyError(appError, '加载结构失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadStructure(false)
    })
    // Structure context is immutable for the tab lifetime; reload when tab identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.connectionId, context.schema, context.object])

  function openTriggerDefinition(trigger: DbObjectInfo) {
    onOpenDefinition(`${trigger.name} Source`, {
      database: context.database,
      schema: context.schema,
      object: trigger.name,
      objectKind: 'trigger',
      definitionKind: 'Source',
      operation: 'objectDdl',
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b ide-toolbar px-3 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{tab.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Structure tab · read-only · {context.database ? `${context.database} / ` : ''}
              {context.schema} / {context.object}
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => loadStructure(true)}
        >
          <RefreshCw />
          {loading ? '刷新中' : '刷新结构'}
        </Button>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/20 px-2 text-xs">
        {structureSections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={[
              'h-7 rounded-md px-2',
              section === item.id
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            ].join(' ')}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">只读结构信息</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <ErrorDetails message={error} />
        ) : loading && columns.length === 0 && ddl.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            正在加载结构
          </div>
        ) : section === 'columns' ? (
          <ColumnsView columns={columns} />
        ) : section === 'indexes' ? (
          <IndexesView indexes={indexes} />
        ) : section === 'foreignKeys' ? (
          <ForeignKeysView foreignKeys={foreignKeys} />
        ) : section === 'triggers' ? (
          <TriggersView triggers={triggers} onOpenDefinition={openTriggerDefinition} />
        ) : (
          <textarea
            className="h-full w-full resize-none bg-card p-3 font-mono text-xs leading-5 outline-none"
            readOnly
            spellCheck={false}
            value={ddl}
            aria-label="read-only DDL"
          />
        )}
      </div>
    </section>
  )
}

const structureSections: Array<{ id: StructureSection; label: string }> = [
  { id: 'columns', label: 'Columns' },
  { id: 'indexes', label: 'Indexes' },
  { id: 'foreignKeys', label: 'Foreign Keys' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'ddl', label: 'DDL' },
]

function ColumnsView({ columns }: { columns: ColumnInfo[] }) {
  if (columns.length === 0) {
    return <StructureEmpty label="No columns" />
  }

  return (
    <StructureTable
      headers={['#', 'Column', 'Type', 'Nullable', 'Default', 'PK']}
      rows={columns.map((column) => [
        String(column.ordinalPosition),
        column.name,
        column.dataType,
        column.nullable ? 'YES' : 'NO',
        column.defaultValue ?? '',
        column.isPrimaryKey ? 'PK' : '',
      ])}
    />
  )
}

function IndexesView({ indexes }: { indexes: IndexInfo[] }) {
  if (indexes.length === 0) {
    return <StructureEmpty label="No indexes" />
  }

  return (
    <StructureTable
      headers={['Index', 'Columns', 'Unique', 'Definition']}
      rows={indexes.map((index) => [
        index.name,
        index.columns.join(', '),
        index.unique ? 'YES' : 'NO',
        index.definition ?? '',
      ])}
    />
  )
}

function ForeignKeysView({ foreignKeys }: { foreignKeys: ForeignKeyInfo[] }) {
  if (foreignKeys.length === 0) {
    return <StructureEmpty label="No foreign keys" />
  }

  return (
    <StructureTable
      headers={['Name', 'Columns', 'Referenced Table', 'Referenced Columns']}
      rows={foreignKeys.map((key) => [
        key.name,
        key.columns.join(', '),
        [key.referencedSchema, key.referencedTable].filter(Boolean).join('.'),
        key.referencedColumns.join(', '),
      ])}
    />
  )
}

function TriggersView({
  triggers,
  onOpenDefinition,
}: {
  triggers: DbObjectInfo[]
  onOpenDefinition: (trigger: DbObjectInfo) => void
}) {
  if (triggers.length === 0) {
    return <StructureEmpty label="No triggers" />
  }

  return (
    <div className="min-w-[720px] text-xs">
      <div className="grid grid-cols-[minmax(220px,1fr)_160px_120px_120px] border-b bg-muted/45 font-medium">
        <div className="border-r px-2 py-1.5">Trigger</div>
        <div className="border-r px-2 py-1.5">Type</div>
        <div className="border-r px-2 py-1.5">Status</div>
        <div className="px-2 py-1.5">Definition</div>
      </div>
      {triggers.map((trigger) => (
        <div
          key={`${trigger.schema ?? ''}.${trigger.name}`}
          className="grid grid-cols-[minmax(220px,1fr)_160px_120px_120px] border-b hover:bg-accent/35"
        >
          <div className="min-w-0 truncate border-r px-2 py-1.5 font-mono">{trigger.name}</div>
          <div className="min-w-0 truncate border-r px-2 py-1.5">{trigger.objectType ?? 'trigger'}</div>
          <div className="min-w-0 truncate border-r px-2 py-1.5">{trigger.status ?? ''}</div>
          <div className="px-2 py-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => onOpenDefinition(trigger)}
            >
              打开 Source/DDL
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function StructureTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const template = `repeat(${headers.length}, minmax(140px, 1fr))`

  return (
    <div className="min-w-[720px] text-xs">
      <div className="grid border-b bg-muted/45 font-medium" style={{ gridTemplateColumns: template }}>
        {headers.map((header) => (
          <div key={header} className="border-r px-2 py-1.5 last:border-r-0">
            {header}
          </div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="grid border-b hover:bg-accent/35"
          style={{ gridTemplateColumns: template }}
        >
          {row.map((cell, cellIndex) => (
            <div
              key={`${rowIndex}-${cellIndex}`}
              className="min-w-0 truncate border-r px-2 py-1.5 font-mono last:border-r-0"
              title={cell}
            >
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function StructureEmpty({ label }: { label: string }) {
  return (
    <div className="grid h-full min-h-40 place-items-center text-xs text-muted-foreground">
      {label}
    </div>
  )
}

function DefinitionTabPanel({
  tab,
  onTextLoaded,
  onOpenSqlTab,
}: {
  tab: EditorTab & { definitionContext: NonNullable<EditorTab['definitionContext']> }
  onTextLoaded: (text: string) => void
  onOpenSqlTab: () => void
}) {
  const notify = useUiStore((state) => state.notify)
  const notifyError = useUiStore((state) => state.notifyError)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const context = tab.definitionContext

  async function loadDefinition(force = false) {
    if (!tab.connectionId) {
      return
    }

    setLoading(true)
    setError(null)
    try {
      const text =
        context.operation === 'tableDdl'
          ? await getTableDdl(tab.connectionId, context.schema, context.object, force)
          : await getObjectDdl(
              tab.connectionId,
              context.schema,
              context.object,
              context.objectKind,
              force,
            )
      onTextLoaded(text)
    } catch (loadError) {
      const appError = normalizeAppError(loadError)
      setError(appError.message)
      notifyError(appError, `加载 ${context.definitionKind} 失败`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!tab.sql) {
      queueMicrotask(() => {
        void loadDefinition(false)
      })
    }
    // Definition context is immutable for the tab lifetime; reload only when the tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.connectionId, context.schema, context.object, context.objectKind])

  async function copyDefinition() {
    try {
      await navigator.clipboard.writeText(tab.sql)
      notify({ kind: 'success', title: `已复制 ${context.definitionKind}` })
    } catch (copyError) {
      notifyError(normalizeAppError(copyError), '复制失败')
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b ide-toolbar px-3 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <LockKeyhole className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{tab.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {context.definitionKind} tab · read-only ·{' '}
              {context.database ? `${context.database} / ` : ''}
              {context.schema} / {context.object}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!tab.sql}
            onClick={copyDefinition}
          >
            复制
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!tab.sql} onClick={onOpenSqlTab}>
            在 SQL Tab 中打开
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => loadDefinition(true)}
          >
            <RefreshCw />
            {loading ? '刷新中' : `刷新 ${context.definitionKind}`}
          </Button>
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/20 px-3 text-[11px] text-muted-foreground">
        <span>只读定义</span>
        <span>查找使用编辑器内置 Cmd/Ctrl+F</span>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <DefinitionError context={context} message={error} />
        ) : loading && !tab.sql ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            正在加载 {context.definitionKind}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-card text-xs text-muted-foreground">
                正在加载只读编辑器
              </div>
            }
          >
            <SqlEditor
              value={tab.sql}
              connectionId={null}
              schema={context.schema}
              readOnly
              onChange={() => undefined}
              onRun={() => undefined}
            />
          </Suspense>
        )}
      </div>
    </section>
  )
}

function DefinitionError({
  context,
  message,
}: {
  context: NonNullable<EditorTab['definitionContext']>
  message: string
}) {
  return (
    <div className="h-full overflow-auto bg-destructive/5 p-3">
      <div className="rounded-md border border-destructive/25 bg-background p-3 text-xs">
        <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>加载 {context.definitionKind} 失败</span>
        </div>
        <div className="grid gap-1 text-muted-foreground">
          <div>对象：{context.schema}.{context.object}</div>
          <div>操作：{context.operation === 'tableDdl' ? '读取表结构 DDL' : '读取对象 Source/DDL'}</div>
          <div>可能原因：权限不足、对象不存在或驱动不支持该对象定义。</div>
        </div>
        <pre className="mt-3 max-h-56 overflow-auto rounded border bg-muted/45 p-2 text-[11px] leading-5 text-destructive">
          {message}
        </pre>
      </div>
    </div>
  )
}

function ErrorDetails({ message, sql }: { message: string; sql?: string }) {
  const [summary, ...details] = message.split('\n')
  const detail = details.join('\n').trim()
  const copyText = [message, sql ? `\nSQL:\n${sql}` : ''].join('')

  return (
    <div className="h-full overflow-auto bg-destructive/5 p-3">
      <div className="rounded-md border border-destructive/25 bg-background p-3 text-xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-medium text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>查询执行失败</span>
          </div>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => navigator.clipboard?.writeText(copyText)}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
        <div className="whitespace-pre-wrap break-words text-destructive">{summary}</div>
        {detail && (
          <pre className="mt-3 max-h-52 overflow-auto rounded border bg-muted/45 p-2 text-[11px] leading-5 text-muted-foreground">
            {detail}
          </pre>
        )}
        {sql && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
              SQL
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-muted/35 p-2 font-mono text-[11px] leading-5">
              {sql.trim() || 'Blank query'}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultSetTabs({
  queryId,
  results,
  selectedIndex,
  onSelect,
}: {
  queryId: string
  results: QueryResult[]
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b bg-muted/20 px-2 text-xs">
      {results.map((result, index) => {
        const selected = index === selectedIndex
        return (
          <button
            key={`${queryId}-${index}`}
            type="button"
            className={[
              'h-7 shrink-0 rounded-md border px-2 text-left',
              selected
                ? 'border-border bg-background text-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            ].join(' ')}
            onClick={() => onSelect(index)}
          >
            <span className="font-medium">结果 {index + 1}</span>
            <span className="ml-2 text-muted-foreground">{compactResultSummary(result)}</span>
          </button>
        )
      })}
    </div>
  )
}

function confirmDangerousSql(risk: SqlRiskAnalysis, production: boolean) {
  const title = production
    ? '生产环境危险 SQL 确认'
    : '危险 SQL 确认'
  const environmentLine = production
    ? '当前连接标记为 prod，请确认你确实要在生产环境执行。'
    : '此 SQL 可能修改或删除大量数据。'
  const reasons = risk.reasons.map(formatSqlRiskReason).join('\n')

  return window.confirm(`${title}\n\n${environmentLine}\n\n检测到：\n${reasons}\n\n继续执行？`)
}

function driverQueryCapabilities(driverType: DriverType): QueryCapabilities {
  switch (driverType) {
    case 'postgres':
      return {
        canQuery: true,
        canExplain: true,
        canCancel: true,
        canReadMetadata: true,
        canComplete: true,
      }
    case 'mysql':
      return {
        canQuery: true,
        canExplain: true,
        canCancel: false,
        canReadMetadata: true,
        canComplete: true,
      }
    case 'oracle':
      return {
        canQuery: true,
        canExplain: false,
        canCancel: false,
        canReadMetadata: true,
        canComplete: true,
      }
    case 'sqlite':
      return {
        canQuery: true,
        canExplain: true,
        canCancel: false,
        canReadMetadata: true,
        canComplete: false,
      }
    case 'jdbc':
      return {
        canQuery: true,
        canExplain: false,
        canCancel: false,
        canReadMetadata: false,
        canComplete: false,
      }
    default:
      return emptyQueryCapabilities()
  }
}

function filterCompletionSchemas<T extends { name: string }>(
  driverType: DriverType,
  schemas: T[],
  showSystemObjects: boolean,
) {
  return showSystemObjects
    ? schemas
    : schemas.filter((schema) => !isSystemSchema(driverType, schema.name))
}

function emptyQueryCapabilities(): QueryCapabilities {
  return {
    canQuery: false,
    canExplain: false,
    canCancel: false,
    canReadMetadata: false,
    canComplete: false,
  }
}

function formatSqlRiskReason(reason: SqlRiskReason) {
  switch (reason) {
    case 'dropStatement':
      return '- DROP 语句'
    case 'truncateStatement':
      return '- TRUNCATE 语句'
    case 'deleteWithoutWhere':
      return '- DELETE 缺少 WHERE'
    case 'updateWithoutWhere':
      return '- UPDATE 缺少 WHERE'
  }
}

function resultSummary(result: QueryResult) {
  if (result.columns.length === 0) {
    if (result.elapsedMs === 0 && result.affectedRows === 0) {
      return '正在接收结果'
    }
    return `影响 ${result.affectedRows.toLocaleString()} 行 · ${result.elapsedMs} ms`
  }

  return `${result.rowCount.toLocaleString()} 行${result.truncated ? '，已截断' : ''} · ${result.elapsedMs} ms`
}

function largeResultNotice(result: QueryResult) {
  return `结果较大，已显示前 ${result.maxRows ?? result.rowCount} 行`
}

function sqlPreview(sql: string) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview || 'Blank query'
}

function uniqueHistoryConnections(
  history: { connectionId: string; connectionNameSnapshot: string }[],
  connections: ConnectionConfig[],
) {
  const names = new Map(connections.map((connection) => [connection.id, connection.name]))
  for (const entry of history) {
    if (!names.has(entry.connectionId)) {
      names.set(entry.connectionId, entry.connectionNameSnapshot)
    }
  }
  return Array.from(names, ([id, name]) => ({ id, name })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function nextSqlIndex(titles: string[]) {
  let index = 1
  const existing = new Set(titles)
  while (existing.has(`SQL ${index}`)) index += 1
  return index
}

function compactResultSummary(result: QueryResult) {
  if (result.columns.length === 0) {
    return result.elapsedMs === 0 && result.affectedRows === 0
      ? '接收中'
      : `${result.affectedRows.toLocaleString()} affected`
  }
  return `${result.rowCount.toLocaleString()} rows`
}

function completionMetadataHint(
  connected: boolean,
  canComplete: boolean,
  selectedSchema: string | null,
) {
  if (!connected) return '连接后加载补全元数据'
  if (!canComplete) return '当前驱动暂不支持元数据补全'
  if (!selectedSchema) return '选择 Schema 后启用对象补全'
  return null
}

async function exportCurrentResult(
  result: QueryResult,
  title: string,
  notify: (notification: Omit<AppNotification, 'id'>) => void,
  notifyError: (error: AppError, title?: string) => void,
  upsertTask: (task: TaskInfo) => void,
) {
  try {
    const directory = await downloadDir()
    const fileName = `${safeFileName(title || 'query-result')}-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.csv`
    const path = await join(directory, fileName)
    const task = await exportQueryResultCsv({ result, path, includeHeader: true })
    upsertTask(task)
    notify({
      kind: 'info',
      title: 'CSV 导出已开始',
      message: fileName,
    })
  } catch (error) {
    notifyError(normalizeAppError(error), '启动 CSV 导出失败')
  }
}

function dataContextToSqlInput(context: NonNullable<EditorTab['dataContext']>) {
  return {
    driverType: context.driverType,
    schema: context.schema,
    table: context.object,
    limit: context.limit,
    offset: context.offset,
    wherePredicate: context.wherePredicate,
    sortColumn: context.sortColumn,
    sortDirection: context.sortDirection,
    primaryKeyColumns: context.primaryKeyColumns,
  }
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'query-result'
}
