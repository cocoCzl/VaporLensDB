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
import { useEditorStore, type EditorTab } from '@/stores/editorStore'
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
    useEditorStore.setState({ tabs: [tab({})], activeTabId: null })
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

  it('reuses the first native ID for overlapping initial saves', async () => {
    let finish!: (value: SqlDraft) => void
    mocks.upsertSqlDraft.mockImplementationOnce(() => new Promise<SqlDraft>((resolve) => { finish = resolve }))
    mocks.upsertSqlDraft.mockResolvedValue(draft())
    const first = useSqlDraftStore.getState().saveTabDraft(tab({ sql: 'SELECT 1' }), {})
    const second = useSqlDraftStore.getState().saveTabDraft(tab({ sql: 'SELECT 2' }), {})
    await vi.waitFor(() => expect(mocks.upsertSqlDraft).toHaveBeenCalledTimes(1))
    finish(draft())
    await Promise.all([first, second])
    expect(mocks.upsertSqlDraft.mock.calls[1][0]).toMatchObject({ id: 'draft-1', sql: 'SELECT 2' })
  })

  it('keeps edits made during a save dirty and persists them using the returned ID', async () => {
    let finish!: (value: SqlDraft) => void
    mocks.upsertSqlDraft.mockImplementationOnce(() => new Promise<SqlDraft>((resolve) => { finish = resolve }))
    const original = tab({ sql: 'SELECT 1' })
    useEditorStore.setState({ tabs: [original] })
    const saving = useSqlDraftStore.getState().saveTabDraft(original, {})
    await vi.waitFor(() => expect(mocks.upsertSqlDraft).toHaveBeenCalledTimes(1))
    useEditorStore.getState().updateTabSql(original.id, 'SELECT 2')
    finish(draft())
    await saving
    const current = useEditorStore.getState().tabs[0]
    expect(current).toMatchObject({ sql: 'SELECT 2', dirty: true, draftId: 'draft-1' })
    mocks.upsertSqlDraft.mockResolvedValue({ ...draft(), sql: 'SELECT 2' })
    await useSqlDraftStore.getState().saveTabDraft(current, {})
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
    expect(mocks.upsertSqlDraft.mock.calls[1][0].id).toBe('draft-1')
  })

  it('deletes an initially pending save when the following snapshot is empty', async () => {
    mocks.upsertSqlDraft.mockResolvedValue(draft())
    mocks.deleteSqlDraft.mockResolvedValue(undefined)
    const first = useSqlDraftStore.getState().saveTabDraft(tab({ sql: 'SELECT 1' }), {})
    const cleared = useSqlDraftStore.getState().saveTabDraft(tab({ sql: '' }), {})
    await Promise.all([first, cleared])
    expect(mocks.deleteSqlDraft).toHaveBeenCalledWith('draft-1')
    expect(useSqlDraftStore.getState().drafts).toEqual([])
  })

  it.each(['clear', 'removeDraft'] as const)('orders %s after an in-flight save', async (operation) => {
    let finish!: (value: SqlDraft) => void
    mocks.upsertSqlDraft.mockImplementationOnce(() => new Promise<SqlDraft>((resolve) => { finish = resolve }))
    mocks.deleteSqlDraft.mockResolvedValue(undefined)
    mocks.clearSqlDrafts.mockResolvedValue(undefined)
    const saving = useSqlDraftStore.getState().saveTabDraft(tab({ sql: 'SELECT 1' }), {})
    const removing = operation === 'clear'
      ? useSqlDraftStore.getState().clear()
      : useSqlDraftStore.getState().removeDraft('draft-1')
    await vi.waitFor(() => expect(mocks.upsertSqlDraft).toHaveBeenCalledTimes(1))
    expect(mocks.deleteSqlDraft).not.toHaveBeenCalled()
    expect(mocks.clearSqlDrafts).not.toHaveBeenCalled()
    finish(draft())
    await Promise.all([saving, removing])
    expect(useSqlDraftStore.getState().drafts).toEqual([])
  })

  it('rejects an old snapshot queued after the editor has advanced', async () => {
    const original = tab({ sql: 'SELECT 1' })
    useEditorStore.setState({ tabs: [original] })
    useEditorStore.getState().updateTabSql(original.id, 'SELECT 2')
    expect(await useSqlDraftStore.getState().saveTabDraft(original, {})).toBeNull()
    expect(mocks.upsertSqlDraft).not.toHaveBeenCalled()
  })

  it('skips autosaves captured before a tab closed', async () => {
    const snapshot = tab({ sql: 'SELECT 1' })
    useEditorStore.getState().closeTab(snapshot.id)
    expect(await useSqlDraftStore.getState().saveTabDraft(snapshot, {})).toBeNull()
    expect(mocks.upsertSqlDraft).not.toHaveBeenCalled()
  })

  it('skips queued autosaves during close but accepts the final closed save', async () => {
    const snapshot = tab({ sql: 'SELECT 1' })
    const autosave = useSqlDraftStore.getState().saveTabDraft(snapshot, {})
    useEditorStore.getState().setTabClosing(snapshot.id, true)
    expect(await autosave).toBeNull()
    mocks.upsertSqlDraft.mockResolvedValue(draft())
    expect(await useSqlDraftStore.getState().saveTabDraft(snapshot, {}, true)).toMatchObject({ kind: 'saved' })
    expect(mocks.upsertSqlDraft).toHaveBeenCalledOnce()
    expect(mocks.upsertSqlDraft.mock.calls[0][0].closed).toBe(true)
  })

  it('allows saves after a failed clear instead of poisoning the queue', async () => {
    mocks.clearSqlDrafts.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(useSqlDraftStore.getState().clear()).rejects.toThrow('storage unavailable')
    mocks.upsertSqlDraft.mockResolvedValue(draft())
    expect(await useSqlDraftStore.getState().saveTabDraft(tab({ sql: 'SELECT 1' }), {}))
      .toEqual({ kind: 'saved', draft: draft() })
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
