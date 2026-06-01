import { create } from 'zustand'

export interface QueryHistoryEntry {
  id: string
  connectionId: string
  sql: string
  status: 'success' | 'failed'
  startedAt: string
  elapsedMs?: number | null
  rowCount?: number | null
  error?: string | null
}

const STORAGE_KEY = 'vaporlensdb.queryHistory'
const MAX_HISTORY = 200

interface QueryHistoryState {
  entries: QueryHistoryEntry[]
  addEntry: (entry: Omit<QueryHistoryEntry, 'id' | 'startedAt'> & { startedAt?: string }) => void
  clear: () => void
}

export const useQueryHistoryStore = create<QueryHistoryState>((set) => ({
  entries: readHistory(),
  addEntry: (entry) =>
    set((state) => {
      const entries = [
        {
          ...entry,
          id: crypto.randomUUID(),
          startedAt: entry.startedAt ?? new Date().toISOString(),
        },
        ...state.entries,
      ].slice(0, MAX_HISTORY)
      writeHistory(entries)
      return { entries }
    }),
  clear: () => {
    writeHistory([])
    set({ entries: [] })
  },
}))

function readHistory(): QueryHistoryEntry[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

function writeHistory(entries: QueryHistoryEntry[]) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function isHistoryEntry(value: unknown): value is QueryHistoryEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Partial<QueryHistoryEntry>
  return typeof entry.id === 'string' && typeof entry.connectionId === 'string' && typeof entry.sql === 'string'
}
