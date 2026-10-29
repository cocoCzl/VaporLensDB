import { describe, expect, it } from 'vitest'
import { connectionSqlDialect, resolveSqlDialect } from './databaseDialect'
import { buildDataTabSql } from './dataTabSql'
describe('shared dialect resolution', () => {
  it('uses the same product dialect for native PG and JDBC PG', () => {
    const sql = (driverType: 'jdbc'|'postgres') => buildDataTabSql({driverType:connectionSqlDialect({driverType,driverDialect:'postgresql'}),schema:'public',table:'items',limit:10})
    expect(sql('jdbc')).toBe(sql('postgres'))
  })
  it('preserves unknown dialects as unavailable instead of guessing', () => {
    expect(resolveSqlDialect('unknown-compatibility')).toBeNull()
    expect(connectionSqlDialect({driverType:'jdbc',driverDialect:'unknown-compatibility'})).toBe('jdbc')
  })
})
