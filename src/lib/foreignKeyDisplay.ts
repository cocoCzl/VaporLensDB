import type { ForeignKeyInfo } from '@/types/metadata'

export function foreignKeyDisplayRows(foreignKeys: ForeignKeyInfo[]): string[][] {
  return foreignKeys.map((key) => [
    key.name ?? '',
    (key.columns ?? []).join(', '),
    [key.referencedSchema, key.referencedTable].filter(Boolean).join('.'),
    (key.referencedColumns ?? []).join(', '),
  ])
}
