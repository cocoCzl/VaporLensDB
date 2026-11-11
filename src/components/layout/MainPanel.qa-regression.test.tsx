import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MainPanel } from './MainPanel'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'

vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({ runQuery: vi.fn(), runExplain: vi.fn(), cancelRunningQuery: vi.fn() }) }))
vi.mock('@/components/editor/SqlEditor', () => ({ SqlEditor: () => <textarea aria-label="QA SQL" /> }))

beforeEach(() => {
  useConnectionStore.setState({ connections: [{ id: 'qa-mysql', name: 'QA MySQL', driverType: 'mysql', connectionUrl: 'mysql://127.0.0.1:3306/' }], capabilities: {}, statuses: { 'qa-mysql': { connectionId: 'qa-mysql', status: 'connected' } } })
  useEditorStore.setState({ activeTabId: 'qa-tab', tabs: [{ id: 'qa-tab', kind: 'sql', title: 'QA', connectionId: 'qa-mysql', database: null, schema: null, sql: 'SELECT DATABASE()' }] })
  for (const method of ['loadDatabases', 'loadTables', 'loadViews', 'loadFunctions'] as const) vi.spyOn(useMetadataStore.getState(), method).mockResolvedValue([])
})

it('does not label a server-level MySQL result with the first unrelated catalog schema', async () => {
  const load = vi.spyOn(useMetadataStore.getState(), 'loadSchemas').mockResolvedValue([{ name: 'qa_unselected_database' }])
  await act(async () => { render(<MainPanel />) })
  await waitFor(() => expect(load).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  expect(useEditorStore.getState().tabs[0].database).toBeNull()
  expect(useEditorStore.getState().tabs[0].schema).toBeNull()
})

import { fireEvent, screen } from '@testing-library/react'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { exportQueryCsv, exportQueryResultCsv } from '@/ipc/export'
import i18n from '@/i18n'
vi.mock('@tauri-apps/api/path', () => ({ downloadDir: async () => '/qa-exports', join: async (...parts: string[]) => parts.join('/') }))
vi.mock('@/ipc/export', () => ({ exportQueryCsv: vi.fn(), exportQueryResultCsv: vi.fn(), exportTableCsv: vi.fn() }))

it('exports historical SQL and rows from their captured source after the visible target changes', async () => {
  await i18n.changeLanguage('en')
  const rows = { columns: [{ name: 'marker', dataType: 'TEXT', nullable: false }], rows: [['original']], rowCount: 1, affectedRows: 0, elapsedMs: 1, truncated: false }
  const source = { queryId: 'old-query', sql: "SELECT 'original'; /* tail */", connectionId: 'old-connection', connectionName: 'Executed source', connectionGeneration: 7, database: 'old-db', schema: null, consoleId: 'old-console', transactionMode: 'manual' as const, executedAt: '2026-11-09T00:00:00Z' }
  useQueryResultStore.setState({ results: { 'old-query': [rows] }, sources: { 'old-query': source }, explains: {}, reports: {} })
  useEditorStore.setState({ tabs: [{ ...useEditorStore.getState().tabs[0], database: 'current-db', lastQueryId: 'old-query' }] })
  const task = { id: 'export-old', kind: 'export.csv.query', title: 'QA', status: 'pending' as const, progress: { current: 0 }, logs: [], createdAt: source.executedAt, updatedAt: source.executedAt }
  vi.mocked(exportQueryCsv).mockResolvedValue(task)
  vi.mocked(exportQueryResultCsv).mockResolvedValue(task)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<MainPanel />)
  expect(screen.getByText(/Executed source.*old-db/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('workbench.exportAllRows') }))
  await waitFor(() => expect(exportQueryCsv).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'old-connection', connectionGeneration: 7, sql: source.sql, database: 'old-db', schema: null, consoleId: 'old-console' })))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('workbench.exportCsv') }))
  await waitFor(() => expect(exportQueryResultCsv).toHaveBeenCalledWith(expect.objectContaining({ result: rows })))
  expect(useQueryResultStore.getState().sources['old-query']).toEqual(source)
})


it('keeps MySQL JDBC execution schema empty even when generic JDBC advertises schemas', async () => {
  useConnectionStore.setState({
    connections: [{ id: 'qa-mysql', name: 'QA MySQL JDBC', driverType: 'jdbc', driverDialect: 'mysql', driverDefinitionId: 'jdbc-mysql' }],
    capabilities: { 'qa-mysql': { hasDatabase: true, hasSchema: true, supportsTransactions: true, supportsExplain: false, supportsCancel: true, supportsDdl: false, supportsTableDdl: false, supportsStreaming: true } },
  })
  const load = vi.spyOn(useMetadataStore.getState(), 'loadSchemas').mockResolvedValue([{ name: 'qa_unselected_database' }])
  await act(async () => { render(<MainPanel />) })
  await waitFor(() => expect(load).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  expect(useEditorStore.getState().tabs[0].database).toBeNull()
  expect(useEditorStore.getState().tabs[0].schema).toBeNull()
})


it('does not present a restored MySQL JDBC catalog as an execution schema', async () => {
  useConnectionStore.setState({
    connections: [{ id: 'qa-mysql', name: 'QA MySQL JDBC', driverType: 'jdbc', driverDialect: 'mysql', driverDefinitionId: 'jdbc-mysql' }],
    capabilities: { 'qa-mysql': { hasDatabase: true, hasSchema: true, supportsTransactions: true, supportsExplain: false, supportsCancel: true, supportsDdl: false, supportsTableDdl: false, supportsStreaming: true } },
  })
  useEditorStore.setState({ tabs: [{ ...useEditorStore.getState().tabs[0], schema: 'qa_stale_catalog' }] })
  vi.spyOn(useMetadataStore.getState(), 'loadSchemas').mockResolvedValue([])
  await act(async () => { render(<MainPanel />) })
  expect(screen.getByLabelText(i18n.t('executionContext.title'))).not.toHaveTextContent('qa_stale_catalog')
  expect(screen.queryByRole('combobox', { name: i18n.t('metadata.schema') })).not.toBeInTheDocument()
})
