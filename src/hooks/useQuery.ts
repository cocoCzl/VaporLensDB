import { leadingStatementKeyword, splitSqlStatements, unsupportedClientDirective } from '@/lib/sqlLexer'
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
    const transactionMode = tab.transactionMode === 'manual' ? 'manual' : 'auto'
    const consoleId = transactionMode === 'manual' ? tabId : undefined
    const unsupportedDirective = unsupportedClientDirective(sql)
    if (unsupportedDirective) {
      notify({ kind: 'error', title: i18n.t('notifications.queryFailed'), message: i18n.t('notifications.unsupportedClientDirective', { directive: unsupportedDirective }) })
      return false
    }
    let changedMetadata: boolean
    let terminalError: unknown
    let connectionGeneration: number | undefined
    setTabRunning(tabId, true, queryId)
    try {
      if (canStreamSql(sql)) {
        startStreamResult(queryId, classifyStatement(sql))
        const streamState = await registerStreamListeners(queryId)
        try {
          try {
            const session = await executeQueryStream({
              connectionId,
              sql,
              queryId,
              chunkSize: 1_000,
              maxRows: options.maxRows ?? useUiStore.getState().queryMaxRows,
              consoleId,
              tabId,
              connectionName: options.connectionName,
              database: options.database,
              schema: options.schema,
            })
            connectionGeneration = session.connectionGeneration
          } catch (error) {
            if (streamState.state.terminal !== 'done') throw streamState.state.error ?? error
          }
        } finally {
          streamState.unlisteners.forEach((unlisten) => unlisten())
        }
        if (streamState.state.error) throw streamState.state.error
        if (streamState.state.terminal !== 'done') throw { code: 'RESULT_PROCESSING_ERROR', message: i18n.t('notifications.queryStreamFailed') }
        changedMetadata = containsLikelyDdl(sql)
      } else {
        const response = await executeQuery({
          connectionId,
          sql,
          queryId,
          maxRows: options.maxRows ?? useUiStore.getState().queryMaxRows,
          consoleId,
          tabId,
          connectionName: options.connectionName,
          database: options.database,
          schema: options.schema,
        })
        connectionGeneration = response.connectionGeneration
        const statements = splitSqlStatements(sql)
        setResults(queryId, response.results.map((result, index) => ({ ...result, statementKind: classifyStatement(statements[index] ?? sql) })))
        if (response.statements && response.statements.length > 1) {
          useQueryResultStore.getState().setReport(queryId, { statements: response.statements, outcome: response.outcome ?? 'completed' })
        }
        terminalError = response.terminalError
        changedMetadata = response.statements
          ? response.statements.some(report => report.status === 'succeeded' && containsLikelyDdl(statements[report.index - 1] ?? ''))
          : !terminalError && containsLikelyDdl(sql)
      }
      if (connectionGeneration !== undefined) setResultSource({
        queryId,
        sql,
        connectionId,
        connectionGeneration,
        database: options.database ?? null,
        schema: options.schema ?? null,
        consoleId: consoleId ?? null,
        transactionMode,
        executedAt: startedAt,
      })
      if (changedMetadata) {
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
      if (terminalError) throw terminalError
      recordQueryHistory(connectionId, sql, queryId, startedAt, performance.now() - startedMs, options)
      if (isCurrentQuery(tabId, connectionId, queryId)) setTabQueryState(tabId, queryId)
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      const cancelled = appError.code === 'CANCELLED' || useQueryResultStore.getState().reports[queryId]?.outcome === 'cancelled'
      useQueryResultStore.getState().failStreamResult(queryId)
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
      if (isCurrentQuery(tabId, connectionId, queryId)) {
        setTabQueryState(tabId, queryId, cancelled ? null : formatLocalError(appError))
      }
      if (!cancelled) notify({ kind: 'error', title: i18n.t('notifications.queryFailed') })
      return false
    } finally {
      if (consoleId) {
        const transaction = await getConsoleTransactionState(connectionId, consoleId).catch(() => null)
        const current = useEditorStore.getState().tabs.find((item) => item.id === tabId)
        if (isCurrentQuery(tabId, connectionId, queryId) && current?.transactionMode === 'manual'
          && transaction?.connectionId === connectionId && transaction.consoleId === consoleId) {
          useEditorStore.getState().setTabTransactionState(tabId, transaction.mode, transaction.phase)
        }
      }
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
      setTabQueryState(tabId, queryId, appError.code === 'CANCELLED' ? null : appError.message)
      if (appError.code !== 'CANCELLED') notifyError(appError, i18n.t('notifications.explainFailed'))
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

function isCurrentQuery(tabId: string, connectionId: string, queryId: string) {
  const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
  return tab?.connectionId === connectionId && tab.lastQueryId === queryId && !tab.closing
}

async function registerStreamListeners(queryId: string) {
  const state: { terminal: 'done' | 'error' | null; error: ReturnType<typeof normalizeAppError> | null } = { terminal: null, error: null }
  const fail = (error: ReturnType<typeof normalizeAppError>) => {
    if (state.terminal) return
    state.terminal = 'error'
    state.error = error
    useQueryResultStore.getState().failStreamResult(queryId)
  }
  const registrations = await Promise.allSettled([
    onQueryResultChunk((chunk) => {
      if (chunk.queryId === queryId && !state.terminal) {
        try {
          useQueryResultStore.getState().appendResultChunk(chunk)
        } catch {
          fail({ code: 'RESULT_PROCESSING_ERROR', message: i18n.t('notifications.queryStreamFailed') })
        }
      }
    }),
    onQueryResultDone((done) => {
      if (done.queryId === queryId && !state.terminal) {
        try {
          useQueryResultStore.getState().finishStreamResult(done)
          state.terminal = 'done'
        } catch {
          fail({ code: 'RESULT_PROCESSING_ERROR', message: i18n.t('notifications.queryStreamFailed') })
        }
      }
    }),
    onQueryResultError((error) => {
      if (error.queryId === queryId) {
        fail(normalizeAppError(error))
      }
    }),
  ])
  const unlisteners = registrations.flatMap((registration) => registration.status === 'fulfilled' ? [registration.value] : [])
  const failed = registrations.find((registration) => registration.status === 'rejected')
  if (failed?.status === 'rejected') {
    unlisteners.forEach((unlisten) => unlisten())
    throw failed.reason
  }
  return { state, unlisteners }
}

function canStreamSql(sql: string) {
  return splitSqlStatements(sql).length === 1
}

export function classifyStatement(sql: string): import('@/types/query').QueryResult['statementKind'] {
  const keyword = leadingStatementKeyword(sql)
  if (keyword && ['insert', 'update', 'delete', 'replace', 'merge'].includes(keyword)) return 'dml'
  if (keyword && ['create', 'alter', 'drop', 'rename', 'truncate'].includes(keyword)) return 'ddl'
  if (keyword === 'commit') return 'commit'
  if (keyword === 'rollback') return 'rollback'
  return 'other'
}

export function containsLikelyDdl(sql: string) {
  return splitSqlStatements(sql).some((statement) => {
    const keyword = leadingStatementKeyword(statement)
    return keyword !== undefined && ['create', 'alter', 'drop', 'truncate', 'rename'].includes(keyword)
  })
}
