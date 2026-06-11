import type { DriverType } from '@/types/connection'
import type { QueryResult } from '@/types/query'
import { qualifiedName, quoteIdentifier } from '@/lib/dataTabSql'

export interface PendingCellChange {
  id: string
  rowIndex: number
  columnName: string
  columnIndex: number
  oldValue: unknown
  newValue: unknown
  keyValues: Record<string, unknown>
  status?: 'pending' | 'failed'
  error?: string | null
}

export interface DataEditTarget {
  driverType: DriverType
  schema: string
  table: string
  primaryKeyColumns: string[]
}

export function upsertPendingCellChange(
  changes: PendingCellChange[],
  change: PendingCellChange,
) {
  const next = changes.filter(
    (item) => !(item.rowIndex === change.rowIndex && item.columnName === change.columnName),
  )
  if (!valuesEqual(change.oldValue, change.newValue)) {
    next.push(change)
  }
  return next
}

export function buildPendingCellChange(input: {
  result: QueryResult
  rowIndex: number
  columnIndex: number
  newValue: string
  primaryKeyColumns: string[]
}): PendingCellChange | null {
  const column = input.result.columns[input.columnIndex]
  const row = input.result.rows[input.rowIndex]
  if (!column || !row) {
    return null
  }

  const keyValues: Record<string, unknown> = {}
  for (const primaryKeyColumn of input.primaryKeyColumns) {
    const keyIndex = input.result.columns.findIndex((item) => item.name === primaryKeyColumn)
    if (keyIndex < 0) {
      return null
    }
    keyValues[primaryKeyColumn] = row[keyIndex]
  }

  return {
    id: crypto.randomUUID(),
    rowIndex: input.rowIndex,
    columnIndex: input.columnIndex,
    columnName: column.name,
    oldValue: row[input.columnIndex],
    newValue: parseEditedValue(input.newValue, row[input.columnIndex]),
    keyValues,
    status: 'pending',
    error: null,
  }
}

export function buildTransactionalEditSql(target: DataEditTarget, changes: PendingCellChange[]) {
  const executableChanges = changes.filter((change) => change.status !== 'failed' || !change.error)
  if (executableChanges.length === 0) {
    return ''
  }

  return [
    transactionStartSql(target.driverType),
    ...executableChanges.map((change) => buildUpdateSql(target, change)),
    'COMMIT;',
  ].filter(Boolean).join('\n')
}

export function buildUpdateSql(target: DataEditTarget, change: PendingCellChange) {
  const quote = target.driverType === 'mysql' ? '`' : '"'
  const where = target.primaryKeyColumns
    .map((column) => {
      const keyValue = change.keyValues[column]
      const columnSql = quoteIdentifier(column, quote)
      return keyValue == null ? `${columnSql} IS NULL` : `${columnSql} = ${sqlLiteral(keyValue)}`
    })
    .join(' AND ')

  return [
    `-- change ${change.id}: row ${change.rowIndex + 1}, ${change.columnName}`,
    `UPDATE ${qualifiedName(target.driverType, target.schema, target.table)}`,
    `SET ${quoteIdentifier(change.columnName, quote)} = ${sqlLiteral(change.newValue)}`,
    `WHERE ${where};`,
  ].join('\n')
}

function parseEditedValue(value: string, oldValue: unknown) {
  if (value.toUpperCase() === 'NULL') {
    return null
  }
  if (typeof oldValue === 'number' && value.trim() !== '') {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : value
  }
  if (typeof oldValue === 'boolean') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
  }
  return value
}

function sqlLiteral(value: unknown) {
  if (value == null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return `'${value.toISOString().replaceAll("'", "''")}'`
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'`
  return `'${String(value).replaceAll("'", "''")}'`
}

function transactionStartSql(driverType: DriverType) {
  if (driverType === 'oracle') return ''
  if (driverType === 'mysql') return 'START TRANSACTION;'
  if (driverType === 'mssql') return 'BEGIN TRANSACTION;'
  return 'BEGIN;'
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
