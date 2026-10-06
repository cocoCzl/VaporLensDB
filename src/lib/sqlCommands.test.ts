import { describe, expect, it } from 'vitest'
import { executionSql } from './sqlCommands'
const sql = 'SELECT 1;\nSELECT 2;'
describe('explicit execution scope', () => {
  it('uses selection before cursor, and all only when explicitly requested', () => {
    const scope = { start: 0, end: 8, cursor: 14 }
    expect(executionSql(sql, scope, 'current')).toBe('SELECT 1')
    expect(executionSql(sql, { start: 14, end: 14, cursor: 14 }, 'current')).toBe('SELECT 2')
    expect(executionSql(sql, scope, 'all')).toBe(sql)
  })
  it('never falls back to the script for empty or comment-only current scope', () => {
    expect(executionSql(';\nSELECT 2;', { start: 0, end: 0, cursor: 0 }, 'current')).toBe('')
    expect(executionSql('-- nothing\n; SELECT 2;', { start: 0, end: 0, cursor: 3 }, 'current')).toBe('')
    expect(executionSql('  SELECT 2;', { start: 0, end: 2, cursor: 2 }, 'current')).toBe('')
  })
})

import { act } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'
import { dispatchSqlCommand, registerSqlCommands, sqlCommandShortcut, EMPTY_CURSOR } from './sqlCommands'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
beforeEach(() => { useEditorStore.setState({ tabs: [{ id: 'A', title: 'SQL', sql: 'SELECT 1', connectionId: 'A' }, { id: 'settings', kind: 'settings', title: 'Settings', sql: '', connectionId: null }, { id: 'B', title: 'SQL', sql: 'SELECT 2', connectionId: 'B' }], activeTabId: 'A' }); useConnectionStore.setState({ browsingConnectionId: 'browse' }) })
describe('navigation, focus and context guards', () => {
  it('cycles SQL tabs only, wraps, and never changes browsing or transaction ownership', () => {
    dispatchSqlCommand('nextTab')
    expect(useEditorStore.getState().activeTabId).toBe('B')
    dispatchSqlCommand('nextTab')
    expect(useEditorStore.getState().activeTabId).toBe('A')
    dispatchSqlCommand('previousTab')
    expect(useEditorStore.getState().activeTabId).toBe('B')
    expect(useConnectionStore.getState().browsingConnectionId).toBe('browse')
  })
  it('focus commands use the active editor bridge; stale registration cannot target a different tab', () => {
    const focus = vi.fn()
    const run = vi.fn()
    const dispose = registerSqlCommands({ tabId: 'A', cursor: () => EMPTY_CURSOR, run, cancel: vi.fn(), format: vi.fn(), focus }, { focusEditor: true, focusResults: true, runCurrent: true })
    dispatchSqlCommand('focusEditor'); dispatchSqlCommand('focusResults')
    expect(focus.mock.calls).toEqual([['editor'], ['results']])
    useEditorStore.getState().setActiveTab('B')
    dispatchSqlCommand('runCurrent'); dispatchSqlCommand('focusEditor')
    expect(run).not.toHaveBeenCalled(); expect(focus).toHaveBeenCalledTimes(2)
    dispose()
  })
  it('reveals and focuses the Explorer without changing execution targets', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 0 })
    const aside = document.createElement('aside'); const input = document.createElement('input'); aside.append(input); document.body.append(aside)
    act(() => dispatchSqlCommand('focusExplorer'))
    expect(document.activeElement).toBe(input)
    expect(useUiStore.getState().sidebarCollapsed).toBe(false)
    expect(useEditorStore.getState().tabs[0].connectionId).toBe('A')
    aside.remove(); raf.mockRestore()
  })
  it('leaves Linux format and potentially conflicting navigation/cancel accelerators unbound', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    expect(sqlCommandShortcut('format')).toBeUndefined()
    for (const command of ['nextTab', 'previousTab', 'cancel', 'runAll', 'focusEditor'] as const) expect(sqlCommandShortcut(command)).toBeUndefined()
    platform.mockReturnValue('MacIntel'); expect(sqlCommandShortcut('format')).toBe('Shift Alt F')
    expect(sqlCommandShortcut('runCurrent')).toBe('⌘ Enter')
    platform.mockRestore()
  })
})
