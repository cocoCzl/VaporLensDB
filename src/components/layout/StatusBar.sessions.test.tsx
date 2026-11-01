import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import i18n from '@/i18n'
import { useMetadataStore } from '@/stores/metadataStore'

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

it('shows the active object tab context even when browsing points elsewhere', async () => {
  await i18n.changeLanguage('en')
  useConnectionStore.setState({
    connections: [
      { id: 'mysql', name: 'MySQL QA', driverType: 'mysql' },
      { id: 'other', name: 'Other QA', driverType: 'postgres' },
    ],
    browsingConnectionId: 'other', statuses: {},
  })
  useMetadataStore.setState({ catalogSchemaPaths: {
    mysql: { connectionId: 'mysql', database: 'information_schema', schema: 'wrong_schema', schemaListAvailable: true },
    other: { connectionId: 'other', database: 'other_db', schema: 'public', schemaListAvailable: true },
  } })
  useEditorStore.setState({ activeTabId: 'structure', tabs: [{
    id: 'structure', kind: 'structure', title: 'CHARACTER_SETS', sql: '', connectionId: 'mysql',
    structureContext: { database: 'information_schema', schema: 'information_schema', object: 'CHARACTER_SETS', objectKind: 'view' },
  }, {
    id: 'sql', kind: 'sql', title: 'SQL', sql: '', connectionId: 'other', database: 'other_db', schema: 'query_schema',
  }] })
  render(<StatusBar backendStatus="ok:test" />)
  expect(screen.getByText('MySQL QA')).toBeVisible()
  expect(screen.getByText('information_schema / information_schema')).toBeVisible()
  expect(screen.queryByText(/wrong_schema/)).not.toBeInTheDocument()
  act(() => useEditorStore.setState({ activeTabId: 'sql' }))
  expect(screen.getByText('Other QA')).toBeVisible()
  expect(screen.getByText('other_db / query_schema')).toBeVisible()
})
