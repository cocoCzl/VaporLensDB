import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MainPanel } from './MainPanel'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import i18n from '@/i18n'

const ipc = vi.hoisted(() => ({ ddl: vi.fn(), triggers: vi.fn() }))
vi.mock('@/ipc/metadata', async (original) => ({ ...await original<typeof import('@/ipc/metadata')>(), getTableDdl: ipc.ddl, getTableTriggers: ipc.triggers }))
const trigger = (name: string) => ({ schema: 'public', name, kind: 'trigger' as const })
beforeEach(async () => {
  await i18n.changeLanguage('en')
  ipc.ddl.mockResolvedValue('CREATE TABLE table_a (id INT)')
  ipc.triggers.mockResolvedValue([trigger('trigger_a')])
  for (const key of ['loadColumns', 'loadIndexes', 'loadForeignKeys'] as const) vi.spyOn(useMetadataStore.getState(), key).mockResolvedValue([])
  vi.spyOn(useMetadataStore.getState(), 'loadSchemaObjects').mockResolvedValue([trigger('trigger_a'), trigger('trigger_b')])
  useEditorStore.setState({ activeTabId: 'structure', tabs: [{ id: 'structure', title: 'table_a', kind: 'structure', sql: '', connectionId: 'connection', structureContext: { database: 'db', schema: 'public', object: 'table_a', objectKind: 'table' } }] })
})
afterEach(() => vi.restoreAllMocks())
it('table_a Structure never displays table_b triggers from the schema-wide API', async () => {
  render(<MainPanel />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Triggers' }))
  expect(await screen.findByText('trigger_a')).toBeInTheDocument()
  expect(screen.queryByText('trigger_b')).not.toBeInTheDocument()
  expect(ipc.triggers).toHaveBeenCalledWith('connection', 'public', 'table_a')
  expect(useMetadataStore.getState().loadSchemaObjects).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Refresh structure/i }))
  await act(async () => {})
  expect(ipc.triggers).toHaveBeenCalledTimes(2)
})
