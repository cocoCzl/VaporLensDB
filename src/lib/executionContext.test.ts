import { describe, expect, it } from 'vitest'
import { executionDatabase } from './executionContext'
import type { ConnectionConfig } from '@/types/connection'

describe('execution database identity', () => {
  const connection: ConnectionConfig = { id: 'local', name: 'Local', driverType: 'sqlite', connectionUrl: '/local/current.sqlite' }
  it('uses the actual SQLite file even when a tab retains an incompatible database', () => {
    expect(executionDatabase(connection, 'old-postgres-db')).toBe('/local/current.sqlite')
    expect(executionDatabase({ ...connection, driverType: 'jdbc', driverDialect: 'sqlite', connectionUrl: 'jdbc:sqlite:/local/current.sqlite' })).toBe('/local/current.sqlite')
  })
  it('uses the PostgreSQL session database and never displays URL credentials', () => {
    expect(executionDatabase({ ...connection, driverType: 'postgres', database: 'actual' }, 'stale')).toBe('actual')
    expect(executionDatabase({ ...connection, driverType: 'jdbc', driverDialect: 'postgresql', connectionUrl: 'jdbc:postgresql://user:secret@localhost/actual' }, 'stale')).toBe('actual')
  })
  it('adopts the new connection without retaining the previous database', () => {
    expect(executionDatabase({ ...connection, connectionUrl: '/local/other.sqlite' })).toBe('/local/other.sqlite')
    expect(executionDatabase(undefined, 'stale')).toBeNull()
    expect(executionDatabase({ ...connection, driverType: 'mysql', database: 'default' }, 'selected')).toBe('selected')
  })
})
