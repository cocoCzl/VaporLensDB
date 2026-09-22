import { describe, expect, it } from 'vitest'
import cases from '@/shared/sql-lexer-cases.json'
import { maskSql, splitSqlStatements, statementAtOffset } from './sqlLexer'

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
})
