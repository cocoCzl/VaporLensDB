import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useUiStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'
import { NotificationBridge } from './NotificationBridge'

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  useUiStore.setState({ notifications: [], settingsSection: 'general', resolvedTheme: 'light' })
  useEditorStore.setState({ tabs: [], activeTabId: null })
})
afterEach(() => { toast.dismiss() })

it('keeps cleanup warnings brief and routes details to existing diagnostics without clearing backend state', async () => {
  const { container } = render(<NotificationBridge />)
  act(() => useUiStore.getState().notify({ kind: 'warning', title: i18n.t('credentialCleanup.pending'), action: 'credentialCleanup' }))
  expect(await screen.findByText(i18n.t('credentialCleanup.pending'))).toBeVisible()
  expect(container.querySelector('[data-sonner-toaster]')).toBeNull()
  expect(document.body.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'bottom')
  expect(screen.queryByText(/OSStatus|connection UUID/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('credentialCleanup.viewDetails') }))
  expect(useUiStore.getState().settingsSection).toBe('diagnostics')
  expect(useEditorStore.getState().tabs.filter(tab => tab.kind === 'settings')).toHaveLength(1)
  await waitFor(() => expect(useUiStore.getState().notifications).toEqual([]))
})

it('uses distinct toast IDs for consecutive notifications and follows the current theme', async () => {
  render(<NotificationBridge />)
  act(() => {
    useUiStore.setState({ resolvedTheme: 'dark' })
    for (let n = 0; n < 4; n++) useUiStore.getState().notify({ kind: 'warning', title: `warning ${n}` })
  })
  await screen.findByText('warning 3')
  expect(document.body.querySelector('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'dark')
  expect(new Set([...document.body.querySelectorAll('[data-sonner-toast]')].map(el => el.getAttribute('data-index'))).size).toBeGreaterThanOrEqual(4)
})
