import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import i18n from '@/i18n'
import { useTranslation } from 'react-i18next'
import { downloadDir, join } from '@tauri-apps/api/path'
import { AlertCircle, ArrowDownAZ, ArrowUpAZ, ChevronLeft, ChevronRight, Clock3, Copy, Database as DatabaseIcon, Download, FileCode2, History, Loader2, LockKeyhole, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { ConnectionEditorPanel } from '@/components/connection/ConnectionEditorPanel'
import { ConnectionList } from '@/components/connection/ConnectionList'
import { DataGrid } from '@/components/grid/DataGrid'
import { ERDiagram } from '@/components/diagram/ERDiagram'
import { ObjectInspectorPanel } from '@/components/inspector/ObjectInspectorPanel'
import { SettingsWorkspacePanel } from '@/components/settings/SettingsWorkspacePanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/app-select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useQuery } from '@/hooks/useQuery'
import {
  exportQueryResultCsv,
  exportTableCsv,
  importTableCsv,
  previewTableCsvImport,
  type ImportPreview,
} from '@/ipc/export'
import { getObjectDdl, getTableDdl } from '@/ipc/metadata'
import { buildDataTabSql, dataTabFetchLimit } from '@/lib/dataTabSql'
import { isSystemSchema } from '@/lib/systemObjects'
import { normalizeAppError } from '@/ipc/client'
import { analyzeSqlRisk, type SqlRiskAnalysis, type SqlRiskReason } from '@/ipc/query'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useSqlDraftStore } from '@/stores/sqlDraftStore'
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
  const { t } = useTranslation()
  const { connections, dataSourceGroups, statuses, connectConnection, setActiveConnection } = useConnectionStore()
  const {
    tabs,
    activeTabId,
    addTab,
    updateTabSql,
    updateDataTabContext,
    updateTabConnection,
    setTabDraft,
    setTabQueryState,
  } = useEditorStore()
  const results = useQueryResultStore((state) => state.results)
  const explains = useQueryResultStore((state) => state.explains)
  const resultSources = useQueryResultStore((state) => state.sources)
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
  const loadSqlDrafts = useSqlDraftStore((state) => state.loadDrafts)
  const saveTabDraft = useSqlDraftStore((state) => state.saveTabDraft)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const queryMaxRows = useUiStore((state) => state.queryMaxRows)
  const setQueryMaxRows = useUiStore((state) => state.setQueryMaxRows)
  const dataPreviewDefaultRows = useUiStore((state) => state.dataPreviewDefaultRows)
  const showSystemObjects = useUiStore((state) => state.showSystemObjects)
  const queryHistoryRequest = useUiStore((state) => state.queryHistoryRequest)
  const exportDirectory = useUiStore((state) => state.exportDirectory)
  const { runQuery, runExplain, cancelRunningQuery } = useQuery()
  const [selectedSql, setSelectedSql] = useState({ tabId: null as string | null, sql: '' })
  const [editorLoaded, setEditorLoaded] = useState(false)
  const [editorShouldFocus, setEditorShouldFocus] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [resultIndexes, setResultIndexes] = useState<Record<string, number>>({})
  const draftSaveTimer = useRef<number | null>(null)
  const handledHistoryRequest = useRef(0)

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
      ? activeDriverType === 'postgres'
        ? activeConnection?.database ?? null
        : catalogSchemaPath?.database ?? activeConnection?.database ?? null
      : null
  const selectedSchema = connectionId != null ? catalogSchemaPath?.schema ?? null : null
  const connectionIsConnected = Boolean(
    connectionId && statuses[connectionId]?.status === 'connected',
  )
  const canRun = Boolean(
    activeTab &&
      connectionId &&
      queryCapabilities.canQuery &&
      sqlForToolbarExecution(activeTab, selectedSql).trim(),
  )
  const canFormat = Boolean(activeTab && sqlForToolbarExecution(activeTab, selectedSql).trim())
  const activeQueryId = activeTab?.lastQueryId ?? null
  const activeResults = activeQueryId ? results[activeQueryId] : undefined
  const activeExplain = activeQueryId ? explains[activeQueryId] : undefined
  const rawResultIndex = activeQueryId ? resultIndexes[activeQueryId] ?? 0 : 0
  const selectedResultIndex = activeResults?.length
    ? Math.min(rawResultIndex, activeResults.length - 1)
    : 0
  const activeResult = activeResults?.[selectedResultIndex]
  const activeResultSource = activeQueryId ? resultSources[activeQueryId] : undefined
  const activeResultConnection = activeResultSource
    ? connections.find((connection) => connection.id === activeResultSource.connectionId) ?? null
    : null
  const toolbarDatabases =
    connectionId && activeDriverType === 'postgres' && activeConnection?.database
      ? [{ name: activeConnection.database }]
      : connectionId
        ? metadataDatabases[connectionId] ?? []
        : []
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

  useEffect(() => {
    if (
      queryHistoryRequest > handledHistoryRequest.current &&
      (activeTab?.kind === 'sql' || !activeTab?.kind)
    ) {
      handledHistoryRequest.current = queryHistoryRequest
      window.setTimeout(() => setHistoryOpen(true), 0)
    }
  }, [activeTab?.kind, queryHistoryRequest])

  useEffect(() => {
    void loadSqlDrafts()
  }, [loadSqlDrafts])

  useEffect(() => {
    if (draftSaveTimer.current) {
      window.clearTimeout(draftSaveTimer.current)
    }

    draftSaveTimer.current = window.setTimeout(() => {
      for (const tab of tabs) {
        if (tab.kind && tab.kind !== 'sql') continue
        if (!tab.sql.trim()) continue
        const connection = connections.find((item) => item.id === tab.connectionId) ?? null
        const schemaPath = tab.connectionId ? catalogSchemaPaths[tab.connectionId] : null
        void saveTabDraft(tab, {
          connection,
          database: schemaPath?.database ?? connection?.database ?? null,
          schema: schemaPath?.schema ?? null,
        }).then((draft) => {
          if (draft && tab.draftId !== draft.id) {
            setTabDraft(tab.id, draft.id)
          }
        })
      }
    }, 700)

    return () => {
      if (draftSaveTimer.current) {
        window.clearTimeout(draftSaveTimer.current)
      }
    }
  }, [catalogSchemaPaths, connections, saveTabDraft, setTabDraft, tabs])

  function sqlToRun() {
    return activeTab ? sqlForToolbarExecution(activeTab, selectedSql).trim() : ''
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
          notifyError(normalizeAppError(error), t('workbench.loadCompletionMetadataFailed'))
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
    t,
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
        notifyError(normalizeAppError(error), t('workbench.loadCompletionObjectsFailed'))
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
    t,
  ])

  async function execute(sqlOverride?: string) {
    if (!activeTab || !connectionId || !queryCapabilities.canQuery) {
      return
    }
    const sql = (sqlOverride ?? sqlToRun()).trim()
    if (!sql) {
      return
    }

    if (!connectionIsConnected) {
      try {
        await connectConnection(connectionId, { selectForBrowsing: false })
      } catch {
        return
      }
    }

    try {
      const risk = await analyzeSqlRisk(sql)
      if (risk.dangerous && !confirmDangerousSql(risk)) {
        return
      }
    } catch (error) {
      notifyError(normalizeAppError(error), t('workbench.sqlRiskCheckFailed'))
      return
    }

    runQuery(activeTab.id, connectionId, sql, {
      database: selectedDatabase,
      schema: selectedSchema,
      maxRows: queryMaxRows,
    })
  }

  async function explain() {
    if (!activeTab || !connectionId || !queryCapabilities.canExplain) {
      return
    }
    const sql = sqlToRun()
    if (!sql) return
    if (!connectionIsConnected) {
      try {
        await connectConnection(connectionId, { selectForBrowsing: false })
      } catch {
        return
      }
    }
    await runExplain(activeTab.id, connectionId, sql)
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
      updateTabSql(activeTab.id, format(activeTab.sql, { language: sqlFormatterLanguage(activeDriverType) }))
      setTabQueryState(activeTab.id, activeTab.lastQueryId ?? null)
    } catch (error) {
      setTabQueryState(
        activeTab.id,
        activeTab.lastQueryId ?? null,
        error instanceof Error ? error.message : t('workbench.formatSqlFailed'),
      )
    }
  }

  if (!activeTab) {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <WorkbenchHome />
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

  if (activeTab.kind === 'settings') {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <SettingsWorkspacePanel />
      </main>
    )
  }

  if (activeTab.kind === 'sqlScripts' || activeTab.kind === 'queryHistory') {
    return (
      <main className="flex flex-1 overflow-hidden bg-background">
        <SqlRecordsWorkspace
          key={`${activeTab.id}:${activeTab.recordsConnectionFilter ?? 'all'}`}
          mode={activeTab.kind === 'sqlScripts' ? 'scripts' : 'history'}
          connections={connections}
          initialConnectionFilter={activeTab.recordsConnectionFilter ?? null}
          onOpenSql={(title, sql, connectionId, unavailableConnectionName = null) => addTab({
            id: crypto.randomUUID(), kind: 'sql', title, sql, connectionId, unavailableConnectionName,
          })}
        />
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
                title: t('explorer.dataTabTitle', { name: activeObjectSummaryContext.object }),
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
              runQuery(tabId, activeTab.connectionId, sql, { maxRows: dataTabFetchLimit(dataPreviewDefaultRows) })
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
            exportDirectory={exportDirectory}
            onRefresh={() => {
              if (activeTab.connectionId) {
                runQuery(activeTab.id, activeTab.connectionId, activeTab.sql, {
                  maxRows: dataTabFetchLimit(activeDataContext.limit),
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
                  title: t('workbench.dataPreviewLimitTitle'),
                  message: t('workbench.dataPreviewLimitMessage'),
                })
                return
              }
              const nextContext = { ...activeTab.dataContext, limit, offset: 0 }
              const nextSql = buildDataTabSql(dataContextToSqlInput(nextContext))
              updateDataTabContext(activeTab.id, nextContext, nextSql)
              runQuery(activeTab.id, activeTab.connectionId, nextSql, { maxRows: dataTabFetchLimit(nextContext.limit) })
            }}
            onContextChange={(patch) => {
              if (!activeTab.connectionId || !activeTab.dataContext) {
                return
              }
              const nextContext = { ...activeTab.dataContext, ...patch }
              const nextSql = buildDataTabSql(dataContextToSqlInput(nextContext))
              updateDataTabContext(activeTab.id, nextContext, nextSql)
              runQuery(activeTab.id, activeTab.connectionId, nextSql, { maxRows: dataTabFetchLimit(nextContext.limit) })
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
              exportCurrentResult(
                dataTabDisplayResult(activeResult, activeDataContext.limit),
                activeTab.title,
                notify,
                notifyError,
                upsertTask,
                exportDirectory,
              )
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
        dataSourceGroups={dataSourceGroups}
        connectionStatuses={Object.fromEntries(
          Object.entries(statuses).map(([id, status]) => [id, status.status]),
        )}
        connectionId={connectionId}
        database={selectedDatabase}
        schema={selectedSchema}
        databases={toolbarDatabases}
        schemas={toolbarSchemas}
        maxRows={queryMaxRows}
        running={activeTab.running}
        canCancel={Boolean(activeTab.runningQueryId && queryCapabilities.canCancel)}
        canExplain={queryCapabilities.canExplain}
        explainUnsupportedReason={t('workbench.explainUnsupported')}
        disabled={!canRun}
        formatDisabled={!canFormat}
        onConnectionChange={(id) => {
          if (id === connectionId) return
          void (async () => {
            // Prepare the target first. A failed on-demand connection must not
            // alter this tab's SQL, result, or previous execution target.
            if (id && statuses[id]?.status !== 'connected') {
              try {
                await connectConnection(id, { selectForBrowsing: false })
              } catch {
                return
              }
            }
            updateTabConnection(activeTab.id, id)
          if (id) {
            const nextConnection = connections.find((connection) => connection.id === id)
            setCatalogSchemaPath({
              connectionId: id,
              database: catalogSchemaPaths[id]?.database ?? nextConnection?.database ?? null,
              schema: catalogSchemaPaths[id]?.schema ?? null,
              schemaListAvailable: true,
            })
          }
          })()
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
        onMaxRowsChange={setQueryMaxRows}
        onRun={execute}
        onCancel={cancel}
        onExplain={explain}
        onFormat={formatSql}
        />

        <div className="ide-editor-surface min-h-0 flex-1">
        {editorLoaded ? (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-card text-xs text-muted-foreground">
                {t('workbench.loadingSqlEditor')}
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
              onSelectionChange={(sql) => setSelectedSql({ tabId: activeTab.id, sql })}
              autoFocus={editorShouldFocus}
            />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col bg-card">
            <div className="flex h-9 items-center justify-between border-b px-3 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                {t('workbench.lightSqlInput')}{completionHint ? ` · ${completionHint}` : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7"
                onFocus={loadSqlEditor}
                onClick={() => {
                  setEditorShouldFocus(true)
                  setEditorLoaded(true)
                }}
                onPointerEnter={loadSqlEditor}
              >
                {t('workbench.loadAdvancedEditor')}
              </Button>
            </div>
            <textarea
              className="min-h-0 flex-1 resize-none bg-card p-3 font-mono text-[13px] leading-5 text-foreground outline-none"
              style={{ fontSize: editorFontSize, lineHeight: `${Math.max(18, editorFontSize + 7)}px` }}
              value={activeTab.sql}
              spellCheck={false}
              onFocus={() => {
                loadSqlEditor()
                setEditorShouldFocus(true)
                setEditorLoaded(true)
              }}
              onChange={(event) => updateTabSql(activeTab.id, event.target.value)}
              onSelect={(event) => {
                const target = event.currentTarget
                setSelectedSql({
                  tabId: activeTab.id,
                  sql: target.value.slice(target.selectionStart, target.selectionEnd),
                })
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
            <span className="font-medium">{t('workbench.results')}</span>
            {activeTab.running && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground" aria-live="polite">
                <Loader2 className="size-3 animate-spin" />
                {activeTab.cancelling ? t('workbench.cancelRequested') : t('workbench.queryRunning')}
              </span>
            )}
            {activeResult && !activeExplain && !activeTab.running && (
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
            {activeResultSource && (
              <span
                className={activeResultSource.connectionId === connectionId ? 'text-muted-foreground' : 'text-amber-600'}
                title={activeResultSource.executedAt}
              >
                {activeResultConnection?.name ?? t('connection.disconnected')}
                {(activeResultSource.database || activeResultSource.schema) && ` · ${[activeResultSource.database, activeResultSource.schema].filter(Boolean).join(' / ')}`}
                {activeResultSource.connectionId === connectionId ? '' : ` · ${t('workbench.previousResult')}`}
              </span>
            )}
            {activeResults && !activeExplain && activeResults.length > 1 && (
              <span className="text-muted-foreground">{t('workbench.resultSets', { count: activeResults.length })}</span>
            )}
            {activeExplain && (
              <span className="text-muted-foreground">
                {t('workbench.explainSummary', { elapsedMs: activeExplain.elapsedMs })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <IconTooltipButton
              size="icon-xs"
              label={t('sql.history')}
              variant={historyOpen ? 'secondary' : 'ghost'}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History className="size-3.5" />
            </IconTooltipButton>
            <IconTooltipButton
              size="icon-xs"
              label={t('workbench.exportCsv')}
              variant="ghost"
              disabled={Boolean(activeExplain) || !activeResult || activeResult.columns.length === 0}
              onClick={() =>
                activeResult &&
                exportCurrentResult(activeResult, activeTab.title, notify, notifyError, upsertTask, exportDirectory)
              }
            >
              <Download className="size-3.5" />
            </IconTooltipButton>
          {activeTab.error && (
            <div className="flex min-w-0 items-center gap-1 text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">{t('workbench.queryFailed')}</span>
            </div>
          )}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <div className="flex h-full min-h-0">
            <div className="min-w-0 flex-1">
              {activeTab.error ? (
                <ErrorDetails message={activeTab.error} sql={activeTab.sql} onRetry={() => void execute()} />
              ) : activeExplain ? (
                activeExplain.result ? (
                  <DataGrid result={activeExplain.result} />
                ) : (
                  <pre className="h-full overflow-auto p-3 text-xs">
                    {JSON.stringify(activeExplain.plan, null, 2)}
                  </pre>
                )
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

function SqlRecordsWorkspace({ mode, connections, initialConnectionFilter, onOpenSql }: {
  mode: 'scripts' | 'history'
  connections: ConnectionConfig[]
  initialConnectionFilter: string | null
  onOpenSql: (title: string, sql: string, connectionId: string | null, unavailableConnectionName?: string | null) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [connectionFilter, setConnectionFilter] = useState(initialConnectionFilter ?? 'all')
  const [statusFilter, setStatusFilter] = useState<'all' | QueryHistoryStatus>('all')
  const [timeRange, setTimeRange] = useState<'all' | 'day' | 'week' | 'month'>('all')
  const [sortDirection, setSortDirection] = useState<'newest' | 'oldest'>('newest')
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [recordsOpenedAt] = useState(() => Date.now())
  const drafts = useSqlDraftStore((state) => state.drafts)
  const loadDrafts = useSqlDraftStore((state) => state.loadDrafts)
  const clearDrafts = useSqlDraftStore((state) => state.clear)
  const draftsLoading = useSqlDraftStore((state) => state.loading)
  const history = useQueryHistoryStore((state) => state.entries)
  const loadHistory = useQueryHistoryStore((state) => state.loadHistory)
  const historyLoading = useQueryHistoryStore((state) => state.loading)
  useEffect(() => { void (mode === 'scripts' ? loadDrafts(50) : loadHistory(500)) }, [loadDrafts, loadHistory, mode])
  const entries = mode === 'scripts' ? drafts : history
  const connectionOptions = useMemo(() => uniqueRecordConnections(entries, connections), [connections, entries])
  const selectedConnectionFilter = connectionFilter === 'all' || connectionOptions.some((option) => option.id === connectionFilter)
    ? connectionFilter
    : 'all'
  const cutoff = timeRange === 'day' ? recordsOpenedAt - 86_400_000
    : timeRange === 'week' ? recordsOpenedAt - 604_800_000
      : timeRange === 'month' ? recordsOpenedAt - 2_592_000_000
        : null
  const filtered = [...entries]
    .filter((entry) => {
      const source = [('title' in entry ? entry.title : null), entry.sql, entry.connectionNameSnapshot].filter(Boolean).join(' ').toLocaleLowerCase()
      const timestamp = new Date('updatedAt' in entry ? entry.updatedAt : entry.startedAt).getTime()
      return (!query.trim() || source.includes(query.trim().toLocaleLowerCase()))
        && (selectedConnectionFilter === 'all' || entry.connectionId === selectedConnectionFilter)
        && (mode !== 'history' || statusFilter === 'all' || ('status' in entry && entry.status === statusFilter))
        && (cutoff === null || timestamp >= cutoff)
    })
    .sort((left, right) => {
      const leftTime = new Date('updatedAt' in left ? left.updatedAt : left.startedAt).getTime()
      const rightTime = new Date('updatedAt' in right ? right.updatedAt : right.startedAt).getTime()
      return sortDirection === 'newest' ? rightTime - leftTime : leftTime - rightTime
    })
  const recordsLoading = mode === 'scripts' ? draftsLoading : historyLoading
  const clearLabel = mode === 'scripts' ? t('sql.clearRecentScripts') : t('sql.clearHistory')
  const clearDescription = mode === 'scripts'
    ? t('sql.clearDraftsDescription', { count: entries.length })
    : t('sql.clearHistoryDescription', { count: entries.length })
  async function clearRecords() {
    if (recordsLoading) return
    if (mode === 'scripts') {
      try {
        await clearDrafts()
        setClearDialogOpen(false)
        useUiStore.getState().notify({ kind: 'success', title: t('sql.draftsCleared') })
      } catch {
        // The draft store already reports a localized failure notification.
      }
      return
    }
    const cleared = await useQueryHistoryStore.getState().clear()
    setClearDialogOpen(false)
    if (cleared) useUiStore.getState().notify({ kind: 'success', title: t('sql.historyCleared') })
  }

  const pageLabel = mode === 'scripts' ? t('sql.drafts') : t('sql.history')
  const searchPlaceholder = mode === 'scripts' ? t('sql.searchScripts') : t('sql.searchHistory')
  return <section className="ide-workspace flex min-w-0 flex-1 flex-col overflow-hidden">
    <header className="ide-toolbar shrink-0 border-b" aria-label={pageLabel}>
      <div className="flex min-h-7 flex-wrap items-center gap-x-1 gap-y-1 px-3 py-1.5">
        <div className="relative w-[min(20rem,42vw)] min-w-44">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 border-transparent bg-transparent py-1 pr-2 pl-8 text-xs shadow-none hover:border-border hover:bg-card focus-visible:border-primary/60 focus-visible:bg-card" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={t('sql.searchRecords')} />
        </div>
        <span className="mx-1 h-4 w-px bg-border/80" aria-hidden="true" />
        <AppSelect variant="ide" className="w-40" aria-label={t('sql.historyConnectionFilter')} title={t('sql.historyConnectionFilter')} value={selectedConnectionFilter} onValueChange={setConnectionFilter} options={[{ value: 'all', label: t('sql.historyFilterAllConnections') }, ...connectionOptions.map((option) => ({ value: option.id, label: option.name }))]} />
        {mode === 'history' ? <AppSelect variant="ide" className="w-24" aria-label={t('sql.historyStatusFilter')} title={t('sql.historyStatusFilter')} value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | QueryHistoryStatus)} options={[{ value: 'all', label: t('sql.historyFilterAllStatus') }, { value: 'success', label: t('sql.historyFilterSuccess') }, { value: 'failed', label: t('sql.historyFilterFailed') }]} /> : null}
        <AppSelect variant="ide" className="w-28" aria-label={t('sql.timeRange')} title={t('sql.timeRange')} value={timeRange} onValueChange={(value) => setTimeRange(value as 'all' | 'day' | 'week' | 'month')} options={[{ value: 'all', label: t('sql.timeAll') }, { value: 'day', label: t('sql.timeDay') }, { value: 'week', label: t('sql.timeWeek') }, { value: 'month', label: t('sql.timeMonth') }]} />
        <AppSelect variant="ide" className="w-28" aria-label={t('sql.sortByTime')} title={t('sql.sortByTime')} value={sortDirection} onValueChange={(value) => setSortDirection(value as 'newest' | 'oldest')} options={[{ value: 'newest', label: t('sql.sortNewest') }, { value: 'oldest', label: t('sql.sortOldest') }]} />
        <span className="min-w-2 flex-1" />
        <span className="px-2 text-[11px] tabular-nums text-muted-foreground">{t('sql.recordCount', { count: filtered.length })}</span>
        <Button type="button" size="xs" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={entries.length === 0 || recordsLoading} onClick={() => setClearDialogOpen(true)}><Trash2 className="size-3.5" />{clearLabel}</Button>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-[42rem] border-b bg-card">
        <div className="grid grid-cols-[minmax(0,1fr)_10rem] gap-4 border-b bg-muted/35 px-4 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground">
          <span>{t('sql.recordSql')}</span><span className="text-right">{t('sql.recordSourceTime')}</span>
        </div>
        {filtered.map((entry) => {
          const available = !entry.connectionId || connections.some((connection) => connection.id === entry.connectionId)
          return <button key={entry.id} type="button" className="group grid w-full grid-cols-[minmax(0,1fr)_10rem] gap-4 border-b px-4 py-2 text-left transition-colors hover:bg-primary/[0.045] focus-visible:relative focus-visible:z-10 focus-visible:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/55" onDoubleClick={() => onOpenSql(('title' in entry ? entry.title : null) || `${entry.connectionNameSnapshot} SQL`, entry.sql, available ? entry.connectionId ?? null : null, available ? null : entry.connectionNameSnapshot ?? null)}>
            <span className="min-w-0"><span className="block truncate text-xs font-medium leading-5 text-foreground">{('title' in entry ? entry.title : null) || sqlPreview(entry.sql)}</span><span className="block truncate font-mono text-[11px] leading-4 text-muted-foreground">{sqlPreview(entry.sql)}</span></span>
            <span className="pt-0.5 text-right text-[11px] leading-4 text-muted-foreground"><span className="block truncate group-hover:text-foreground">{entry.connectionNameSnapshot ?? t('connection.disconnected')}</span><span className="block">{'updatedAt' in entry ? formatHistoryTime(entry.updatedAt) : formatHistoryTime(entry.startedAt)}</span></span>
          </button>
        })}
        {filtered.length === 0 && <div className="p-10 text-center text-xs text-muted-foreground">{t('workbench.historyNoMatches')}</div>}
      </div>
    </div>
    <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader><DialogTitle>{clearLabel}</DialogTitle><DialogDescription>{clearDescription}</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" disabled={recordsLoading} onClick={() => setClearDialogOpen(false)}>{t('common.cancel')}</Button><Button type="button" variant="destructive" disabled={recordsLoading} onClick={() => void clearRecords()}>{clearLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}

function DataSourcesManagementPanel() {
  const { t } = useTranslation()
  const connections = useConnectionStore((state) => state.connections)
  const [editor, setEditor] = useState<{ mode: 'none' | 'new' | 'edit'; connectionId: string | null }>({ mode: 'none', connectionId: null })
  const [editorDirty, setEditorDirty] = useState(false)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 959px)')
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  function requestEditor(next: { mode: 'none' | 'new' | 'edit'; connectionId: string | null }) {
    if (editorDirty && !window.confirm(t('connectionForm.discardChanges'))) return
    setEditorDirty(false)
    setEditor(next)
  }

  const editedConnection = editor.mode === 'edit'
    ? connections.find((connection) => connection.id === editor.connectionId) ?? null
    : null
  const editorContent = (
    <ConnectionEditorPanel
      connection={editedConnection}
      isNew={editor.mode === 'new'}
      onNew={() => requestEditor({ mode: 'new', connectionId: null })}
      onDirtyChange={setEditorDirty}
      onCancel={() => requestEditor({ mode: 'none', connectionId: null })}
      onSaved={(connection) => {
        setEditorDirty(false)
        setEditor({ mode: 'edit', connectionId: connection.id })
      }}
    />
  )

  return (
    <section className="ide-workspace flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0">
          <div className="min-w-0 flex-1 overflow-hidden border-r">
            <ConnectionList
              mode="manager"
              managerSelectedConnectionId={editor.mode === 'edit' ? editor.connectionId : null}
              onManagerSelect={(connection) => requestEditor({ mode: 'edit', connectionId: connection.id })}
            />
          </div>
          {!compact && <div className="hidden min-w-[34rem] flex-[1.15] md:flex">{editorContent}</div>}
        </div>
        {compact && <Sheet open={editor.mode !== 'none'} onOpenChange={(open) => {
          if (!open) requestEditor({ mode: 'none', connectionId: null })
        }}>
          <SheetContent side="right" showCloseButton className="w-full max-w-none gap-0 p-0 sm:max-w-xl">
            {editorContent}
          </SheetContent>
        </Sheet>}
      </div>
    </section>
  )
}

function WorkbenchHome() {
  const { t } = useTranslation()
  return (
    <section className="ide-workspace flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div className="-mt-14 grid max-w-sm gap-2 text-center text-sm text-muted-foreground">
        <p>{t('workbench.emptyEditorHint')}</p>
        <p className="text-xs text-muted-foreground/70">{t('workbench.emptyEditorDetail')}</p>
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
  const { t } = useTranslation()
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
      notify({ kind: 'success', title: t('sql.historyCleared') })
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-card">
      <div className="flex h-9 items-center justify-between border-b px-3 text-xs">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <Clock3 className="size-3.5 text-muted-foreground" />
          <span>{t('sql.history')}</span>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant={confirmClear ? 'destructive' : 'ghost'}
          disabled={history.length === 0 || loading}
          title={confirmClear ? t('common.confirmClear') : t('common.clear')}
          onClick={() => void handleClear()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 border-b p-2">
        <AppSelect
          className="h-7"
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as 'all' | QueryHistoryStatus)}
          options={[{ value: 'all', label: t('workbench.allStatus') }, { value: 'success', label: t('workbench.queryStatus.success') }, { value: 'failed', label: t('workbench.queryStatus.failed') }]}
        />
        <AppSelect
          className="h-7"
          value={connectionFilter}
          onValueChange={setConnectionFilter}
          options={[{ value: 'all', label: t('sql.historyFilterAllConnections') }, ...connectionOptions.map((option) => ({ value: option.id, label: option.name }))]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">
            {history.length === 0 ? t('workbench.historyEmpty') : t('workbench.historyNoMatches')}
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
                      {entry.sql.trim() || t('sql.blankQuery')}
                    </pre>
                    {entry.errorMessage && (
                      <div className="max-h-20 overflow-auto whitespace-pre-wrap rounded border border-destructive/20 bg-destructive/10 p-2 text-[11px] text-destructive">
                        {entry.errorCode ? `${entry.errorCode}: ` : ''}
                        {entry.errorMessage}
                      </div>
                    )}
                    <Button type="button" size="xs" variant="secondary" onClick={() => onReuse(entry)}>
                      {t('workbench.reuseSql')}
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
  const { t } = useTranslation()
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
          <h2 className="text-sm font-semibold">{t('workbench.summary')}</h2>
          <div className="grid gap-2 rounded-md border bg-card p-3 text-sm">
            <SummaryFact label={t('connection.dataSource')} value={tab.connectionId ?? '-'} />
            <SummaryFact label={t('workbench.schema')} value={context.schema} />
            <SummaryFact label={t('workbench.object')} value={context.object} />
            <SummaryFact label={t('connectionForm.driver').replace(':', '')} value={context.driverType} />
          </div>
        </section>
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">{t('workbench.actions')}</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onOpenDataPreview}>
              <DatabaseIcon className="size-3.5" />
              {t('workbench.previewData')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenStructure}>
              <FileCode2 className="size-3.5" />
              {t('workbench.structure')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenDefinition}>
              <FileCode2 className="size-3.5" />
              DDL
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenInspector}>
              <FileCode2 className="size-3.5" />
              {t('workbench.inspector')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onOpenDiagram}>
              <FileCode2 className="size-3.5" />
              {t('workbench.erDiagram')}
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
  exportDirectory,
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
  exportDirectory: string | null
}) {
  const { t } = useTranslation()
  const notifyError = useUiStore((state) => state.notifyError)
  const notify = useUiStore((state) => state.notify)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const [limitText, setLimitText] = useState(String(tab.dataContext.limit))
  const [whereText, setWhereText] = useState(tab.dataContext.wherePredicate ?? '')
  const [importPath, setImportPath] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const page = Math.floor(tab.dataContext.offset / tab.dataContext.limit) + 1
  const displayResult = result ? dataTabDisplayResult(result, tab.dataContext.limit) : undefined
  const hasNextPage = result ? result.rows.length > tab.dataContext.limit : false
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
      const directory = exportDirectory ?? await downloadDir()
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
        title: t('workbench.tableCsvExportStarted'),
        message: fileName,
      })
    } catch (exportError) {
      notifyError(normalizeAppError(exportError), t('workbench.startTableCsvExportFailed'))
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
        title: t('workbench.csvImportPreviewComplete'),
        message: `${preview.validRows.toLocaleString()} valid / ${preview.totalRows.toLocaleString()} rows`,
      })
    } catch (previewError) {
      setImportPreview(null)
      notifyError(normalizeAppError(previewError), t('workbench.csvImportPreviewFailed'))
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
        title: t('workbench.csvImportStarted'),
        message: `${importPreview.validRows.toLocaleString()} rows queued`,
      })
    } catch (importError) {
      notifyError(normalizeAppError(importError), t('workbench.startCsvImportFailed'))
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
          <IconTooltipButton
            label={running ? t('workbench.refreshing') : t('common.refresh')}
            variant="outline"
            disabled={running}
            onClick={onRefresh}
          >
            <RefreshCw className={running ? 'animate-spin' : undefined} />
          </IconTooltipButton>
          <IconTooltipButton label={t('workbench.openInSqlTab')} variant="ghost" onClick={onOpenSqlTab}>
            <FileCode2 />
          </IconTooltipButton>
          <IconTooltipButton
            label={t('workbench.exportCsv')}
            variant="ghost"
            disabled={!result || result.columns.length === 0}
            onClick={onExport}
          >
            <Download className="size-3.5" />
          </IconTooltipButton>
          <IconTooltipButton
            label={t('workbench.exportTable')}
            variant="ghost"
            disabled={!tab.connectionId}
            onClick={() => void exportSelectedTable()}
          >
            <Download className="size-3.5" />
          </IconTooltipButton>
        </div>
      </div>
      <div className="flex h-8 items-center gap-2 border-b bg-muted/20 px-3 text-[11px] text-muted-foreground">
        <span>{t('workbench.readOnlyDataPreview')}</span>
        {displayResult && <span>{resultSummary(displayResult)}</span>}
        <span>Page {page}</span>
        {hasPrimaryKeyOrder && <span>{t('workbench.primaryKeyAscending')}</span>}
        {hasNoStableOrder && <span className="text-amber-600">{t('workbench.noPrimaryKeyUnstable')}</span>}
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
            {t('workbench.applyFilter')}
          </Button>
          <AppSelect
            className="h-7 min-w-32"
            value={tab.dataContext.sortColumn ?? ''}
            onValueChange={(value) => changeSort(value || null)}
            options={[{ value: '', label: t('workbench.sort') }, ...(displayResult?.columns.map((column) => ({ value: column.name, label: column.name })) ?? [])]}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={!tab.dataContext.sortColumn}
            title={t('workbench.toggleSortDirection')}
            onClick={() =>
              onContextChange({
                sortDirection: tab.dataContext.sortDirection === 'desc' ? 'asc' : 'desc',
                offset: 0,
              })
            }
          >
            {tab.dataContext.sortDirection === 'desc' ? <ArrowDownAZ /> : <ArrowUpAZ />}
          </Button>
          <IconTooltipButton
            size="icon-xs"
            label={t('workbench.previousPage')}
            variant="ghost"
            disabled={running || tab.dataContext.offset === 0}
            onClick={() =>
              onContextChange({
                offset: Math.max(0, tab.dataContext.offset - tab.dataContext.limit),
              })
            }
          >
            <ChevronLeft />
          </IconTooltipButton>
          <IconTooltipButton
            size="icon-xs"
            label={t('workbench.nextPage')}
            variant="ghost"
            disabled={running || !hasNextPage}
            onClick={() =>
              onContextChange({
                offset: tab.dataContext.offset + tab.dataContext.limit,
              })
            }
          >
            <ChevronRight />
          </IconTooltipButton>
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
            {t('workbench.previewImport')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={importBusy || !importPreview?.canImport}
            onClick={() => void startCsvImport()}
          >
            {t('workbench.runImport')}
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
          <DataGrid result={displayResult} />
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
  const { t } = useTranslation()
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
      const [coreStructure, nextTriggers] = await Promise.all([
        Promise.all([
          metadata.loadColumns(tab.connectionId, context.schema, context.object, force),
          metadata.loadIndexes(tab.connectionId, context.schema, context.object, force),
          metadata.loadForeignKeys(tab.connectionId, context.schema, context.object, force),
          getTableDdl(tab.connectionId, context.schema, context.object),
        ]),
        metadata
          .loadSchemaObjects(tab.connectionId, context.schema, 'trigger', force)
          .catch(() => []),
      ])
      const [nextColumns, nextIndexes, nextForeignKeys, nextDdl] = coreStructure
      setColumns(nextColumns)
      setIndexes(nextIndexes)
      setForeignKeys(nextForeignKeys)
      setTriggers(nextTriggers)
      setDdl(nextDdl)
    } catch (loadError) {
      const appError = normalizeAppError(loadError)
      setError(appError.message)
      notifyError(appError, t('workbench.loadStructureFailed'))
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
          {loading ? t('workbench.refreshing') : t('workbench.refreshStructure')}
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
            {t(item.labelKey)}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{t('workbench.readOnlyStructure')}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <ErrorDetails message={error} />
        ) : loading && columns.length === 0 && ddl.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            {t('workbench.loadingStructure')}
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

const structureSections: Array<{ id: StructureSection; labelKey: string }> = [
  { id: 'columns', labelKey: 'explorer.folders.columns' },
  { id: 'indexes', labelKey: 'explorer.folders.indexes' },
  { id: 'foreignKeys', labelKey: 'explorer.folders.foreignKeys' },
  { id: 'triggers', labelKey: 'explorer.folders.triggers' },
  { id: 'ddl', labelKey: 'workbench.ddl' },
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
  const { t } = useTranslation()
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
              {t('workbench.openSourceDdl')}
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
  const { t } = useTranslation()
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
      notifyError(appError, t('workbench.loadDefinitionFailed', { kind: context.definitionKind }))
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
      notify({ kind: 'success', title: t('workbench.copiedDefinition', { kind: context.definitionKind }) })
    } catch (copyError) {
      notifyError(normalizeAppError(copyError), t('notifications.copyFailed'))
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
            {t('common.copy')}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!tab.sql} onClick={onOpenSqlTab}>
            {t('workbench.openInSqlTab')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => loadDefinition(true)}
          >
            <RefreshCw />
            {loading ? t('workbench.refreshing') : t('workbench.refreshDefinition', { kind: context.definitionKind })}
          </Button>
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/20 px-3 text-[11px] text-muted-foreground">
        <span>{t('workbench.readOnlyDefinition')}</span>
        <span>{t('workbench.findHint')}</span>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <DefinitionError context={context} message={error} />
        ) : loading && !tab.sql ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            {t('workbench.loadingDefinition', { kind: context.definitionKind })}
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-card text-xs text-muted-foreground">
                {t('workbench.loadingReadOnlyEditor')}
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
  const { t } = useTranslation()
  return (
    <div className="h-full overflow-auto bg-destructive/5 p-3">
      <div className="rounded-md border border-destructive/25 bg-background p-3 text-xs">
        <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{t('workbench.loadDefinitionFailed', { kind: context.definitionKind })}</span>
        </div>
        <div className="grid gap-1 text-muted-foreground">
          <div>{t('workbench.definitionObject', { name: `${context.schema}.${context.object}` })}</div>
          <div>{t('workbench.definitionOperation', { operation: context.operation === 'tableDdl' ? t('workbench.readTableDdl') : t('workbench.readObjectSourceDdl') })}</div>
          <div>{t('workbench.definitionFailureReason')}</div>
        </div>
        <pre className="mt-3 max-h-56 overflow-auto rounded border bg-muted/45 p-2 text-[11px] leading-5 text-destructive">
          {message}
        </pre>
      </div>
    </div>
  )
}

function ErrorDetails({ message, sql, onRetry }: { message: string; sql?: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  const [summary, ...details] = message.split('\n')
  const detail = details.join('\n').trim()
  const copyText = [message, sql ? `\nSQL:\n${sql}` : ''].join('')

  return (
    <div className="h-full overflow-auto bg-destructive/5 p-3">
      <div className="rounded-md border border-destructive/25 bg-background p-3 text-xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-medium text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{t('workbench.queryFailed')}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onRetry && (
              <Button type="button" size="xs" variant="outline" onClick={onRetry}>
                <RefreshCw className="size-3.5" />
                {t('workbench.retryQuery')}
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => navigator.clipboard?.writeText(copyText)}
            >
              <Copy className="size-3.5" />
              {t('common.copy')}
            </Button>
          </div>
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
              {sql.trim() || t('sql.blankQuery')}
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
  const { t } = useTranslation()
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
            <span className="font-medium">{t('workbench.resultLabel', { index: index + 1 })}</span>
            <span className="ml-2 text-muted-foreground">{compactResultSummary(result)}</span>
          </button>
        )
      })}
    </div>
  )
}

function confirmDangerousSql(risk: SqlRiskAnalysis) {
  const title = i18n.t('workbench.dangerousSqlTitle')
  const environmentLine = i18n.t('workbench.dangerousSqlBody')
  const reasons = risk.reasons.map(formatSqlRiskReason).join('\n')

  return window.confirm(`${title}\n\n${environmentLine}\n\n${i18n.t('workbench.dangerDetected')}\n${reasons}\n\n${i18n.t('workbench.continueExecute')}`)
}

function sqlFormatterLanguage(driverType: DriverType): 'postgresql' | 'mysql' | 'sqlite' | 'transactsql' {
  switch (driverType) {
    case 'mysql':
      return 'mysql'
    case 'sqlite':
      return 'sqlite'
    case 'mssql':
      return 'transactsql'
    case 'postgres':
    case 'oracle':
    case 'jdbc':
    case 'mongo':
    case 'redis':
    default:
      return 'postgresql'
  }
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
        canExplain: true,
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

function sqlForToolbarExecution(
  tab: EditorTab,
  selectedSql: { tabId: string | null; sql: string },
) {
  return selectedSql.tabId === tab.id && selectedSql.sql.trim() ? selectedSql.sql : tab.sql
}

function formatSqlRiskReason(reason: SqlRiskReason) {
  switch (reason) {
    case 'dropStatement':
      return i18n.t('workbench.riskDrop')
    case 'truncateStatement':
      return i18n.t('workbench.riskTruncate')
    case 'deleteWithoutWhere':
      return i18n.t('workbench.riskDeleteWithoutWhere')
    case 'updateWithoutWhere':
      return i18n.t('workbench.riskUpdateWithoutWhere')
  }
}

function resultSummary(result: QueryResult) {
  if (result.columns.length === 0) {
    if (result.elapsedMs === 0 && result.affectedRows === 0) {
      return i18n.t('workbench.receivingResults')
    }
    return i18n.t('workbench.affectedRowsSummary', {
      count: result.affectedRows.toLocaleString(),
      elapsedMs: result.elapsedMs,
    })
  }

  return i18n.t('workbench.rowSummary', {
    count: result.rowCount.toLocaleString(),
    truncated: result.truncated ? i18n.t('workbench.truncatedSuffix') : '',
    elapsedMs: result.elapsedMs,
  })
}

function dataTabDisplayResult(result: QueryResult, limit: number): QueryResult {
  if (result.columns.length === 0) {
    return result
  }

  const displayRows = result.rows.slice(0, Math.max(1, Math.round(limit)))
  return {
    ...result,
    rows: displayRows,
    rowCount: displayRows.length,
    truncated: false,
    maxRows: null,
  }
}

function largeResultNotice(result: QueryResult) {
  return i18n.t('workbench.largeResultNotice', { count: result.maxRows ?? result.rowCount })
}

function sqlPreview(sql: string) {
  const preview = sql.trim().replace(/\s+/g, ' ')
  return preview.length > 90 ? `${preview.slice(0, 90)}...` : preview || i18n.t('sql.blankQuery')
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

function uniqueRecordConnections(
  entries: { connectionId?: string | null; connectionNameSnapshot?: string | null }[],
  connections: ConnectionConfig[],
) {
  const names = new Map(connections.map((connection) => [connection.id, connection.name]))
  for (const entry of entries) {
    if (entry.connectionId && !names.has(entry.connectionId) && entry.connectionNameSnapshot) {
      names.set(entry.connectionId, entry.connectionNameSnapshot)
    }
  }
  return Array.from(names, ([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name))
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function compactResultSummary(result: QueryResult) {
  if (result.columns.length === 0) {
    return result.elapsedMs === 0 && result.affectedRows === 0
      ? i18n.t('workbench.receivingShort')
      : `${result.affectedRows.toLocaleString()} affected`
  }
  return `${result.rowCount.toLocaleString()} rows`
}

function completionMetadataHint(
  connected: boolean,
  canComplete: boolean,
  selectedSchema: string | null,
) {
  if (!connected) return i18n.t('workbench.completionConnectHint')
  if (!canComplete) return i18n.t('workbench.completionUnsupportedHint')
  if (!selectedSchema) return i18n.t('workbench.completionSchemaHint')
  return null
}

async function exportCurrentResult(
  result: QueryResult,
  title: string,
  notify: (notification: Omit<AppNotification, 'id'>) => void,
  notifyError: (error: AppError, title?: string) => void,
  upsertTask: (task: TaskInfo) => void,
  exportDirectory: string | null,
) {
  try {
    const directory = exportDirectory ?? await downloadDir()
    const fileName = `${safeFileName(title || 'query-result')}-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.csv`
    const path = await join(directory, fileName)
    const task = await exportQueryResultCsv({ result, path, includeHeader: true })
    upsertTask(task)
    notify({
      kind: 'info',
      title: i18n.t('workbench.csvExportStarted'),
      message: fileName,
    })
  } catch (error) {
    notifyError(normalizeAppError(error), i18n.t('workbench.startCsvExportFailed'))
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
