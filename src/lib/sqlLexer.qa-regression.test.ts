import { expect, it } from 'vitest'
import { splitSqlStatements } from './sqlLexer'

it('does not count a comment-only suffix as an executable SQL statement', () => {
  expect(splitSqlStatements("SELECT 'semi;\u4e2d\u6587😀'; /* comment only ; */")).toHaveLength(1)
})

// The same lexical path is used by Current, selected SQL and All.
import { executionSql, EMPTY_CURSOR } from './sqlCommands'
import { statementAtOffset } from './sqlLexer'
it('keeps execution scopes and offsets while ignoring standalone comment segments', () => {
  const sql = "SELECT '-- ;', '/* */'; /* suffix */"
  expect(executionSql(sql, EMPTY_CURSOR, 'current')).toBe("SELECT '-- ;', '/* */'")
  expect(executionSql(sql, { start: 0, end: sql.length, cursor: 0 }, 'current')).toBe(sql)
  expect(executionSql(sql, EMPTY_CURSOR, 'all')).toBe(sql)
  expect(statementAtOffset(sql, sql.indexOf('suffix'))).toBe('')
  for (const comments of ['-- only', '/* only */;', '; /* nested /* c */ */;']) {
    expect(executionSql(comments, EMPTY_CURSOR, 'all')).toBe('')
    expect(splitSqlStatements(comments)).toEqual([])
  }
})
