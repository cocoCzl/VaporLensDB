import { create } from 'zustand'
import type { ExplainResult, QueryResult, QueryResultChunk, QueryStreamDone } from '@/types/query'
import { MAX_INTERACTIVE_RESULT_ROWS } from '@/stores/uiStore'

// The database can stream more rows for counting/export, but the grid keeps a
// fixed visual window so several open SQL tabs cannot retain unbounded data.
const MAX_RENDERED_RESULT_ROWS = 10_000

interface QueryResultState {
  results: Record<string, QueryResult[]>
  explains: Record<string, ExplainResult>
  sources: Record<string, { connectionId: string; database: string | null; schema: string | null; executedAt: string }>
  setResults: (queryId: string, results: QueryResult[]) => void
  setExplain: (queryId: string, explain: ExplainResult) => void
  setResultSource: (queryId: string, connectionId: string, context?: { database?: string | null; schema?: string | null }) => void
  startStreamResult: (queryId: string) => void
  appendResultChunk: (chunk: QueryResultChunk) => void
  finishStreamResult: (done: QueryStreamDone) => void
  clearResult: (queryId: string) => void
}

export const useQueryResultStore = create<QueryResultState>((set) => ({
  results: {},
  explains: {},
  sources: {},
  setResults: (queryId, results) =>
    set((s) => ({ results: { ...s.results, [queryId]: results.map(boundInteractiveResult) } })),
  setExplain: (queryId, explain) =>
    set((s) => ({ explains: { ...s.explains, [queryId]: explain } })),
  setResultSource: (queryId, connectionId, context = {}) =>
    set((s) => ({ sources: {
      ...s.sources,
      [queryId]: {
        connectionId,
        database: context.database ?? null,
        schema: context.schema ?? null,
        executedAt: new Date().toISOString(),
      },
    } })),
  startStreamResult: (queryId) =>
    set((s) => ({
      results: {
        ...s.results,
        [queryId]: [
          {
            columns: [],
            rows: [],
            rowCount: 0,
            elapsedMs: 0,
            affectedRows: 0,
            queryId,
            truncated: false,
            maxRows: null,
          },
        ],
      },
    })),
  appendResultChunk: (chunk) =>
    set((s) => {
      const current = s.results[chunk.queryId]?.[0] ?? emptyQueryResult(chunk.queryId)
      // Keep the existing backing array so each incoming chunk does not copy all
      // prior rows (the old spread was O(n²) for a large streamed result).
      const available = Math.max(0, MAX_RENDERED_RESULT_ROWS - current.rows.length)
      if (chunk.rows.length <= available) current.rows.push(...chunk.rows)
      else if (available > 0) current.rows.push(...chunk.rows.slice(0, available))
      const next: QueryResult = {
        ...current,
        columns: current.columns.length ? current.columns : chunk.columns,
        rowCount: Math.max(current.rowCount, chunk.rowOffset + Math.min(chunk.rows.length, available)),
        truncated: current.truncated || chunk.rows.length > available,
        displayTruncated: current.displayTruncated || chunk.rows.length > available,
        maxRows: current.maxRows ?? MAX_RENDERED_RESULT_ROWS,
      }

      return { results: { ...s.results, [chunk.queryId]: [next] } }
    }),
  finishStreamResult: (done) =>
    set((s) => {
      const current = s.results[done.queryId]?.[0] ?? emptyQueryResult(done.queryId)
      const next: QueryResult = {
        ...current,
        rowCount: done.rowCount,
        affectedRows: done.affectedRows,
        elapsedMs: done.elapsedMs,
        truncated: done.truncated || current.truncated || current.rows.length < done.rowCount,
        displayTruncated: current.displayTruncated ?? false,
        maxRows: current.displayTruncated
          ? MAX_RENDERED_RESULT_ROWS
          : done.maxRows ?? current.maxRows ?? MAX_INTERACTIVE_RESULT_ROWS,
        firstRowMs: done.firstRowMs ?? null,
        receivedBytes: done.receivedBytes,
      }

      return { results: { ...s.results, [done.queryId]: [next] } }
    }),
  clearResult: (queryId) =>
    set((s) => {
      const results = { ...s.results }
      const explains = { ...s.explains }
      const sources = { ...s.sources }
      delete results[queryId]
      delete explains[queryId]
      delete sources[queryId]
      return { results, explains, sources }
    }),
}))

function emptyQueryResult(queryId: string): QueryResult {
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    elapsedMs: 0,
    affectedRows: 0,
    queryId,
    truncated: false,
    maxRows: null,
  }
}

function boundInteractiveResult(result: QueryResult): QueryResult {
  if (result.rows.length <= MAX_RENDERED_RESULT_ROWS) return result
  return {
    ...result,
    rows: result.rows.slice(0, MAX_RENDERED_RESULT_ROWS),
    truncated: true,
    displayTruncated: true,
    maxRows: MAX_RENDERED_RESULT_ROWS,
  }
}
