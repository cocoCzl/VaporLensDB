import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { SettingsWorkspacePanel } from './SettingsWorkspacePanel'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'

vi.mock('@/ipc/health', () => ({ healthCheck: vi.fn(async () => null) }))
vi.mock('./CredentialCleanupDiagnostics', () => ({ CredentialCleanupDiagnostics: () => null }))
const clearHistory = vi.fn()
beforeEach(async () => {
  await i18n.changeLanguage('en')
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useUiStore.setState({ settingsSection: 'general' })
  useQueryHistoryStore.setState({ entries: [], loading: false, loadHistory: vi.fn(async () => {}), clear: clearHistory })
})

describe('settings workspace navigation', () => {
  it('keeps navigation outside the scrollable content and exposes narrow navigation', () => {
    const { container } = render(<SettingsWorkspacePanel />)
    const nav = screen.getByRole('navigation', { name: i18n.t('settings.title') })
    const content = screen.getByRole('region', { name: i18n.t('settings.content') })
    expect(content).not.toContainElement(nav)
    expect(content).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(container.querySelector('[data-settings-workspace]')).toHaveClass('overflow-hidden', 'h-full')
    expect(nav).toHaveClass('overflow-y-auto')
    expect(screen.getByRole('combobox', { name: i18n.t('settings.sections') })).toBeInTheDocument()
    fireEvent.scroll(content, { target: { scrollTop: 1000 } })
    expect(nav).toBeInTheDocument()
    expect(content).toHaveAttribute('tabindex', '0')
  })

  it('redirects the legacy driver section to a standalone tab without applying preferences', async () => {
    useUiStore.setState({ settingsSection: 'drivers' })
    const theme = useUiStore.getState().theme
    render(<SettingsWorkspacePanel />)
    await waitFor(() => expect(useEditorStore.getState().tabs).toEqual([expect.objectContaining({ kind: 'drivers', connectionId: null })]))
    expect(useUiStore.getState().settingsSection).toBe('general')
    expect(useUiStore.getState().theme).toBe(theme)
  })

  it('opens drivers from the compatibility link without embedding the manager', () => {
    render(<SettingsWorkspacePanel />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('drivers.title')) }))
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ kind: 'drivers' })
    expect(useUiStore.getState().settingsSection).toBe('general')
  })
})
