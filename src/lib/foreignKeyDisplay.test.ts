import { describe, expect, it } from 'vitest'
import { foreignKeyDisplayRows } from '@/lib/foreignKeyDisplay'
import type { ForeignKeyInfo } from '@/types/metadata'

const base = { schema: 'main', table: 'child_items', name: 'fk_child_items_0', referencedSchema: 'main', referencedTable: 'parent_items' } as ForeignKeyInfo

describe('foreign-key display rows', () => {
  it('tolerates SQLite optional column arrays', () => {
    const sparse = { ...base, columns: undefined, referencedColumns: undefined } as unknown as ForeignKeyInfo
    expect(() => foreignKeyDisplayRows([sparse])).not.toThrow()
    expect(foreignKeyDisplayRows([sparse])[0]).toEqual(['fk_child_items_0', '', 'main.parent_items', ''])
  })

  it('preserves rich and empty metadata shapes', () => {
    expect(foreignKeyDisplayRows([{ ...base, columns: ['parent_id'], referencedColumns: ['id'] }])[0]).toEqual(['fk_child_items_0', 'parent_id', 'main.parent_items', 'id'])
    expect(foreignKeyDisplayRows([])).toEqual([])
  })
})
