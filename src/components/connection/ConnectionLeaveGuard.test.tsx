import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useDriverStore } from '@/stores/driverStore'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'
import { ConnectionDialog } from './ConnectionDialog'

vi.mock('@/ipc/driver', async original => ({ ...await original<typeof import('@/ipc/driver')>(), listJdbcDownloads: vi.fn(async () => []) }))
const pg: DriverDefinition = {
  id: 'postgres', productId: 'postgres', name: 'PostgreSQL', driverType: 'postgres', driverDialect: 'postgresql',
  backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false, driverArtifacts: [], defaultPort: 5432,
  connectionVariants: [{ id: 'hostPort', label: 'Host', requiredFields: ['host'] }],
  capabilities: { canConnect: true, canQuery: true, canStream: true, canReadMetadata: true, canCancel: true, canGenerateDdl: true },
}
const jdbc: DriverDefinition = { ...pg, id: 'jdbc-postgresql', name: 'PostgreSQL JDBC', backend: 'jdbc', jdbcDriverClass: 'org.postgresql.Driver', defaultInstallationId: 'install-1' }
const drivers: DriverDefinition[] = [pg, jdbc,
  { ...pg, id: 'mysql', productId: 'mysql', name: 'MySQL', driverType: 'mysql', defaultPort: 3306 },
  { ...pg, id: 'sqlite', productId: 'sqlite', name: 'SQLite', driverType: 'sqlite', connectionVariants: [{ id: 'file', label: 'File', requiredFields: ['connectionUrl'] }] },
  { ...pg, id: 'mssql', productId: 'mssql', name: 'SQL Server', driverType: 'mssql', defaultPort: 1433 },
  { ...jdbc, id: 'oracle', productId: 'oracle', name: 'Oracle', driverType: 'oracle', defaultPort: 1521, defaultInstallationId: null },
  { ...jdbc, id: 'custom-driver', productId: 'custom-product', name: 'Acme JDBC', builtIn: false, driverType: 'jdbc', defaultInstallationId: null },
]
const click = (key: string) => fireEvent.click(screen.getByRole('button', { name: i18n.t(key) }))
async function open(connection?: ConnectionConfig) {
  render(<ConnectionDialog connection={connection} />)
  fireEvent.click(document.querySelector('[data-slot="dialog-trigger"]')!)
  if (connection) await waitFor(() => expect(document.querySelector('#connection-name')).toBeVisible())
  else await screen.findByRole('radiogroup')
}
function choose(name: string) { fireEvent.click(screen.getByRole('radio', { name })); click('connectionCatalog.next') }
function host(value: string) { fireEvent.change(document.querySelector('#connection-host')!, { target: { value } }) }
async function select(selector: string, name: RegExp) {
  fireEvent.click(document.querySelector(selector)!)
  const option = await screen.findByRole('option', { name })
  fireEvent.pointerDown(option, { pointerType: 'mouse' }); fireEvent.mouseUp(option); fireEvent.click(option)
}
async function closed() { await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()) }
const existing: ConnectionConfig = { id: 'saved', name: 'Saved', productId: 'postgres', driverDefinitionId: 'postgres', driverType: 'postgres', host: 'localhost', port: 5432, hasSavedPassword: true }
beforeEach(async () => {
  await i18n.changeLanguage('en')
  const products = drivers.filter(d => d.id !== jdbc.id).map(d => ({ id: d.productId!, name: d.productId === 'custom-product' ? 'Acme' : d.name, iconKey: d.driverType, builtIn: d.builtIn, adapterId: d.driverDialect, defaultDriverDefinitionId: d.id }))
  useDriverStore.setState({ drivers, products, installations: ['install-1', 'install-2'].map(id => ({ id, driverDefinitionId: jdbc.id, label: id, artifacts: [], javaRequirement: 'Java 21+' })), loading: false, error: null })
  useConnectionStore.setState({ connections: [], dataSourceGroups: [] })
})

it.each(['MySQL', 'PostgreSQL', 'SQLite', 'SQL Server', 'Oracle', 'Acme'])('first selection and automatic defaults for %s do not protect Cancel', async name => {
  await open(); choose(name); click('common.cancel'); await closed()
})

it.each(['MySQL', 'PostgreSQL', 'SQLite', 'SQL Server', 'Oracle', 'Acme'])('unedited %s closes directly on Escape', async name => {
  await open(); choose(name); fireEvent.keyDown(document, { key: 'Escape' }); await closed()
})

it('protects actual edits and restores focus and clean state when the effective value is restored', async () => {
  await open(); choose('MySQL'); host('edited.invalid'); click('common.cancel')
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); host(' localhost ')
  fireEvent.blur(document.querySelector('#connection-host')!); click('common.cancel'); await closed()
})

it('navigates PG → MySQL → PG and back to the catalog without inventing edits', async () => {
  await open(); choose('PostgreSQL'); click('connectionCatalog.change'); choose('MySQL')
  click('connectionCatalog.change'); choose('PostgreSQL'); click('connectionCatalog.change'); click('common.cancel'); await closed()
})

it('protects edits in an inactive product and restores that draft until it is reverted', async () => {
  await open(); choose('PostgreSQL'); host('pg-draft.invalid')
  click('connectionCatalog.change'); choose('MySQL'); click('common.cancel')
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); click('connectionCatalog.change'); choose('PostgreSQL')
  expect(document.querySelector('#connection-host')).toHaveValue('pg-draft.invalid')
  host('localhost'); click('common.cancel'); await closed()
})

it('does not reset dirty state or user input when the catalog and default installation refresh asynchronously', async () => {
  await open(); choose('MySQL'); host('keep.invalid')
  act(() => useDriverStore.setState({ drivers: [] }))
  act(() => useDriverStore.setState({ drivers: drivers.map(d => ({ ...d, defaultPort: 9999, defaultInstallationId: 'install-2' })) }))
  expect(document.querySelector('#connection-host')).toHaveValue('keep.invalid')
  expect(document.querySelector('#connection-port')).toHaveValue(3306)
  click('common.cancel'); expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); host('localhost'); click('common.cancel'); await closed()
})

it('leaves an existing connection unchanged without a prompt', async () => {
  await open(existing); click('common.cancel'); await closed()
})

it('protects an existing connection after a driver change and becomes clean on reverting it', async () => {
  await open(existing); await select('#driver-profile', /PostgreSQL JDBC/)
  click('common.cancel'); expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); await select('#driver-profile', /PostgreSQL ·/)
  click('common.cancel'); await closed()
})

it('protects an existing installation change and clears the guard on reverting the pin', async () => {
  await open({ ...existing, driverDefinitionId: jdbc.id, driverInstallationId: 'install-1' })
  await select('[aria-label="Driver installation"]', /install-2/)
  click('common.cancel'); expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); await select('[aria-label="Driver installation"]', /install-1/)
  click('common.cancel'); await closed()
})

it('protects password and sensitive property changes, including toggles, without persisting snapshots', async () => {
  await open({ ...existing, driverDefinitionId: jdbc.id, driverInstallationId: 'install-1', driverProperties: [{ name: 'token', sensitive: true, hasSavedValue: true }] })
  const password = document.querySelector('#connection-password')!
  fireEvent.change(password, { target: { value: 'test-only-secret' } }); click('common.cancel')
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); fireEvent.change(password, { target: { value: '' } })
  fireEvent.click(screen.getByText(i18n.t('connectionForm.advanced')))
  const sensitive = screen.getByRole('checkbox', { name: i18n.t('driverRefactor.sensitive') })
  fireEvent.click(sensitive); click('common.cancel'); expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); fireEvent.click(sensitive)
  const value = screen.getByLabelText(i18n.t('driverRefactor.propertyValue'))
  expect(value).toHaveAttribute('type', 'password')
  fireEvent.change(value, { target: { value: 'test-only-token' } }); click('common.cancel')
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing'); fireEvent.change(value, { target: { value: '' } })
  expect(window.localStorage.length).toBe(0)
  click('common.cancel'); await closed()
})

it('protects removal of a saved sensitive property', async () => {
  await open({ ...existing, driverDefinitionId: jdbc.id, driverProperties: [{ name: 'token', sensitive: true, hasSavedValue: true }] })
  fireEvent.click(screen.getByText(i18n.t('connectionForm.advanced')))
  click('common.delete'); click('common.cancel')
  expect(screen.getByText(i18n.t('driverWorkflow.unsaved'))).toBeVisible()
})
