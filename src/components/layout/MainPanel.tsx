import { lazy, Suspense, useEffect, useState } from 'react'
import { AlertCircle, Download, FileCode2 } from 'lucide-react'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { DataGrid } from '@/components/grid/DataGrid'
import { ObjectInspectorPanel } from '@/components/inspector/ObjectInspectorPanel'
import { Button } from '@/components/ui/button'
import { useQuery } from '@/hooks/useQuery'
import { normalizeAppError } from '@/ipc/client'
import { analyzeSqlRisk, type SqlRiskAnalysis, type SqlRiskReason } from '@/ipc/query'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useUiStore } from '@/stores/uiStore'
import type { DriverType } from '@/types/connection'
import type { QueryResult } from '@/types/query'

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
    ensureTab,
    updateTabSql,
    updateTabConnection,
    setTabQueryState,
  } = useEditorStore()
  const results = useQueryResultStore((state) => state.results)
  const explains = useQueryResultStore((state) => state.explains)
  const metadataDatabases = useMetadataStore((state) => state.databases)
  const metadataSchemas = useMetadataStore((state) => state.schemas)
  const loadDatabases = useMetadataStore((state) => state.loadDatabases)
  const loadSchemas = useMetadataStore((state) => state.loadSchemas)
  const loadTables = useMetadataStore((state) => state.loadTables)
  const loadViews = useMetadataStore((state) => state.loadViews)
  const loadFunctions = useMetadataStore((state) => state.loadFunctions)
  const notifyError = useUiStore((state) => state.notifyError)
  const editorFontSize = useUiStore((state) => state.editorFontSize)
  const { runQuery, runExplain, cancelRunningQuery } = useQuery()
  const [selectedSql, setSelectedSql] = useState('')
  const [editorLoaded, setEditorLoaded] = useState(false)
  const [resultIndexes, setResultIndexes] = useState<Record<string, number>>({})
  const [databaseByConnection, setDatabaseByConnection] = useState<Record<string, string | null>>({})
  const [schemaByConnection, setSchemaByConnection] = useState<Record<string, string | null>>({})

  useEffect(() => {
    ensureTab(activeConnectionId)
  }, [activeConnectionId, ensureTab])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const connectionId = activeTab?.connectionId ?? activeConnectionId
  const activeConnection = connections.find((connection) => connection.id === connectionId)
  const queryCapabilities = activeConnection
    ? driverQueryCapabilities(activeConnection.driverType)
    : emptyQueryCapabilities()
  const selectedDatabase =
    connectionId != null
      ? databaseByConnection[connectionId] ?? activeConnection?.database ?? null
      : null
  const selectedSchema = connectionId != null ? schemaByConnection[connectionId] ?? null : null
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
      ? metadataSchemas[`${connectionId}::database::${selectedDatabase}::schemas`] ??
        metadataSchemas[`${connectionId}::database::::schemas`] ??
        []
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
          const preferredSchema = schemas.find((item) => item.name === 'public') ?? schemas[0]
          if (preferredSchema) {
            setSchemaByConnection((state) => ({ ...state, [connectionId]: preferredSchema.name }))
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
    queryCapabilities.canReadMetadata,
    selectedDatabase,
    selectedSchema,
    loadDatabases,
    loadSchemas,
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
      <main className="grid flex-1 place-items-center overflow-hidden bg-background">
        <div className="text-center text-sm text-muted-foreground">
          <FileCode2 className="mx-auto mb-3 size-8" />
          新建 SQL Tab 后开始查询
        </div>
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
            setDatabaseByConnection((state) => ({
              ...state,
              [id]: state[id] ?? nextConnection?.database ?? null,
            }))
          }
        }}
        onDatabaseChange={(database) => {
          if (!connectionId) return
          setDatabaseByConnection((state) => ({ ...state, [connectionId]: database }))
          setSchemaByConnection((state) => ({ ...state, [connectionId]: null }))
        }}
        onSchemaChange={(schema) => {
          if (!connectionId) return
          setSchemaByConnection((state) => ({ ...state, [connectionId]: schema }))
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
                    ? `结果已达到交互查询上限 ${activeResult.maxRows?.toLocaleString() ?? activeResult.rowCount.toLocaleString()} 行，请增加 WHERE/LIMIT 或使用导出任务处理完整结果`
                    : undefined
                }
              >
                {resultSummary(activeResult)}
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
              variant="ghost"
              disabled={!activeResult || activeResult.columns.length === 0}
              onClick={() => activeResult && exportCurrentResult(activeResult, activeTab.title)}
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
          {activeTab.error ? (
            <ErrorDetails message={activeTab.error} />
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
        </section>
      </div>
      <ObjectInspectorPanel />
    </main>
  )
}

function ErrorDetails({ message }: { message: string }) {
  const [summary, ...details] = message.split('\n')
  const detail = details.join('\n').trim()

  return (
    <div className="h-full overflow-auto bg-destructive/5 p-3">
      <div className="rounded-md border border-destructive/25 bg-background p-3 text-xs">
        <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>查询执行失败</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-destructive">{summary}</div>
        {detail && (
          <pre className="mt-3 max-h-52 overflow-auto rounded border bg-muted/45 p-2 text-[11px] leading-5 text-muted-foreground">
            {detail}
          </pre>
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

function exportCurrentResult(result: QueryResult, title: string) {
  const csv = toCsv(result)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeFileName(title || 'query-result')}.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function toCsv(result: QueryResult) {
  const header = result.columns.map((column) => csvCell(column.name)).join(',')
  const rows = result.rows.map((row) =>
    result.columns.map((_, index) => csvCell(row[index])).join(','),
  )
  return [header, ...rows].join('\r\n')
}

function csvCell(value: unknown) {
  if (value == null) {
    return ''
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'query-result'
}
