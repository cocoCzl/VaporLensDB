import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestApplicationClose } from './applicationClose'
import { closeEditorTab } from './closeEditorTab'
import { useEditorStore } from '@/stores/editorStore'
const mocks = vi.hoisted(() => ({ choice: vi.fn(), save: vi.fn(), shutdown: vi.fn() }))
vi.mock('@/ipc/lifecycle', () => ({ shutdownApplication: mocks.shutdown }))
vi.mock('./sqlFileChoice', () => ({ chooseSqlFileAction: mocks.choice }))
vi.mock('./sqlFileWorkflow', () => ({ saveSqlFile: mocks.save }))
beforeEach(() => { vi.resetAllMocks(); useEditorStore.setState({ tabs: [{ id: 'file', title: 'file.sql', sql: 'unsaved', connectionId: null, filePath: '/selected/file.sql', dirty: true }], activeTabId: 'file' }) })
describe('close dirty SQL file', () => {
  it.each([['save', true, true], ['save', false, false], ['discard', false, true], ['cancel', false, false]] as const)('%s with save result %s closes=%s', async (choice, saved, closed) => {
    mocks.choice.mockResolvedValue(choice); mocks.save.mockResolvedValue(saved)
    expect(await closeEditorTab('file')).toBe(closed)
    expect(useEditorStore.getState().tabs).toHaveLength(closed ? 0 : 1)
    expect(mocks.save).toHaveBeenCalledTimes(choice === 'save' ? 1 : 0)
  })
  it('Quit cannot bypass per-file choices or shut down after a cancelled file close', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useEditorStore.setState((state) => ({ tabs: [...state.tabs, { ...state.tabs[0], id: 'second', filePath: '/selected/second.sql' }] }))
    mocks.choice.mockResolvedValueOnce('discard').mockResolvedValueOnce('cancel')
    expect(await requestApplicationClose()).toBe(false)
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(useEditorStore.getState().tabs[0].id).toBe('second')
    expect(window.confirm).toHaveBeenCalled()
  })

})
