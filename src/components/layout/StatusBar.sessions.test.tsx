import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import i18n from '@/i18n'

vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({ cancelRunningQuery: vi.fn() }) }))
it('counts only connected sessions across failure, retry, success, disconnect and restart', async () => {
  await i18n.changeLanguage('en')
  useEditorStore.setState({ tabs: [], activeTabId: null })
  useConnectionStore.setState({ connections: [{ id: 'c', name: 'Oracle fixture', driverType: 'oracle' }], statuses: {} })
  render(<StatusBar backendStatus="ok:test" />)
  for (const [status, count] of [['connecting', 0], ['failed', 0], ['connecting', 0], ['connected', 1], ['disconnected', 0]] as const) {
    act(() => useConnectionStore.setState({ statuses: { c: { connectionId: 'c', status } } }))
    expect(screen.getByRole('button', { name: new RegExp(`Sessions ${count}`) })).toBeVisible()
  }
  act(() => useConnectionStore.setState({ statuses: {} }))
  expect(screen.getByRole('button', { name: /Sessions 0/ })).toBeVisible()
})
