import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MainPanel } from './MainPanel'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import i18n from '@/i18n'

const ipc = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({ runQuery: ipc.run, runExplain: vi.fn(), cancelRunningQuery: vi.fn() }) }))

const current = () => useEditorStore.getState().tabs[0]
const result = {
  columns: [{ name: 'id', dataType: 'INTEGER', nullable: false }],
  rows: [[3], [2], [1]], rowCount: 3, elapsedMs: 1, affectedRows: 0, truncated: false,
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  useConnectionStore.setState({ connections: [{ id: 'c', name: 'Preview fixture', driverType: 'sqlite' }], statuses: { c: { connectionId: 'c', status: 'connected' } } })
  useQueryResultStore.setState({ results: { initial: [result] }, sources: {}, explains: {} })
  useEditorStore.setState({ activeTabId: 'preview', tabs: [{ id: 'preview', connectionId: 'c', kind: 'data', title: 'Preview', sql: '', lastQueryId: 'initial', dataContext: { schema: 'main', object: 'fixture', objectKind: 'table', driverType: 'sqlite', limit: 2, offset: 0, primaryKeyColumns: ['id'] } }] })
  ipc.run.mockImplementation(() => {
    const queryId = `pending-${ipc.run.mock.calls.length}`
    useQueryResultStore.getState().startStreamResult(queryId)
    useEditorStore.setState(state => ({ tabs: state.tabs.map(tab => ({ ...tab, lastQueryId: queryId, running: true })) }))
  })
})

it('keeps the chosen sort while replacement rows are loading and uses it on the next page', async () => {
  render(<MainPanel />)
  const sort = screen.getByRole('combobox')
  fireEvent.click(sort)
  const option = await screen.findByRole('option', { name: 'id' })
  fireEvent.pointerDown(option, { pointerType: 'mouse' })
  fireEvent.mouseUp(option)
  fireEvent.click(option)
  await waitFor(() => expect(ipc.run).toHaveBeenCalled())
  expect(current().dataContext?.sortColumn).toBe('id')
  expect(sort).toHaveTextContent('id')
  expect(ipc.run).toHaveBeenCalledOnce()

  act(() => {
    useQueryResultStore.getState().setResults(current().lastQueryId!, [result])
    useEditorStore.setState(state => ({ tabs: state.tabs.map(tab => ({ ...tab, running: false })) }))
  })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('workbench.toggleSortDirection') }))
  await waitFor(() => expect(current().dataContext?.sortDirection).toBe('desc'))
  expect(current().sql).toContain('ORDER BY "id" DESC')
  expect(sort).toHaveTextContent('id')
  act(() => {
    useQueryResultStore.getState().setResults(current().lastQueryId!, [result])
    useEditorStore.setState(state => ({ tabs: state.tabs.map(tab => ({ ...tab, running: false })) }))
  })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('workbench.nextPage') }))
  expect(current().sql).toContain('ORDER BY "id" DESC')
  expect(current().sql).toContain('OFFSET 2')
})
