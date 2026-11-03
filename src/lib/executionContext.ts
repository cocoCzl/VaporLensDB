import { connectionSqlDialect } from '@/lib/databaseDialect'
import type { ConnectionConfig } from '@/types/connection'

/** Database identity of this execution connection, independent of Explorer.
 * SQLite and PostgreSQL cannot change databases on their existing session.
 */
export function executionDatabase(connection: ConnectionConfig | undefined, database?: string | null): string | null {
  if (!connection) return null
  const dialect = connectionSqlDialect(connection)
  if (dialect === 'sqlite') return connection.connectionUrl?.replace(/^jdbc:sqlite:/i, '') || connection.database || null
  if (dialect === 'postgres') {
    if (connection.database) return connection.database
    try {
      const url = new URL((connection.connectionUrl ?? '').replace(/^jdbc:/i, ''))
      return decodeURIComponent(url.pathname.slice(1)) || null
    } catch { return null }
  }
  return database ?? connection.database ?? null
}
