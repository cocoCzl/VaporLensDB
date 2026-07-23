import {
  cancelQuery,
  executeQuery,
  executeQueryStream,
  onQueryResultChunk,
  onQueryResultDone,
  onQueryResultError,
  explainQuery,
} from '@/ipc/query'
import i18n from '@/i18n'
import { normalizeAppError } from '@/ipc/client'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useUiStore } from '@/stores/uiStore'

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
    options: { maxRows?: number; database?: string | null; schema?: string | null } = {},
  ) {
    const queryId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const startedMs = performance.now()
    setTabRunning(tabId, true, queryId)
    try {
      if (canStreamSql(sql)) {
        startStreamResult(queryId)
        const streamState = await registerStreamListeners(tabId, queryId)
        try {
          await executeQueryStream({
            connectionId,
            sql,
            queryId,
            chunkSize: 1_000,
            maxRows: options.maxRows ?? useUiStore.getState().queryMaxRows,
          })
        } finally {
          streamState.unlisteners.forEach((unlisten) => unlisten())
        }
        if (streamState.state.failed) {
          void useQueryHistoryStore.getState().addEntry({
            connectionId,
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
        const response = await executeQuery({ connectionId, sql, queryId })
        setResults(queryId, response.results)
      }
      setResultSource(queryId, connectionId, options)
      if (containsLikelyDdl(sql)) {
        notify({
          kind: 'info',
          title: i18n.t('notifications.objectStructureChanged'),
          message: i18n.t('notifications.refreshObjectStructureHint'),
        })
      }
      recordQueryHistory(connectionId, sql, queryId, startedAt, performance.now() - startedMs)
      setTabQueryState(tabId, queryId)
      return true
    } catch (error) {
      const appError = normalizeAppError(error)
      void useQueryHistoryStore.getState().addEntry({
        connectionId,
        sql,
        status: 'failed',
        startedAt,
        elapsedMs: Math.round(performance.now() - startedMs),
        errorCode: appError.code,
        errorMessage: appError.message,
      })
      setTabQueryState(tabId, queryId, formatLocalError(appError))
      notify({ kind: 'error', title: i18n.t('notifications.queryFailed') })
      return false
    }
  }

  async function runExplain(tabId: string, connectionId: string, sql: string) {
    const queryId = crypto.randomUUID()
    setTabRunning(tabId, true)
    try {
      const response = await explainQuery(connectionId, sql)
      setExplain(queryId, response)
      setTabQueryState(tabId, queryId)
    } catch (error) {
      const appError = normalizeAppError(error)
      setTabQueryState(tabId, queryId, appError.message)
      notifyError(appError, i18n.t('notifications.explainFailed'))
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
      setTabQueryState(tabId, queryId, appError.message)
      notifyError(appError, i18n.t('notifications.cancelQueryFailed'))
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
) {
  const result = useQueryResultStore.getState().results[queryId]?.[0]
  void useQueryHistoryStore.getState().addEntry({
    connectionId,
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

function containsLikelyDdl(sql: string) {
  return splitSqlStatements(sql).some((statement) => {
    const normalized = statement.trim().toLowerCase()
    return (
      normalized.startsWith('create ') ||
      normalized.startsWith('alter ') ||
      normalized.startsWith('drop ') ||
      normalized.startsWith('truncate ') ||
      normalized.startsWith('rename ') ||
      normalized.startsWith('comment ') ||
      normalized.startsWith('grant ') ||
      normalized.startsWith('revoke ')
    )
  })
}

function splitSqlStatements(sql: string) {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (inLineComment) {
      current += char
      if (char === '\n') inLineComment = false
      continue
    }

    if (inBlockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += next
        index += 1
        inBlockComment = false
      }
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        current += char + next
        index += 1
        inLineComment = true
        continue
      }

      if (char === '/' && next === '*') {
        current += char + next
        index += 1
        inBlockComment = true
        continue
      }
    }

    if (char === "'" && !inDoubleQuote) {
      current += char
      if (inSingleQuote && next === "'") {
        current += next
        index += 1
      } else {
        inSingleQuote = !inSingleQuote
      }
      continue
    }

    if (char === '"' && !inSingleQuote) {
      current += char
      if (inDoubleQuote && next === '"') {
        current += next
        index += 1
      } else {
        inDoubleQuote = !inDoubleQuote
      }
      continue
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      if (current.trim()) statements.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) statements.push(current.trim())
  return statements
}
