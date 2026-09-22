import { maskSql, splitSqlStatements } from '@/lib/sqlLexer'
import {
  cancelQuery,
  executeQuery,
  executeQueryStream,
  onQueryResultChunk,
  onQueryResultDone,
  onQueryResultError,
  explainQuery,
  getConsoleTransactionState,
  type ExplainQueryContext,
} from '@/ipc/query'
import i18n from '@/i18n'
import { normalizeAppError } from '@/ipc/client'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useUiStore } from '@/stores/uiStore'
import { useMetadataStore } from '@/stores/metadataStore'

export function useQuery() {
  const setTabRunning = useEditorStore((state) => state.setTabRunning)
  const setTabCancelling = useEditorStore((state) => state.setTabCancelling)
  const setTabQueryState = useEditorStore((state) => state.setTabQueryState)
  const setResults = useQueryResultStore((state) => state.setResults)
  const setExplain = useQueryResultStore((state) => state.setExplain)
  const setResultSource = useQueryResultStore((state) => state.setResultSource)
  const startStreamResult = useQueryResultStore((state) => state.startStreamResult)
  const notify = useUiStore((state) => state.notify)
  const notifyError = useUiStore((state) => state.notifyError)

  async function runQuery(
    tabId: string,
    connectionId: string,
    sql: string,
    options: {
      maxRows?: number
      database?: string | null
      schema?: string | null
      connectionName?: string
    } = {},
  ) {
    const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
    if (!tab || tab.connectionId !== connectionId || tab.closing || tab.transactionBusy || tab.running) return false
    const queryId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const startedMs = performance.now()
    setTabRunning(tabId, true, queryId)
    try {
      if (canStreamSql(sql)) {
        startStreamResult(queryId, classifyStatement(sql))
        const streamState = await registerStreamListeners(tabId, queryId)
        try {
          await executeQueryStream({
            connectionId,
            sql,
            queryId,
            chunkSize: 1_000,
            maxRows: options.maxRows ?? useUiStore.getState().queryMaxRows,
            consoleId: useEditorStore.getState().tabs.find((tab) => tab.id === tabId)?.transactionMode === 'manual' ? tabId : undefined,
            tabId,
            connectionName: options.connectionName,
            database: options.database,
            schema: options.schema,
          })
        } finally {
          streamState.unlisteners.forEach((unlisten) => unlisten())
        }
        if (streamState.state.failed) {
          void useQueryHistoryStore.getState().addEntry({
            connectionId,
            database: options.database,
            schema: options.schema,
            sql,
            status: 'failed',
            startedAt,
            elapsedMs: Math.round(performance.now() - startedMs),
            errorCode: 'QUERY_STREAM_FAILED',
            errorMessage: i18n.t('notifications.queryStreamFailed'),
          })
          notify({ kind: 'error', title: i18n.t('notifications.queryFailed') })
          return false
        }
      } else {
        const response = await executeQuery({
          connectionId,
          sql,
          queryId,
          consoleId: useEditorStore.getState().tabs.find((tab) => tab.id === tabId)?.transactionMode === 'manual' ? tabId : undefined,
          tabId,
          connectionName: options.connectionName,
          database: options.database,
          schema: options.schema,
        })
        setResults(queryId, response.results, classifyStatement(sql))
      }
      setResultSource(queryId, connectionId, options)
      if (useEditorStore.getState().tabs.find((tab) => tab.id === tabId)?.transactionMode === 'manual') {
        useEditorStore.getState().setTabTransactionState(tabId, 'manual', 'active')
      }
      if (containsLikelyDdl(sql)) {
        // The backend invalidates its metadata caches after successful DDL. Mirror that
        // boundary in the renderer so a previously expanded Object Browser does not
        // retain an empty/stale category until the user manually reloads it.
        useMetadataStore.getState().requestConnectionRefresh(connectionId)
        notify({
          kind: 'info',
          title: i18n.t('notifications.objectStructureChanged'),
          message: i18n.t('notifications.refreshObjectStructureHint'),
        })
      }
      recordQueryHistory(connectionId, sql, queryId, startedAt, performance.now() - startedMs, options)
      setTabQueryState(tabId, queryId)
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      void useQueryHistoryStore.getState().addEntry({
        connectionId,
        database: options.database,
        schema: options.schema,
        sql,
        status: 'failed',
        startedAt,
        elapsedMs: Math.round(performance.now() - startedMs),
        errorCode: appError.code,
        errorMessage: appError.message,
      })
      setTabQueryState(tabId, queryId, formatLocalError(appError))
      if (useEditorStore.getState().tabs.find((tab) => tab.id === tabId)?.transactionMode === 'manual') {
        useEditorStore.getState().setTabTransactionState(tabId, 'manual', 'failed')
      }
      notify({ kind: 'error', title: i18n.t('notifications.queryFailed') })
      return false
    }
  }

  async function runExplain(tabId: string, connectionId: string, sql: string, context: ExplainQueryContext = {}) {
    const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
    if (!tab || tab.connectionId !== connectionId || tab.closing || tab.transactionBusy || tab.running) return
    const queryId = crypto.randomUUID()
    setTabRunning(tabId, true, queryId)
    try {
      const response = await explainQuery(connectionId, sql, { ...context, queryId })
      setExplain(queryId, response)
      setTabQueryState(tabId, queryId)
    } catch (error) {
      const appError = normalizeAppError(error)
      setTabQueryState(tabId, queryId, appError.message)
      notifyError(appError, i18n.t('notifications.explainFailed'))
    } finally {
      if (context.consoleId) {
        try {
          const transaction = await getConsoleTransactionState(connectionId, context.consoleId)
          const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
          if (tab?.connectionId === connectionId && tab.transactionMode === 'manual' && tab.lastQueryId === queryId) {
            useEditorStore.getState().setTabTransactionState(tabId, transaction.mode, transaction.phase)
          }
        } catch {
          // Preserve the last known transaction state when the session is unavailable.
        }
      }
    }
  }

  async function cancelRunningQuery(tabId: string, connectionId: string, queryId: string) {
    try {
      setTabCancelling(tabId, true)
      await cancelQuery(connectionId, queryId)
      notify({ kind: 'info', title: i18n.t('notifications.cancelQueryRequested') })
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      notifyError(appError, i18n.t('notifications.cancelQueryFailed'))
      // A failed cancellation request does not mean execution has finished.
      setTabCancelling(tabId, false)
      return false
    }
  }

  return { runQuery, runExplain, cancelRunningQuery }
}

function recordQueryHistory(
  connectionId: string,
  sql: string,
  queryId: string,
  startedAt: string,
  elapsedMs: number,
  context: { database?: string | null; schema?: string | null },
) {
  const result = useQueryResultStore.getState().results[queryId]?.[0]
  void useQueryHistoryStore.getState().addEntry({
    connectionId,
    database: context.database,
    schema: context.schema,
    sql,
    status: 'success',
    startedAt,
    elapsedMs: result?.elapsedMs || Math.round(elapsedMs),
    rowCount: result?.rowCount ?? null,
    affectedRows: result?.affectedRows ?? null,
  })
}

function formatLocalError(error: { message: string; detail?: string }) {
  return error.detail ? `${error.message}\n${error.detail}` : error.message
}

async function registerStreamListeners(tabId: string, queryId: string) {
  const state = { failed: false }
  const unlisteners = await Promise.all([
    onQueryResultChunk((chunk) => {
      if (chunk.queryId === queryId) {
        useQueryResultStore.getState().appendResultChunk(chunk)
      }
    }),
    onQueryResultDone((done) => {
      if (done.queryId === queryId) {
        useQueryResultStore.getState().finishStreamResult(done)
      }
    }),
    onQueryResultError((error) => {
      if (error.queryId === queryId) {
        state.failed = true
        useEditorStore.getState().setTabQueryState(tabId, queryId, error.message)
      }
    }),
  ])

  return { state, unlisteners }
}

function canStreamSql(sql: string) {
  return splitSqlStatements(sql).length === 1
}

function classifyStatement(sql: string): import('@/types/query').QueryResult['statementKind'] {
  const statement = maskSql(sql).trim().toLowerCase()
  if (/^(insert|update|delete|replace|merge)\b/u.test(statement)) return 'dml'
  if (/^(create|alter|drop|rename|truncate)\b/u.test(statement)) return 'ddl'
  if (/^commit\b/u.test(statement)) return 'commit'
  if (/^rollback\b/u.test(statement)) return 'rollback'
  return 'other'
}

export function containsLikelyDdl(sql: string) {
  return splitSqlStatements(sql).some((statement) => {
    const normalized = maskSql(statement).trim().toLowerCase()
    return /^(create|alter|drop|truncate|rename)\b/u.test(normalized)
  })
}
