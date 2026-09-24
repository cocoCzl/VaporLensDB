/** Mirrors the backend lexer; offsets are UTF-16 for Monaco, not UTF-8 bytes. */
export function maskSql(sql: string): string {
  const output = sql.split('')
  const identifier = (char: string | undefined) => char !== undefined && /[a-zA-Z0-9_$\u0080-\uffff]/u.test(char)
  let index = 0
  while (index < sql.length) {
    const start = index
    const oracleQuoteEnd = oracleQQuoteEnd(sql, index, identifier)
    if (sql.startsWith('--', index)) {
      while (index < sql.length && !/[\r\n]/u.test(sql[index])) index += 1
    } else if (sql.startsWith('/*', index)) {
      index += 2
      let depth = 1
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) { depth += 1; index += 2 }
        else if (sql.startsWith('*/', index)) { depth -= 1; index += 2 }
        else index += 1
      }
    } else if (oracleQuoteEnd !== undefined) {
      index = oracleQuoteEnd
    } else if (['\'', '"', '`', '['].includes(sql[index])) {
      const quote = sql[index]
      const end = quote === '[' ? ']' : quote
      const escaped = quote === "'" && index > 0 && /[eE]/u.test(sql[index - 1]) && !identifier(sql[index - 2])
      index += 1
      while (index < sql.length) {
        if (escaped && sql[index] === '\\') index = Math.min(index + 2, sql.length)
        else if (sql[index] === end) {
          index += 1
          if (sql[index] === end) index += 1
          else break
        } else index += 1
      }
    } else {
      const delimiter = sql[index] === '$' && !identifier(sql[index - 1])
        ? /^(\$\$|\$[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff]*\$)/u.exec(sql.slice(index))?.[0]
        : undefined
      if (!delimiter) { index += 1; continue }
      const end = sql.indexOf(delimiter, index + delimiter.length)
      index = end < 0 ? sql.length : end + delimiter.length
    }
    for (let at = start; at < index; at += 1) {
      if (sql[at] !== '\n' && sql[at] !== '\r') output[at] = ' '
    }
  }
  return output.join('')
}

/** Returns the command that owns the statement result, including after a CTE list. */
export function leadingStatementKeyword(sql: string): string | undefined {
  const firstStatement = splitSqlStatements(sql)[0]
  if (!firstStatement) return undefined
  const masked = maskSql(firstStatement)
  const first = readWord(masked, 0)
  if (!first || first.word !== 'with') return first?.word

  let index = first.end
  const recursive = readWord(masked, index)
  if (recursive?.word === 'recursive') index = recursive.end

  while (index < masked.length) {
    const asKeyword = findTopLevelWord(masked, index, 'as')
    if (!asKeyword) return undefined
    index = asKeyword.end

    let modifier = readWord(masked, index)
    if (modifier?.word === 'not') {
      index = modifier.end
      modifier = readWord(masked, index)
    }
    if (modifier?.word === 'materialized') index = modifier.end

    index = skipWhitespace(masked, index)
    if (masked[index] !== '(') return undefined
    index = skipBalancedParentheses(masked, index)
    if (index < 0) return undefined
    index = skipWhitespace(masked, index)
    if (masked[index] === ',') {
      index += 1
      continue
    }
    return readWord(masked, index)?.word
  }
  return undefined
}

function skipWhitespace(value: string, index: number) {
  while (index < value.length && /\s/u.test(value[index])) index += 1
  return index
}

function readWord(value: string, index: number) {
  const start = skipWhitespace(value, index)
  const match = /^[a-zA-Z_][a-zA-Z0-9_$]*/u.exec(value.slice(start))
  return match ? { word: match[0].toLowerCase(), end: start + match[0].length } : undefined
}

function findTopLevelWord(value: string, index: number, expected: string) {
  let depth = 0
  while (index < value.length) {
    const char = value[index]
    if (char === '(') { depth += 1; index += 1; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); index += 1; continue }
    if (depth === 0) {
      const token = readWord(value, index)
      if (token && token.end > index) {
        if (token.word === expected) return token
        index = token.end
        continue
      }
    }
    index += 1
  }
  return undefined
}

function skipBalancedParentheses(value: string, index: number) {
  let depth = 0
  while (index < value.length) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')' && --depth === 0) return index + 1
    index += 1
  }
  return -1
}

function oracleQQuoteEnd(
  sql: string,
  index: number,
  identifier: (char: string | undefined) => boolean,
) {
  if (!/[qQ]/u.test(sql[index] ?? '') || sql[index + 1] !== "'" || identifier(sql[index - 1])) return undefined
  const opening = sql[index + 2]
  if (!opening || /\s/u.test(opening) || opening === "'" || opening.charCodeAt(0) > 0x7f) return undefined
  const closing = ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string, string>)[opening] ?? opening
  const end = sql.indexOf(`${closing}'`, index + 3)
  return end < 0 ? sql.length : end + 2
}

function statementRanges(sql: string) {
  const mask = maskSql(sql)
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  for (let end = 0; end <= sql.length; end += 1) {
    if (end !== sql.length && mask[end] !== ';') continue
    if (sql.slice(start, end).trim()) ranges.push({ start, end })
    start = end + 1
  }
  return ranges
}

export function splitSqlStatements(sql: string): string[] {
  return statementRanges(sql).map(({ start, end }) => sql.slice(start, end).trim())
}

export function statementAtOffset(sql: string, offset: number): string {
  const statements = statementRanges(sql)
  const statement = statements.find((item) => offset >= item.start && offset <= item.end)
    ?? statements.filter((item) => item.end < offset && /^[\s;]*$/u.test(sql.slice(item.end, offset))).at(-1)
  return statement ? sql.slice(statement.start, statement.end).trim() : ''
}
