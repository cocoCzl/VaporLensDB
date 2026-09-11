import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearSqlDrafts: vi.fn(),
  deleteSqlDraft: vi.fn(),
  listSqlDrafts: vi.fn(),
  markSqlDraftClosed: vi.fn(),
  notifyError: vi.fn(),
  upsertSqlDraft: vi.fn(),
}))

vi.mock('@/ipc/sqlDraft', () => ({
  clearSqlDrafts: mocks.clearSqlDrafts,
  deleteSqlDraft: mocks.deleteSqlDraft,
  listSqlDrafts: mocks.listSqlDrafts,
  markSqlDraftClosed: mocks.markSqlDraftClosed,
  upsertSqlDraft: mocks.upsertSqlDraft,
}))

vi.mock('@/stores/uiStore', () => ({
  useUiStore: { getState: () => ({ notifyError: mocks.notifyError }) },
}))

import { useSqlDraftStore } from '@/stores/sqlDraftStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import type { EditorTab } from '@/stores/editorStore'
import type { SqlDraft } from '@/types/sqlDraft'

function tab(overrides: Partial<EditorTab>): EditorTab {
  return {
    id: 'sql-tab',
    kind: 'sql',
    title: 'SQL 1',
    sql: '',
    connectionId: 'connection-1',
    dirty: true,
    ...overrides,
  }
}

function draft(id = 'draft-1'): SqlDraft {
  return {
    id,
    title: 'SQL 1',
    sql: 'SELECT 1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('native SQL draft persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSqlDraftStore.setState({ drafts: [], loading: false, error: null })
    useQueryHistoryStore.setState({
      entries: [{
        id: 'history-1',
        connectionId: 'connection-1',
        connectionNameSnapshot: 'Local MySQL',
        driverType: 'mysql',
        sql: 'SELECT 1',
        status: 'success',
        startedAt: '2026-01-01T00:00:00.000Z',
      }],
    })
  })

  it('does not create a native record for a new empty tab', async () => {
    const result = await useSqlDraftStore.getState().saveTabDraft(tab({ draftId: null }), {})

    expect(result).toEqual({ kind: 'cleared' })
    expect(mocks.deleteSqlDraft).not.toHaveBeenCalled()
    expect(mocks.upsertSqlDraft).not.toHaveBeenCalled()
  })

  it('saves non-empty SQL as a native draft', async () => {
    const saved = draft()
    mocks.upsertSqlDraft.mockResolvedValue(saved)

    const result = await useSqlDraftStore.getState().saveTabDraft(tab({ sql: 'SELECT 1' }), {})

    expect(result).toEqual({ kind: 'saved', draft: saved })
    expect(useSqlDraftStore.getState().drafts).toEqual([saved])
  })

  it('deletes a saved draft after SQL is cleared without touching query history', async () => {
    const saved = draft()
    useSqlDraftStore.setState({ drafts: [saved] })
    mocks.deleteSqlDraft.mockResolvedValue(undefined)

    const result = await useSqlDraftStore.getState().saveTabDraft(tab({ draftId: saved.id, sql: ' \n ' }), {})

    expect(result).toEqual({ kind: 'cleared' })
    expect(mocks.deleteSqlDraft).toHaveBeenCalledWith(saved.id)
    expect(useSqlDraftStore.getState().drafts).toEqual([])
    expect(useQueryHistoryStore.getState().entries).toHaveLength(1)
    expect(useQueryHistoryStore.getState().entries[0]?.sql).toBe('SELECT 1')
  })

  it('reports deletion failure as incomplete persistence', async () => {
    const saved = draft()
    useSqlDraftStore.setState({ drafts: [saved] })
    mocks.deleteSqlDraft.mockRejectedValue(new Error('storage unavailable'))

    const result = await useSqlDraftStore.getState().saveTabDraft(tab({ draftId: saved.id }), {})

    expect(result).toBeNull()
    expect(useSqlDraftStore.getState().drafts).toEqual([saved])
    expect(mocks.notifyError).toHaveBeenCalled()
  })
})
