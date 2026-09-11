import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from '@/components/layout/TabBar'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({
  closeTab: vi.fn(),
  markClosed: vi.fn(),
  saveTabDraft: vi.fn(),
  setActiveConnection: vi.fn(),
  setActiveTab: vi.fn(),
}))

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    tabs: [{
      id: 'sql-1',
      kind: 'sql',
      title: 'SQL 1',
      sql: '',
      connectionId: null,
      draftId: null,
      transactionMode: 'auto',
      transactionPhase: 'idle',
    }],
    activeTabId: 'sql-1',
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
      value: vi.fn(),
    })
    mocks.closeTab.mockClear()
    mocks.setActiveTab.mockClear()
  })

  it('renders a sibling close button that closes without activating the tab', () => {
    render(<TabBar />)

    const closeButton = screen.getByRole('button', { name: 'Close tab' })
    expect(closeButton.closest('button')).toBe(closeButton)

    fireEvent.click(closeButton)

    expect(mocks.closeTab).toHaveBeenCalledWith('sql-1')
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })
})
