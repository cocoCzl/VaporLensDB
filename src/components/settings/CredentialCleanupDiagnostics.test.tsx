import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { listCredentialCleanup, retryCredentialCleanup } from '@/ipc/diagnostics'
import { copyToClipboard } from '@/lib/clipboard'
import { CredentialCleanupDiagnostics } from './CredentialCleanupDiagnostics'
vi.mock('@/ipc/diagnostics', () => ({ listCredentialCleanup: vi.fn(), retryCredentialCleanup: vi.fn() }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))
const pending = { connectionId: 'test-id', status: 'pending' as const, diagnostic: `Auth error: OSStatus details ${'long '.repeat(400)} (OSStatus -25244)`, credentialAccount: 'opaque-account', updatedAt: '2026-10-30T00:00:00Z' }
beforeEach(async () => { vi.resetAllMocks(); await i18n.changeLanguage('zh'); vi.mocked(listCredentialCleanup).mockResolvedValue([pending]) })
it('keeps long diagnostics collapsed, exposes copy and exact-item manual guidance, and retains failed retries', async () => {
  vi.mocked(retryCredentialCleanup).mockRejectedValue(new Error('blocked'))
  const { container } = render(<CredentialCleanupDiagnostics />)
  expect(await screen.findByText(i18n.t('credentialCleanup.pending'))).toBeVisible()
  expect(container.querySelector('details')).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText(i18n.t('credentialCleanup.viewDetails')))
  expect(screen.getByText(i18n.t('credentialCleanup.ownerError'))).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('credentialCleanup.copy') }))
  expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('account: opaque-account'))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('credentialCleanup.retry') }))
  await screen.findByRole('alert')
  expect(retryCredentialCleanup).toHaveBeenCalledExactlyOnceWith('test-id')
  expect(screen.getByText(i18n.t('credentialCleanup.pending'))).toBeVisible()
  expect(listCredentialCleanup).toHaveBeenCalledTimes(2)
})
it('shows confirmed completion after retry and loads it again on reopening diagnostics', async () => {
  vi.mocked(retryCredentialCleanup).mockResolvedValue(undefined)
  const { unmount } = render(<CredentialCleanupDiagnostics />)
  await screen.findByText(i18n.t('credentialCleanup.pending'))
  vi.mocked(listCredentialCleanup).mockResolvedValue([{ ...pending, status: 'cleaned', diagnostic: null, credentialAccount: null }])
  fireEvent.click(screen.getByRole('button', { name: i18n.t('credentialCleanup.retry') }))
  await screen.findByText(i18n.t('credentialCleanup.cleaned'))
  expect(screen.queryByRole('button', { name: i18n.t('credentialCleanup.retry') })).not.toBeInTheDocument()
  unmount(); render(<CredentialCleanupDiagnostics />)
  await waitFor(() => expect(screen.getByText(i18n.t('credentialCleanup.cleaned'))).toBeVisible())
})
