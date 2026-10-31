import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { MainPanel } from './MainPanel'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import i18n from '@/i18n'

const ipc = vi.hoisted(() => ({ ddl: vi.fn(), run: vi.fn() }))
vi.mock('@/ipc/metadata', async original => ({ ...await original<typeof import('@/ipc/metadata')>(), getTableDdl: ipc.ddl }))
vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({ runQuery: ipc.run, runExplain: vi.fn(), cancelRunningQuery: vi.fn() }) }))
vi.mock('@/components/editor/SqlEditor', () => ({ SqlEditor: ({ value }: { value: string }) => <textarea aria-label="SQL editor" readOnly value={value} /> }))
const unsupported = { code: 'UNSUPPORTED_OPERATION', message: 'Unsupported operation: get_table_ddl on jdbc' }

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  useConnectionStore.setState({ connections: [{ id: 'c', name: 'Fixture', driverType: 'sqlite' }], statuses: {}, capabilities: {} })
  for (const key of ['loadColumns', 'loadIndexes', 'loadForeignKeys'] as const) vi.spyOn(useMetadataStore.getState(), key).mockResolvedValue([])
  ipc.ddl.mockResolvedValue('CREATE TABLE "\u771f\u5b9e\u8868" ("\u7f16\u53f7" INTEGER PRIMARY KEY)')
  useEditorStore.setState({ tabs: [{ id: 't', connectionId: 'c', kind: 'structure', title: 'Structure', sql: '', structureContext: { schema: 'main', object: '\u771f\u5b9e\u8868', objectKind: 'table' } }], activeTabId: 't' })
})
afterEach(() => vi.restoreAllMocks())

it('renders columns and indexes when JDBC DDL is unsupported, with a usable SQL entry', async () => {
  ipc.ddl.mockRejectedValue(unsupported)
  vi.mocked(useMetadataStore.getState().loadColumns).mockResolvedValue([{ table: '\u771f\u5b9e\u8868', name: '\u7f16\u53f7', ordinalPosition: 1, dataType: 'INTEGER', nullable: false, isPrimaryKey: true, isGenerated: false, isIdentity: false, isAutoIncrement: false }])
  vi.mocked(useMetadataStore.getState().loadIndexes).mockResolvedValue([{ table: '\u771f\u5b9e\u8868', name: 'real_index', columns: ['\u7f16\u53f7'], unique: true }])
  render(<MainPanel />)
  expect(await screen.findByText('\u7f16\u53f7')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Indexes' }))
  expect(screen.getByText('real_index')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'DDL' }))
  expect(screen.getByText(i18n.t('workbench.jdbcDdlUnsupported'))).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Open in SQL Tab' }))
  expect(useEditorStore.getState().tabs.at(-1)).toMatchObject({ kind: 'sql', sql: '', connectionId: 'c', schema: 'main' })
})

it('uses runtime capability to skip DDL and isolates an indexes failure from columns', async () => {
  useConnectionStore.setState({ capabilities: { c: { hasDatabase: true, hasSchema: true, supportsTransactions: true, supportsExplain: false, supportsCancel: true, supportsDdl: false, supportsTableDdl: false, supportsStreaming: true } } })
  vi.mocked(useMetadataStore.getState().loadIndexes).mockRejectedValue({ code: 'UNSUPPORTED_OPERATION', message: 'indexes unsupported' })
  render(<MainPanel />)
  await act(async () => {})
  expect(ipc.ddl).not.toHaveBeenCalled()
  expect(screen.getByText(i18n.t('workbench.noColumns'))).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Indexes' }))
  expect(screen.getByText(i18n.t('workbench.metadataUnsupported'))).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Foreign Keys' }))
  expect(screen.getByText(i18n.t('workbench.noForeignKeys'))).toBeVisible()
})

it('binds genuine asynchronous DDL, refreshes it, and opens the same text in SQL', async () => {
  useEditorStore.setState({ tabs: [{ id: 't', connectionId: 'c', kind: 'definition', title: 'DDL', sql: '', definitionContext: { schema: 'main', object: '\u771f\u5b9e\u8868', objectKind: 'table', definitionKind: 'DDL', operation: 'tableDdl' } }] })
  render(<MainPanel />)
  expect(await screen.findByRole('textbox', { name: i18n.t('workbench.readOnlyDdlAria') })).toHaveValue('CREATE TABLE "\u771f\u5b9e\u8868" ("\u7f16\u53f7" INTEGER PRIMARY KEY)')
  ipc.ddl.mockResolvedValue('CREATE TABLE "\u771f\u5b9e\u8868" ("\u7f16\u53f7" INTEGER PRIMARY KEY, name TEXT)')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh DDL' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: i18n.t('workbench.readOnlyDdlAria') })).toHaveValue('CREATE TABLE "\u771f\u5b9e\u8868" ("\u7f16\u53f7" INTEGER PRIMARY KEY, name TEXT)'))
  expect(ipc.ddl).toHaveBeenLastCalledWith('c', 'main', '\u771f\u5b9e\u8868', true)
  fireEvent.click(screen.getByRole('button', { name: 'Open in SQL Tab' }))
  expect(useEditorStore.getState().tabs.at(-1)?.sql).toBe('CREATE TABLE "\u771f\u5b9e\u8868" ("\u7f16\u53f7" INTEGER PRIMARY KEY, name TEXT)')
})

it('loads actual primary-key metadata before opening an object-summary preview', async () => {
  useConnectionStore.setState({ statuses: { c: { connectionId: 'c', status: 'connected' } } })
  vi.mocked(useMetadataStore.getState().loadColumns).mockResolvedValue([{ table: '\u771f\u5b9e\u8868', name: '\u7f16\u53f7', ordinalPosition: 1, dataType: 'INTEGER', nullable: true, isPrimaryKey: true, isGenerated: false, isIdentity: false, isAutoIncrement: false }])
  useEditorStore.setState({ tabs: [{ id: 't', connectionId: 'c', kind: 'objectSummary', title: 'Summary', sql: '', objectSummaryContext: { schema: 'main', object: '\u771f\u5b9e\u8868', objectKind: 'table', driverType: 'sqlite' } }] })
  render(<MainPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview data' }))
  await waitFor(() => expect(ipc.run).toHaveBeenCalled())
  expect(useEditorStore.getState().tabs.at(-1)?.dataContext?.primaryKeyColumns).toEqual(['\u7f16\u53f7'])
  expect(ipc.run.mock.calls[0][2]).toContain('ORDER BY "\u7f16\u53f7" ASC')
})
