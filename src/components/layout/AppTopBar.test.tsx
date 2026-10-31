import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useEditorStore } from '@/stores/editorStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
import { requestNewConnection } from '@/lib/workspaceNavigation'
import { AppTopBar } from './AppTopBar'
import { TabBar } from './TabBar'

vi.mock('@/components/connection/ConnectionDialog', () => ({
  ConnectionDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => open
    ? <div role="dialog"><button onClick={() => onOpenChange(false)}>Close fixture dialog</button></div> : null,
}))

const connect = vi.fn()
beforeEach(async () => {
  await i18n.changeLanguage('en')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useConnectionStore.setState({ connections: [], browsingConnectionId: null, statuses: {}, connectConnection: connect })
  useUiStore.setState({ sidebarCollapsed: false, settingsSection: 'general' })
  vi.clearAllMocks()
})

describe('global navigation', () => {
  it('opens one existing workflow from both the top bar and explorer action, restoring focus', async () => {
    render(<><AppTopBar /><button onClick={requestNewConnection}>Explorer fixture entry</button></>)
    for (const name of [i18n.t('connection.new'), 'Explorer fixture entry']) {
      const trigger = screen.getByRole('button', { name })
      trigger.focus()
      fireEvent.click(trigger)
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      fireEvent.click(screen.getByText('Close fixture dialog'))
      await waitFor(() => expect(trigger).toHaveFocus())
    }
    expect(connect).not.toHaveBeenCalled()
  })

  it('reuses a connection-free driver workspace and translates its entry', async () => {
    render(<AppTopBar />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('topBar.drivers') }))
    const first = useEditorStore.getState().activeTabId
    fireEvent.click(screen.getByRole('button', { name: i18n.t('topBar.drivers') }))
    expect(useEditorStore.getState().tabs).toEqual([expect.objectContaining({ id: first, kind: 'drivers', connectionId: null })])
    await act(() => i18n.changeLanguage('zh'))
    expect(screen.getByRole('button', { name: i18n.t('topBar.drivers') })).toBeInTheDocument()
    expect(connect).not.toHaveBeenCalled()
  })

  it('updates the driver tab and overflow menu after switching languages', async () => {
    render(<><AppTopBar /><TabBar /></>)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('topBar.drivers') }))
    await act(() => i18n.changeLanguage('zh'))
    expect(screen.getAllByRole('button', { name: i18n.t('topBar.drivers') })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('sql.allTabs') }))
    expect(screen.getByRole('menuitem', { name: i18n.t('topBar.drivers') })).toBeInTheDocument()
  })

  it.each([
    ['dbeaver.title', 'settings', 'import'],
    ['sql.history', 'queryHistory', 'general'],
    ['settings.diagnostics.title', 'settings', 'diagnostics'],
  ])('routes More → %s to the existing workspace', async (key, kind, section) => {
    render(<AppTopBar />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('topBar.more') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t(key) }))
    expect(useEditorStore.getState().tabs).toEqual([expect.objectContaining({ kind, connectionId: null })])
    expect(useUiStore.getState().settingsSection).toBe(section)
    expect(connect).not.toHaveBeenCalled()
  })

  it('returns Home without closing the current SQL tab', async () => {
    const tab = { id: 'sql-fixture', kind: 'sql' as const, title: 'SQL', sql: 'select 1', connectionId: null }
    useEditorStore.setState({ tabs: [tab], activeTabId: tab.id })
    render(<AppTopBar />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('topBar.workspaces') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('topBar.home') }))
    expect(useEditorStore.getState().activeTabId).toBeNull()
    expect(useEditorStore.getState().tabs).toEqual([tab])
  })
})
