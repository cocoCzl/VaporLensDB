import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileCode2 } from 'lucide-react'
import { EditorToolbar } from '@/components/editor/EditorToolbar'
import { DataGrid } from '@/components/grid/DataGrid'
import { Button } from '@/components/ui/button'
import { useQuery } from '@/hooks/useQuery'
import { normalizeAppError } from '@/ipc/client'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useUiStore } from '@/stores/uiStore'
import type { QueryResult } from '@/types/query'

type SqlEditorModule = { default: typeof import('@/components/editor/SqlEditor').SqlEditor }

let sqlEditorPreload: Promise<SqlEditorModule> | null = null

function loadSqlEditor() {
  sqlEditorPreload ??= import('@/components/editor/SqlEditor').then((module) => ({
    default: module.SqlEditor,
  }))
  return sqlEditorPreload
}

const SqlEditor = lazy(loadSqlEditor)

export function MainPanel() {
  const { connections, statuses, activeConnectionId } = useConnectionStore()
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
  const connectedConnections = useMemo(
    () =>
      connections.filter((connection) => statuses[connection.id]?.status === 'connected'),
    [connections, statuses],
  )
  const connectionId = activeTab?.connectionId ?? activeConnectionId
  const activeConnection = connections.find((connection) => connection.id === connectionId)
  const selectedDatabase =
    connectionId != null
      ? databaseByConnection[connectionId] ?? activeConnection?.database ?? null
      : null
  const selectedSchema = connectionId != null ? schemaByConnection[connectionId] ?? null : null
  const connectionIsConnected = Boolean(
    connectionId && statuses[connectionId]?.status === 'connected',
  )
  const canRun = Boolean(activeTab && connectionId && (selectedSql || activeTab.sql).trim())
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

  function sqlToRun() {
    return (selectedSql || activeTab?.sql || '').trim()
  }

  useEffect(() => {
    if (!connectionId || !connectionIsConnected) {
      return
    }

    let cancelled = false
    Promise.all([loadDatabases(connectionId), loadSchemas(connectionId, selectedDatabase)])
      .then(([, schemas]) =>
        Promise.all(
          schemas.flatMap((schema) => [
            loadTables(connectionId, schema.name),
            loadViews(connectionId, schema.name),
            loadFunctions(connectionId, schema.name),
          ]),
        ).then(() => {
          if (!cancelled && !schemaByConnection[connectionId]) {
            const preferredSchema = schemas.find((item) => item.name === 'public') ?? schemas[0]
            if (preferredSchema) {
              setSchemaByConnection((state) => ({ ...state, [connectionId]: preferredSchema.name }))
            }
          }
        }),
      )
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
    selectedDatabase,
    loadDatabases,
    loadFunctions,
    loadSchemas,
    loadTables,
    loadViews,
    notifyError,
    schemaByConnection,
  ])

  function execute() {
    if (!activeTab || !connectionId) {
      return
    }
    runQuery(activeTab.id, connectionId, sqlToRun())
  }

  function explain() {
    if (!activeTab || !connectionId) {
      return
    }
    runExplain(activeTab.id, connectionId, sqlToRun())
  }

  function cancel() {
    if (!activeTab || !connectionId || !activeTab.runningQueryId) {
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
    <main className="flex flex-1 flex-col overflow-hidden bg-background">
      <EditorToolbar
        connections={connectedConnections}
        connectionId={connectionId}
        database={selectedDatabase}
        schema={selectedSchema}
        databases={toolbarDatabases}
        schemas={toolbarSchemas}
        running={activeTab.running}
        canCancel={Boolean(activeTab.runningQueryId)}
        disabled={!canRun}
        onConnectionChange={(id) => {
          updateTabConnection(activeTab.id, id)
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
              <div className="grid h-full place-items-center bg-[#1e1e1e] text-xs text-zinc-400">
                正在加载 SQL 编辑器
              </div>
            }
          >
            <SqlEditor
              value={activeTab.sql}
              connectionId={connectionId}
              onChange={(sql) => updateTabSql(activeTab.id, sql)}
              onRun={execute}
              onSelectionChange={setSelectedSql}
            />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col bg-[#1e1e1e]">
            <div className="flex h-9 items-center justify-between border-b border-zinc-800 px-3 text-xs text-zinc-400">
              <span>轻量 SQL 输入</span>
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
              className="min-h-0 flex-1 resize-none bg-[#1e1e1e] p-3 font-mono text-[13px] leading-5 text-zinc-100 outline-none"
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
                  execute()
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
          {activeTab.error && (
            <div className="flex min-w-0 max-w-[55%] items-center gap-1 text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">{activeTab.error}</span>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {activeExplain ? (
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
    </main>
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
