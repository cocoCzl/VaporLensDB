import {
  cancelQuery,
  executeQuery,
  executeQueryStream,
  onQueryResultChunk,
  onQueryResultDone,
  onQueryResultError,
  explainQuery,
} from '@/ipc/query'
import { normalizeAppError } from '@/ipc/client'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { useUiStore } from '@/stores/uiStore'

const INTERACTIVE_QUERY_MAX_ROWS = 50_000

export function useQuery() {
  const setTabRunning = useEditorStore((state) => state.setTabRunning)
  const setTabQueryState = useEditorStore((state) => state.setTabQueryState)
  const setResults = useQueryResultStore((state) => state.setResults)
  const setExplain = useQueryResultStore((state) => state.setExplain)
  const startStreamResult = useQueryResultStore((state) => state.startStreamResult)
  const notifyError = useUiStore((state) => state.notifyError)

  async function runQuery(tabId: string, connectionId: string, sql: string) {
    const queryId = crypto.randomUUID()
    setTabRunning(tabId, true, queryId)
    try {
      if (canStreamSql(sql)) {
        startStreamResult(queryId)
        const unlisteners = await registerStreamListeners(tabId, queryId)
        try {
          await executeQueryStream({
            connectionId,
            sql,
            queryId,
            chunkSize: 1_000,
            maxRows: INTERACTIVE_QUERY_MAX_ROWS,
          })
        } finally {
          unlisteners.forEach((unlisten) => unlisten())
        }
      } else {
        const response = await executeQuery({ connectionId, sql, queryId })
        setResults(queryId, response.results)
      }
      setTabQueryState(tabId, queryId)
    } catch (error) {
      const appError = normalizeAppError(error)
      setTabQueryState(tabId, queryId, appError.message)
      notifyError(appError, '查询执行失败')
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
      notifyError(appError, '执行计划失败')
    }
  }

  async function cancelRunningQuery(tabId: string, connectionId: string, queryId: string) {
    try {
      await cancelQuery(connectionId, queryId)
    } catch (error) {
      const appError = normalizeAppError(error)
      setTabQueryState(tabId, queryId, appError.message)
      notifyError(appError, '取消查询失败')
    }
  }

  return { runQuery, runExplain, cancelRunningQuery }
}

async function registerStreamListeners(tabId: string, queryId: string) {
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
        useEditorStore.getState().setTabQueryState(tabId, queryId, error.message)
      }
    }),
  ])

  return unlisteners
}

function canStreamSql(sql: string) {
  return splitSqlStatements(sql).length === 1
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
