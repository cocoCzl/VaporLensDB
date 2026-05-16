import { create } from 'zustand'
import type { QueryResult } from '@/types/query'

interface QueryResultState {
  results: Record<string, QueryResult>
  setResult: (queryId: string, result: QueryResult) => void
  clearResult: (queryId: string) => void
}

export const useQueryResultStore = create<QueryResultState>((set) => ({
  results: {},
  setResult: (queryId, result) =>
    set((s) => ({ results: { ...s.results, [queryId]: result } })),
  clearResult: (queryId) =>
    set((s) => {
      const results = { ...s.results }
      delete results[queryId]
      return { results }
    }),
}))