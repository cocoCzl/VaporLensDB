import type { DriverType } from '@/types/connection'

export type DataTabSortDirection = 'asc' | 'desc'

export interface DataTabSqlInput {
  driverType: DriverType
  schema: string
  table: string
  limit: number
  offset?: number
  wherePredicate?: string | null
  sortColumn?: string | null
  sortDirection?: DataTabSortDirection | null
  primaryKeyColumns?: string[]
}

export function buildDataTabSql(input: DataTabSqlInput) {
  const limit = dataTabFetchLimit(input.limit)
  const offset = Math.max(0, Math.round(input.offset ?? 0))
  const lines = [`SELECT *`, `FROM ${qualifiedName(input.driverType, input.schema, input.table)}`]
  const wherePredicate = input.wherePredicate?.trim()
  if (wherePredicate) {
    lines.push(`WHERE ${wherePredicate}`)
  }

  const orderColumns = input.sortColumn
    ? [{ name: input.sortColumn, direction: input.sortDirection ?? 'asc' }]
    : (input.primaryKeyColumns ?? []).map((name) => ({ name, direction: 'asc' as const }))
  if (input.driverType === 'mssql' && input.sortColumn) {
    // A non-unique selected sort needs the full primary key as a tie-breaker.
    // This does not provide snapshot consistency across concurrent writes.
    const orderedNames = new Set(orderColumns.map((column) => column.name))
    for (const name of input.primaryKeyColumns ?? []) {
      if (!orderedNames.has(name)) {
        orderColumns.push({ name, direction: 'asc' })
        orderedNames.add(name)
      }
    }
  }
  if (orderColumns.length > 0) {
    lines.push(
      `ORDER BY ${orderColumns
        .map((column) => `${quoteIdentifier(column.name, quoteFor(input.driverType))} ${column.direction.toUpperCase()}`)
        .join(', ')}`,
    )
  } else if (input.driverType === 'mssql') {
    // SQL Server requires ORDER BY for OFFSET/FETCH. With no key or selected
    // sort, this is deliberately unordered; the existing UI warning applies.
    lines.push('ORDER BY (SELECT NULL)')
  }

  if (input.driverType === 'oracle' || input.driverType === 'mssql') {
    lines.push(`OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`)
    return lines.join('\n')
  }

  lines.push(`LIMIT ${limit} OFFSET ${offset};`)
  return lines.join('\n')
}

export function dataTabFetchLimit(limit: number) {
  return Math.max(1, Math.round(limit)) + 1
}

export function qualifiedName(driverType: DriverType, schema: string, table: string) {
  const quote = quoteFor(driverType)
  return `${quoteIdentifier(schema, quote)}.${quoteIdentifier(table, quote)}`
}

export function quoteIdentifier(value: string, quote: '"' | '`' | '[') {
  if (quote === '[') return `[${value.replaceAll(']', ']]')}]`
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`
}

function quoteFor(driverType: DriverType) {
  if (driverType === 'mssql') return '['
  return driverType === 'mysql' ? '`' : '"'
}
