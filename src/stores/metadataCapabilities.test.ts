import { beforeEach, expect, it, vi } from 'vitest'
import { useConnectionStore } from './connectionStore'
import { useMetadataStore } from './metadataStore'

const ipc = vi.hoisted(() => ({ functions: vi.fn(), objects: vi.fn(), tables: vi.fn() }))
vi.mock('@/ipc/metadata', async original => ({ ...await original<typeof import('@/ipc/metadata')>(), getFunctions: ipc.functions, getSchemaObjects: ipc.objects, getTables: ipc.tables }))
beforeEach(() => {
  vi.clearAllMocks()
  useMetadataStore.getState().clearConnection('jdbc-fixture')
  useConnectionStore.setState({ capabilities: { 'jdbc-fixture': { hasDatabase: true, hasSchema: true, supportsDdl: false, supportsStreaming: true, supportsTransactions: true, supportsExplain: false, supportsCancel: true, supportsFunctions: false, supportsSchemaObjects: false } } })
})
it('skips unsupported function and schema-object calls while retaining actual table metadata', async () => {
  ipc.tables.mockResolvedValue([{ name: '\u771f\u5b9e\u8868', tableType: 'table' }])
  const state = useMetadataStore.getState()
  const [functions, objects, tables] = await Promise.all([state.loadFunctions('jdbc-fixture', 'main'), state.loadSchemaObjects('jdbc-fixture', 'main', 'materializedView'), state.loadTables('jdbc-fixture', 'main')])
  expect(functions).toEqual([])
  expect(objects).toEqual([])
  expect(ipc.functions).not.toHaveBeenCalled()
  expect(ipc.objects).not.toHaveBeenCalled()
  expect(tables).toEqual([{ name: '\u771f\u5b9e\u8868', tableType: 'table' }])
  expect(ipc.tables).toHaveBeenCalledWith('jdbc-fixture', 'main')
})
it('resumes supported function loading after a new runtime capability is obtained', async () => {
  useConnectionStore.setState(state => ({ capabilities: { 'jdbc-fixture': { ...state.capabilities['jdbc-fixture'], supportsFunctions: true } } }))
  ipc.functions.mockResolvedValue(['real_function'])
  await expect(useMetadataStore.getState().loadFunctions('jdbc-fixture', 'main')).resolves.toEqual(['real_function'])
  expect(ipc.functions).toHaveBeenCalledOnce()
})
