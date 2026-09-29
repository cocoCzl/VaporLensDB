import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from '@/components/layout/TabBar'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({
  closeTab: vi.fn(),
  closeTabs: vi.fn(),
  activeTabId: 'sql-1',
  markClosed: vi.fn(),
  saveTabDraft: vi.fn(),
  setActiveConnection: vi.fn(),
  setActiveTab: vi.fn(),
  scrollIntoView: vi.fn(),
  tabs: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/closeEditorTab', () => ({
  closeEditorTab: mocks.closeTab,
  closeEditorTabs: mocks.closeTabs,
}))

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    tabs: mocks.tabs,
    activeTabId: mocks.activeTabId,
    closeTab: mocks.closeTab,
    renameTab: vi.fn(),
    setTabDraft: vi.fn(),
    setActiveTab: mocks.setActiveTab,
    toggleTabPinned: vi.fn(),
  }),
}))

vi.mock('@/stores/connectionStore', () => ({
  useConnectionStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    connections: [],
    statuses: {},
    setActiveConnection: mocks.setActiveConnection,
  }),
}))

vi.mock('@/stores/sqlDraftStore', () => ({
  useSqlDraftStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    markClosed: mocks.markClosed,
    saveTabDraft: mocks.saveTabDraft,
  }),
}))

vi.mock('@/ipc/query', () => ({
  rollbackConsoleTransaction: vi.fn(),
  setConsoleTransactionMode: vi.fn(),
}))

vi.mock('@/components/common/IconTooltipButton', () => ({
  IconTooltipButton: ({ label, children, ...props }: { label: string; children: ReactNode }) => <button type="button" aria-label={label} {...props}>{children}</button>,
}))

describe('TabBar close control', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: mocks.scrollIntoView,
    })
    mocks.closeTab.mockClear()
    mocks.closeTabs.mockClear()
    mocks.activeTabId = 'sql-1'
    mocks.setActiveTab.mockClear()
    mocks.scrollIntoView.mockClear()
    mocks.saveTabDraft.mockResolvedValue({ kind: 'cleared' })
    mocks.tabs = [{
      id: 'sql-1',
      kind: 'sql',
      title: 'SQL 1',
      sql: '',
      connectionId: null,
      draftId: null,
      transactionMode: 'auto',
      transactionPhase: 'idle',
    }]
  })

  it('renders a sibling close button that closes without activating the tab', () => {
    render(<TabBar />)

    const closeButton = screen.getByRole('button', { name: 'Close tab' })
    expect(closeButton.closest('button')).toBe(closeButton)

    fireEvent.click(closeButton)

    expect(mocks.closeTab).toHaveBeenCalledWith('sql-1')
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('keeps a context-menu action mounted through mousedown and closes all tabs', async () => {
    mocks.tabs = [
      ...mocks.tabs,
      {
        id: 'sql-2',
        kind: 'sql',
        title: 'SQL 2',
        sql: '',
        connectionId: null,
        draftId: null,
        transactionMode: 'auto',
        transactionPhase: 'idle',
      },
    ]
    render(<TabBar />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'SQL 1' }), { clientX: 12, clientY: 12 })
    const closeAll = screen.getByRole('menuitem', { name: 'Close all tabs' })
    fireEvent.mouseDown(closeAll)
    fireEvent.click(closeAll)

    await Promise.resolve()
    expect(mocks.closeTabs).toHaveBeenCalledWith(['sql-1', 'sql-2'])
  })

  it('keeps a single management tab compact', () => {
    mocks.activeTabId = 'settings-1'
    mocks.tabs = [{ id: 'settings-1', kind: 'settings', title: 'Settings' }]

    render(<TabBar />)

    const managementTab = screen.getByText('Settings').closest('button')?.parentElement
    expect(managementTab).toHaveClass('h-9', 'min-w-24', 'max-w-48', 'bg-surface')
    expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(1)
  })

  it('keeps compact content-sized tabs and preserves overflow adornments', () => {
    const longTitle = 'SQL · QA PostgreSQL Cancel with a deliberately long workspace title'
    mocks.tabs = [
      {
        ...mocks.tabs[0],
        title: longTitle,
        dirty: true,
        pinned: true,
      },
      {
        id: 'settings-1',
        kind: 'settings',
        title: 'Settings',
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `sql-${index + 2}`,
        kind: 'sql',
        title: `SQL ${index + 2}`,
        sql: '',
        connectionId: null,
        draftId: null,
        transactionMode: 'auto',
        transactionPhase: 'idle',
      })),
    ]

    const { container, rerender } = render(<TabBar />)

    expect(container.querySelector('.ide-tab-strip')).toHaveClass('h-9')
    expect(container.querySelector('.tab-strip-scroll')).toHaveClass('overflow-x-auto')

    const activeButton = screen.getByText(longTitle).closest('button')
    const activeTab = activeButton?.parentElement
    expect(activeTab).toHaveClass('h-9', 'min-w-24', 'max-w-48', 'border-border/25', 'bg-surface')
    expect(screen.getByText(longTitle)).toHaveClass('truncate')
    expect(activeTab?.querySelector('.lucide-pin')).not.toBeNull()
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument()

    const managementTab = screen.getByText('Settings').closest('button')?.parentElement
    expect(managementTab).toHaveClass('min-w-24', 'max-w-48', 'text-muted-foreground')
    expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(5)
    expect(mocks.scrollIntoView).toHaveBeenCalled()

    mocks.tabs = [
      ...mocks.tabs,
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `overflow-sql-${index + 1}`,
        kind: 'sql',
        title: `Overflow SQL ${index + 1}`,
        sql: '',
        connectionId: null,
        draftId: null,
        transactionMode: 'auto',
        transactionPhase: 'idle',
      })),
    ]
    rerender(<TabBar />)

    expect(screen.getAllByRole('button', { name: 'Close tab' })).toHaveLength(12)
  })
})
