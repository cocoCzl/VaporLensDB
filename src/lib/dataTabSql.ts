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
  const limit = Math.max(1, Math.round(input.limit))
  const offset = Math.max(0, Math.round(input.offset ?? 0))
  const lines = [`SELECT *`, `FROM ${qualifiedName(input.driverType, input.schema, input.table)}`]
  const wherePredicate = input.wherePredicate?.trim()
  if (wherePredicate) {
    lines.push(`WHERE ${wherePredicate}`)
  }

  const orderColumns = input.sortColumn
    ? [{ name: input.sortColumn, direction: input.sortDirection ?? 'asc' }]
    : (input.primaryKeyColumns ?? []).map((name) => ({ name, direction: 'asc' as const }))
  if (orderColumns.length > 0) {
    lines.push(
      `ORDER BY ${orderColumns
        .map((column) => `${quoteIdentifier(column.name, quoteFor(input.driverType))} ${column.direction.toUpperCase()}`)
        .join(', ')}`,
    )
  }

  if (input.driverType === 'oracle') {
    lines.push(`OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`)
    return lines.join('\n')
  }

  lines.push(`LIMIT ${limit} OFFSET ${offset};`)
  return lines.join('\n')
}

export function qualifiedName(driverType: DriverType, schema: string, table: string) {
  const quote = quoteFor(driverType)
  return `${quoteIdentifier(schema, quote)}.${quoteIdentifier(table, quote)}`
}

export function quoteIdentifier(value: string, quote: '"' | '`') {
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`
}

function quoteFor(driverType: DriverType) {
  return driverType === 'mysql' ? '`' : '"'
}
