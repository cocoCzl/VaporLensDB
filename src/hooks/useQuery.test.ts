import { describe, expect, it } from 'vitest'
import { containsLikelyDdl } from '@/hooks/useQuery'

describe('DDL metadata refresh classification', () => {
  it('classifies structure-changing statements without classifying ordinary SQL', () => {
    expect(containsLikelyDdl('CREATE TABLE child_items (id INTEGER PRIMARY KEY)')).toBe(true)
    expect(containsLikelyDdl('ALTER TABLE child_items ADD COLUMN note TEXT')).toBe(true)
    expect(containsLikelyDdl('DROP TABLE child_items')).toBe(true)
    expect(containsLikelyDdl('RENAME TABLE child_items TO archived_items')).toBe(true)
    expect(containsLikelyDdl('TRUNCATE TABLE child_items')).toBe(true)
    expect(containsLikelyDdl('SELECT 1')).toBe(false)
    expect(containsLikelyDdl('UPDATE child_items SET parent_id = parent_id WHERE id = 1')).toBe(false)
  })
})
