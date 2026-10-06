import type { ColumnInfo } from '@/types/metadata'

export function writableCsvColumns(columns: ColumnInfo[]) {
  return columns.filter(column => !column.isGenerated && !column.isIdentity && !column.isAutoIncrement)
}

export function defaultCsvMapping(headers: string[], targets: string[], hasHeader: boolean): (string | null)[] {
  const used = new Set<string>()
  return headers.map((header, index) => {
    const target = hasHeader ? targets.find(name => name === header) : targets[index]
    if (!target || used.has(target)) return null
    used.add(target)
    return target
  })
}

export function validCsvMapping(mapping: (string | null)[], width: number, targets: string[]) {
  const selected = mapping.filter((value): value is string => value !== null)
  return mapping.length === width && selected.length > 0 && new Set(selected).size === selected.length
    && selected.every(value => targets.includes(value))
}
