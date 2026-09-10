import type { QueryHistoryEntry } from '@/types/queryHistory'

export interface PaletteSearchItem {
  id: string
  label: string
  searchText: string
  currentConnection?: boolean
}

interface DatabaseObjectSearchFields {
  name: string
  displayName?: string
  database?: string | null
  schema?: string | null
}

/**
 * Object search deliberately excludes its owning connection. Connections are
 * searchable in their own group; including one here makes every cached object
 * under "Local Oracle", for example, falsely match "oracle".
 */
export function databaseObjectSearchText({
  name,
  displayName,
  database,
  schema,
}: DatabaseObjectSearchFields) {
  const objectDisplayName = displayName?.trim() || name
  const qualifiedPath = [database, schema, objectDisplayName].filter(Boolean).join(' ')
  return [...new Set([name, objectDisplayName, qualifiedPath].filter(Boolean))].join(' ')
}

/**
 * The Palette is a navigation surface, not the full query-history view. Keep
 * only the newest entry for an identical SQL statement in the same connection
 * context without mutating the store's complete history.
 */
export function dedupePaletteQueryHistory(entries: readonly QueryHistoryEntry[]) {
  const newestFirst = entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex, startedAt: dateValue(entry.startedAt) }))
    .sort((left, right) => {
      if (left.startedAt === null && right.startedAt === null) return left.sourceIndex - right.sourceIndex
      if (left.startedAt === null) return 1
      if (right.startedAt === null) return -1
      return right.startedAt - left.startedAt || left.sourceIndex - right.sourceIndex
    })

  const seen = new Set<string>()
  return newestFirst
    .filter(({ entry }) => {
      const key = [
        normalizeSql(entry.sql),
        entry.connectionId,
        entry.database ?? '',
        entry.schema ?? '',
      ].join('\u0000')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(({ entry }) => entry)
}

/** Small, predictable ranking for the palette; no fuzzy-search dependency needed. */
export function rankPaletteItems<T extends PaletteSearchItem>(items: T[], query: string, activeConnectionId: string | null) {
  const normalizedQuery = normalizeSearch(query)
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex, score: searchScore(item, normalizedQuery, activeConnectionId) }))
    .filter((candidate): candidate is { item: T; sourceIndex: number; score: number } => candidate.score !== null)
    .sort((left, right) => left.score - right.score || left.sourceIndex - right.sourceIndex)
    .map(({ item }) => item)
}

function searchScore(item: PaletteSearchItem, normalizedQuery: string, activeConnectionId: string | null) {
  const label = normalizeSearch(item.label)
  const haystack = normalizeSearch(item.searchText)
  const words = label.split(' ').filter(Boolean)
  let score: number
  if (label === normalizedQuery) score = 0
  else if (label.startsWith(normalizedQuery)) score = 40
  else if (words.some((word) => word.startsWith(normalizedQuery))) score = 90
  else if (haystack.includes(normalizedQuery)) score = 180
  else return null

  if (item.currentConnection || item.searchText.includes(activeConnectionId ?? '__none__')) score -= 8
  return score
}

function normalizeSearch(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSql(value: string) {
  return value
    .trim()
    .replace(/;+\s*$/, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

function dateValue(value: string) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}
