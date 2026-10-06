import { create } from 'zustand'
import type { ExecutionReport, ExplainResult, QueryExecutionSnapshot, QueryResult, QueryResultChunk, QueryStreamDone } from '@/types/query'
import { MAX_INTERACTIVE_RESULT_ROWS } from '@/stores/uiStore'

// The database can stream more rows for counting/export, but the grid keeps a
// fixed visual window so several open SQL tabs cannot retain unbounded data.
const MAX_RENDERED_RESULT_ROWS = 10_000
export const MAX_RENDERED_RESULT_BYTES = 4 * 1024 * 1024
const MAX_RETAINED_QUERY_RESULTS = 20
const utf8Encoder = new TextEncoder()

interface QueryResultState {
  reports: Record<string, ExecutionReport>
  setReport: (queryId: string, report: ExecutionReport) => void
  results: Record<string, QueryResult[]>
  explains: Record<string, ExplainResult>
  sources: Record<string, QueryExecutionSnapshot>
  retainedBytes: Record<string, number>
  setResults: (queryId: string, results: QueryResult[], statementKind?: QueryResult['statementKind']) => void
  setExplain: (queryId: string, explain: ExplainResult) => void
  setResultSource: (snapshot: QueryExecutionSnapshot) => void
  startStreamResult: (queryId: string, statementKind?: QueryResult['statementKind']) => void
  appendResultChunk: (chunk: QueryResultChunk) => void
  finishStreamResult: (done: QueryStreamDone) => boolean
  failStreamResult: (queryId: string) => boolean
  clearResult: (queryId: string) => void
}

export const useQueryResultStore = create<QueryResultState>((set) => ({
  reports: {},
  setReport: (queryId, report) => set(s => ({ reports: retainNewest({ ...s.reports, [queryId]: report }) })),
  results: {},
  explains: {},
  sources: {},
  retainedBytes: {},
  setResults: (queryId, results, statementKind) =>
    set((s) => {
      let bytes = 0
      const bounded = results.map((result) => {
        const rows: unknown[][] = []
        for (const row of result.rows) {
          if (rows.length >= MAX_RENDERED_RESULT_ROWS) break
          const rowBytes = estimateRetainedRowBytes(row)
          if (rowBytes > MAX_RENDERED_RESULT_BYTES - bytes) break
          rows.push(row)
          bytes += rowBytes
        }
        return { ...result, rows, streaming: false, statementKind: result.statementKind ?? statementKind, displayTruncated: result.displayTruncated || rows.length < result.rows.length }
      })
      return retainResultData({ ...s.results, [queryId]: bounded }, { ...s.retainedBytes, [queryId]: bytes })
    }),
  setExplain: (queryId, explain) =>
    set((s) => ({ explains: retainNewest({ ...s.explains, [queryId]: explain }) })),
  setResultSource: (snapshot) =>
    set((s) => ({ sources: retainNewest({
      ...s.sources,
      [snapshot.queryId]: { ...snapshot },
    }) })),
  startStreamResult: (queryId, statementKind) =>
    set((s) => s.results[queryId] ? s : ({
      ...retainResultData({
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
            streaming: true,
            statementKind,
          },
        ],
      }, { ...s.retainedBytes, [queryId]: 0 }),
    })),
  appendResultChunk: (chunk) =>
    set((s) => {
      const current = s.results[chunk.queryId]?.[0]
      if (!current?.streaming) return s
      // Keep the existing backing array so each incoming chunk does not copy all
      // prior rows (the old spread was O(n²) for a large streamed result).
      let bytes = s.retainedBytes[chunk.queryId] ?? 0
      let retained = 0
      if (!current.displayTruncated) {
        for (const row of chunk.rows) {
          if (current.rows.length >= MAX_RENDERED_RESULT_ROWS) break
          const rowBytes = estimateRetainedRowBytes(row)
          if (rowBytes > MAX_RENDERED_RESULT_BYTES - bytes) break
          current.rows.push(row)
          bytes += rowBytes
          retained += 1
        }
      }
      const next: QueryResult = {
        ...current,
        columns: current.columns.length ? current.columns : chunk.columns,
        rowCount: Math.max(current.rowCount, chunk.rowOffset + chunk.rows.length),
        displayTruncated: current.displayTruncated || retained < chunk.rows.length,
        maxRows: current.maxRows ?? MAX_RENDERED_RESULT_ROWS,
      }

      return retainResultData({ ...s.results, [chunk.queryId]: [next] }, { ...s.retainedBytes, [chunk.queryId]: bytes })
    }),
  finishStreamResult: (done) => {
    let accepted = false
    set((s) => {
      const current = s.results[done.queryId]?.[0]
      if (!current?.streaming) return s
      accepted = true
      const next: QueryResult = {
        ...current,
        rowCount: done.rowCount,
        affectedRows: done.affectedRows,
        elapsedMs: done.elapsedMs,
        truncated: done.truncated,
        displayTruncated: current.displayTruncated || current.rows.length < done.rowCount,
        maxRows: done.maxRows ?? current.maxRows ?? MAX_INTERACTIVE_RESULT_ROWS,
        firstRowMs: done.firstRowMs ?? null,
        receivedBytes: done.receivedBytes,
        streaming: false,
      }

      return { results: retainNewest({ ...s.results, [done.queryId]: [next] }) }
    })
    return accepted
  },
  failStreamResult: (queryId) => {
    let accepted = false
    set((s) => {
      const current = s.results[queryId]?.[0]
      if (!current?.streaming) return s
      accepted = true
      return { results: { ...s.results, [queryId]: [{ ...current, streaming: false }] } }
    })
    return accepted
  },
  clearResult: (queryId) =>
    set((s) => {
      const reports = { ...s.reports }
      delete reports[queryId]
      const results = { ...s.results }
      const explains = { ...s.explains }
      const sources = { ...s.sources }
      const retainedBytes = { ...s.retainedBytes }
      delete results[queryId]
      delete explains[queryId]
      delete sources[queryId]
      delete retainedBytes[queryId]
      return { results, explains, sources, retainedBytes, reports }
    }),
}))

function retainNewest<T>(record: Record<string, T>): Record<string, T> {
  const keys = Object.keys(record)
  if (keys.length <= MAX_RETAINED_QUERY_RESULTS) return record
  const next = { ...record }
  for (const key of keys.slice(0, keys.length - MAX_RETAINED_QUERY_RESULTS)) delete next[key]
  return next
}

function retainResultData(results: Record<string, QueryResult[]>, bytes: Record<string, number>) {
  const retained = retainNewest(results)
  return { results: retained, retainedBytes: Object.fromEntries(Object.keys(retained).map((queryId) => [queryId, bytes[queryId] ?? 0])) }
}

export function estimateRetainedRowBytes(row: unknown[]): number {
  return 16 + row.reduce<number>((bytes, value) => bytes + 8 + estimateRetainedValueBytes(value), 0)
}

function estimateRetainedValueBytes(value: unknown): number {
  if (value == null) return 4
  if (typeof value === 'boolean') return 4
  if (typeof value === 'number') return 8
  if (typeof value === 'string') return 16 + Math.max(utf8Encoder.encode(value).length, value.length * 2)
  if (Array.isArray(value)) return estimateRetainedRowBytes(value)
  if (typeof value === 'object') {
    return 32 + Object.entries(value).reduce((bytes, [key, cell]) => bytes + estimateRetainedValueBytes(key) + 8 + estimateRetainedValueBytes(cell), 0)
  }
  return 16
}
