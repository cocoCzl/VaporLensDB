import { describe, expect, it } from 'vitest'
import { defaultConnectionName, nextConnectionName } from '@/lib/defaultConnectionName'

describe('datasource default names', () => {
  it('uses the canonical built-in defaults', () => {
    expect(defaultConnectionName('postgres')).toBe('Local PostgreSQL')
    expect(defaultConnectionName('mysql')).toBe('Local MySQL')
    expect(defaultConnectionName('sqlite')).toBe('Local SQLite')
    expect(defaultConnectionName('mssql')).toBe('Local SQL Server')
    expect(defaultConnectionName('oracle')).toBe('Local Oracle')
  })

  it('updates a generated name across driver switches', () => {
    expect(nextConnectionName('Local PostgreSQL', true, 'mysql')).toBe('Local MySQL')
    expect(nextConnectionName('Local MySQL', true, 'sqlite')).toBe('Local SQLite')
    expect(nextConnectionName('Local SQLite', true, 'mssql')).toBe('Local SQL Server')
    expect(nextConnectionName('Local SQL Server', true, 'oracle')).toBe('Local Oracle')
    expect(nextConnectionName('Local Oracle', true, 'postgres')).toBe('Local PostgreSQL')
  })

  it('preserves a name once the user has edited it', () => {
    expect(nextConnectionName('Production Orders', false, 'mysql')).toBe('Production Orders')
  })
})
