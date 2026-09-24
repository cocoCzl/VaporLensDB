import { describe, expect, it } from 'vitest'
import { buildDataTabSql, dataTabFetchLimit, qualifiedName } from './dataTabSql'

describe('SQL Server data preview pagination', () => {
  const base = { driverType: 'mssql' as const, schema: 'dbo', table: 'items', limit: 20 }

  it('uses OFFSET/FETCH with a primary-key order and one lookahead row', () => {
    expect(buildDataTabSql({ ...base, offset: 40, primaryKeyColumns: ['tenant_id', 'id'] }))
      .toBe('SELECT *\nFROM [dbo].[items]\nORDER BY [tenant_id] ASC, [id] ASC\nOFFSET 40 ROWS FETCH NEXT 21 ROWS ONLY')
  })

  it('supplies the required ORDER BY without claiming stability for keyless data', () => {
    expect(buildDataTabSql(base))
      .toBe('SELECT *\nFROM [dbo].[items]\nORDER BY (SELECT NULL)\nOFFSET 0 ROWS FETCH NEXT 21 ROWS ONLY')
  })

  it('preserves filters and uses primary keys to break selected-sort ties', () => {
    const sql = buildDataTabSql({
      ...base, wherePredicate: '  [active] = 1  ', sortColumn: 'name', sortDirection: 'desc',
      primaryKeyColumns: ['tenant_id', 'id'],
    })
    expect(sql).toBe('SELECT *\nFROM [dbo].[items]\nWHERE [active] = 1\nORDER BY [name] DESC, [tenant_id] ASC, [id] ASC\nOFFSET 0 ROWS FETCH NEXT 21 ROWS ONLY')
    expect(sql).not.toContain('LIMIT')
  })

  it('does not repeat the selected primary key or mutate the input key list', () => {
    const primaryKeyColumns = ['tenant_id', 'id']
    const input = { ...base, sortColumn: 'id', sortDirection: 'desc' as const, primaryKeyColumns }
    expect(buildDataTabSql(input)).toContain('ORDER BY [id] DESC, [tenant_id] ASC\n')
    expect(primaryKeyColumns).toEqual(['tenant_id', 'id'])
  })

  it('uses the selected sort without the placeholder on a keyless table', () => {
    const sql = buildDataTabSql({ ...base, sortColumn: 'name' })
    expect(sql).toContain('ORDER BY [name] ASC\n')
    expect(sql).not.toContain('(SELECT NULL)')
  })

  it('escapes bracket identifiers independently of QUOTED_IDENTIFIER', () => {
    const sql = buildDataTabSql({ ...base, schema: 'a]b', table: 'order', sortColumn: 'x]y' })
    expect(sql).toContain('FROM [a]]b].[order]\nORDER BY [x]]y] ASC')
    expect(qualifiedName('mssql', 'dbo', 'a"b')).toBe('[dbo].[a"b]')
  })

  it('keeps existing rounding, nonnegative offsets and lookahead semantics', () => {
    expect(buildDataTabSql({ ...base, limit: 2.6, offset: -10 }))
      .toContain('OFFSET 0 ROWS FETCH NEXT 4 ROWS ONLY')
    expect(dataTabFetchLimit(0)).toBe(2)
  })
})

describe('other data preview dialects', () => {
  it.each(['postgres', 'mysql', 'sqlite'] as const)('preserves %s LIMIT/OFFSET', (driverType) => {
    const sql = buildDataTabSql({ driverType, schema: 'app', table: 'items', limit: 20, offset: 40 })
    expect(sql).toBe(driverType === 'mysql'
      ? 'SELECT *\nFROM `app`.`items`\nLIMIT 21 OFFSET 40;'
      : 'SELECT *\nFROM "app"."items"\nLIMIT 21 OFFSET 40;')
  })

  it('preserves Oracle syntax without introducing the SQL Server fallback', () => {
    expect(buildDataTabSql({ driverType: 'oracle', schema: 'APP', table: 'ITEMS', limit: 20 }))
      .toBe('SELECT *\nFROM "APP"."ITEMS"\nOFFSET 0 ROWS FETCH NEXT 21 ROWS ONLY')
  })
})
