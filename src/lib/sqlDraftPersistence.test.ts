import { describe, expect, it, vi } from 'vitest'
import {
  isEmptySqlDraft,
  persistDirtySqlDrafts,
  type SqlDraftPersistenceResult,
} from '@/lib/sqlDraftPersistence'
import type { EditorTab } from '@/stores/editorStore'
import type { SqlDraft } from '@/types/sqlDraft'

function tab(overrides: Partial<EditorTab>): EditorTab {
  return {
    id: 'sql-tab',
    kind: 'sql',
    title: 'SQL 1',
    sql: 'SELECT 1',
    connectionId: 'connection-1',
    dirty: true,
    ...overrides,
  }
}

function draft(id: string): SqlDraft {
  return {
    id,
    title: 'SQL 1',
    sql: 'SELECT 1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('SQL draft persistence semantics', () => {
  it('treats whitespace-only SQL as an explicitly cleared draft', () => {
    expect(isEmptySqlDraft('')).toBe(true)
    expect(isEmptySqlDraft(' \n\t ')).toBe(true)
    expect(isEmptySqlDraft('SELECT 1')).toBe(false)
  })

  it('persists dirty tabs independently and clears only the deleted draft reference', async () => {
    const tabs = [
      tab({ id: 'saved', sql: 'SELECT 1', draftId: 'saved-draft' }),
      tab({ id: 'cleared', sql: '   ', draftId: 'old-draft' }),
      tab({ id: 'never-edited', sql: '', draftId: null, dirty: false }),
    ]
    const saveTabDraft = vi.fn(async (current: EditorTab): Promise<SqlDraftPersistenceResult> => (
      isEmptySqlDraft(current.sql)
        ? { kind: 'cleared' }
        : { kind: 'saved', draft: draft('saved-draft') }
    ))
    const completeTabPersistence = vi.fn()

    await persistDirtySqlDrafts({
      tabs,
      connections: [],
      saveTabDraft,
      completeTabPersistence,
    })

    expect(saveTabDraft).toHaveBeenCalledTimes(2)
    expect(completeTabPersistence).toHaveBeenNthCalledWith(1, 'saved', 'saved-draft')
    expect(completeTabPersistence).toHaveBeenNthCalledWith(2, 'cleared', null)
    expect(completeTabPersistence).not.toHaveBeenCalledWith('never-edited', expect.anything())
  })

  it('keeps a tab dirty when native persistence cleanup fails', async () => {
    const completeTabPersistence = vi.fn()
    await persistDirtySqlDrafts({
      tabs: [tab({ sql: '', draftId: 'old-draft' })],
      connections: [],
      saveTabDraft: async () => null,
      completeTabPersistence,
    })

    expect(completeTabPersistence).not.toHaveBeenCalled()
  })
})
