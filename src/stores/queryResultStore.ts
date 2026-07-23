import { create } from 'zustand'
import type { ExplainResult, QueryResult, QueryResultChunk, QueryStreamDone } from '@/types/query'

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
    set((s) => ({ results: { ...s.results, [queryId]: results } })),
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
      const next: QueryResult = {
        ...current,
        columns: current.columns.length ? current.columns : chunk.columns,
        rows: [...current.rows, ...chunk.rows],
        rowCount: Math.max(current.rowCount, chunk.rowOffset + chunk.rows.length),
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
        truncated: done.truncated,
        maxRows: done.maxRows ?? null,
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
