import { describe, expect, it } from 'vitest'
import cases from '@/shared/sql-lexer-cases.json'
import { leadingStatementKeyword, maskSql, splitSqlStatements, statementAtOffset } from './sqlLexer'

describe('shared SQL lexical contract', () => {
  it.each(cases)('splits $sql consistently with Rust', ({ sql, statements }) => {
    expect(splitSqlStatements(sql)).toEqual(statements)
  })
  it('selects the complete procedure at every internal cursor position', () => {
    const body = 'DO $$ BEGIN PERFORM 1; PERFORM 2; END $$'
    const sql = `${body}; SELECT 2;  `
    for (let offset = 0; offset <= body.length; offset += 1) expect(statementAtOffset(sql, offset)).toBe(body)
    expect(statementAtOffset(sql, sql.length)).toBe('SELECT 2')
  })
  it('keeps Monaco offsets after emoji and non-ASCII text', () => {
    const sql = "SELECT '😀中文;'; SELECT 2" // i18n-hardcoded-ok: Unicode SQL lexer fixture, not UI text.
    expect(maskSql(sql).length).toBe(sql.length)
    expect(statementAtOffset(sql, sql.indexOf('2'))).toBe('SELECT 2')
  })
  it('splits standalone GO batches without treating literals or GO counts as separators', () => {
    expect(splitSqlStatements("SELECT 'GO';\nGO\nSELECT 2")).toEqual(["SELECT 'GO'", 'SELECT 2'])
    expect(splitSqlStatements('SELECT 1 -- GO\n  go\r\nSELECT 2')).toEqual(['SELECT 1 -- GO', 'SELECT 2'])
    expect(splitSqlStatements('SELECT 1\nGO 2\nSELECT 2')).toEqual(['SELECT 1\nGO 2\nSELECT 2'])
    const script = 'SELECT 1\nGO\nSELECT 2'
    expect(statementAtOffset(script, script.indexOf('2'))).toBe('SELECT 2')
  })
  it.each([
    ['SELECT 1', 'select'],
    ['/* UPDATE hidden */ UPDATE items SET value = 1', 'update'],
    ['WITH ids AS (SELECT id FROM source) UPDATE items SET value = 1 WHERE id IN (SELECT id FROM ids)', 'update'],
    ['WITH ids AS (SELECT id FROM source), archived AS (DELETE FROM history RETURNING id) DELETE FROM items WHERE id IN (SELECT id FROM ids)', 'delete'],
    ['WITH RECURSIVE ids AS (SELECT 1 UNION ALL SELECT 2) INSERT INTO items SELECT * FROM ids', 'insert'],
    ['WITH changed AS (UPDATE items SET value = 1 RETURNING id) SELECT * FROM changed', 'select'],
    [`WITH "update" AS MATERIALIZED (SELECT q'[DELETE FROM items]' AS value) SELECT * FROM "update"`, 'select'],
    ['; WITH ids(id) AS NOT MATERIALIZED (SELECT 1) SELECT * FROM ids', 'select'],
  ])('finds the result-owning command in %s', (sql, keyword) => {
    expect(leadingStatementKeyword(sql)).toBe(keyword)
  })
})
