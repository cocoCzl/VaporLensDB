import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import type { ConnectionConfig, ConnectionRuntimeStatus } from '@/types/connection'

export function highlightDataSourceMatch(value: string, query: string): ReactNode {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return value
  const index = value.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase())
  if (index < 0) return value
  return <>{value.slice(0, index)}<mark className="rounded-sm bg-primary/20 px-0.5 text-inherit">{value.slice(index, index + normalizedQuery.length)}</mark>{value.slice(index + normalizedQuery.length)}</>
}

/** The sidebar's second line is intentionally endpoint-first, never a driver dump. */
export function connectionEndpoint(connection: ConnectionConfig) {
  const host = nullableText(connection.host)
  if (host) return `${host}${connection.port ? `:${connection.port}` : ''}`

  const url = nullableText(connection.connectionUrl)
  return url ? compactConnectionUrl(url) : connection.driverType
}

export function filterConnections(connections: ConnectionConfig[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return connections

  return connections.filter((connection) =>
    [connection.name, connection.driverType, connection.group, connection.host, connection.database, connection.connectionUrl, connection.username, connectionEndpoint(connection)]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  )
}

export function orderGroupConnections(connections: ConnectionConfig[], favoriteIds: string[]) {
  return [...connections].sort((left, right) => {
    const favoriteDelta = Number(favoriteIds.includes(right.id)) - Number(favoriteIds.includes(left.id))
    return favoriteDelta || left.name.localeCompare(right.name)
  })
}

export function connectionStatusDotClass(status: ConnectionRuntimeStatus) {
  if (status === 'connected') return 'sidebar-status-dot bg-success'
  if (status === 'connecting') return 'sidebar-status-dot animate-pulse bg-primary/75'
  if (status === 'failed') return 'sidebar-status-dot bg-danger'
  return 'sidebar-status-dot bg-muted-foreground/45'
}

export function connectionStatusLabel(status: ConnectionRuntimeStatus, t: TFunction) {
  if (status === 'connected') return t('connection.connected')
  if (status === 'connecting') return t('connection.connecting')
  if (status === 'failed') return t('connection.failed')
  return t('connection.disconnected')
}

function nullableText(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null
}

function compactConnectionUrl(url: string) {
  return url
    .replace(/^jdbc:/, '')
    .replace(/^oracle:thin:@/, 'oracle:')
    .replace(/^postgresql:\/\//, 'postgres:')
    .replace(/^mysql:\/\//, 'mysql:')
}
