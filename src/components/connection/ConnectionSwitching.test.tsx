import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@/i18n'
import { beforeEach, expect, it, vi } from 'vitest'
import { ConnectionForm } from './ConnectionForm'
import { useDriverStore } from '@/stores/driverStore'
import type { DriverDefinition } from '@/types/driver'

const pg: DriverDefinition = {
  id: 'postgres', productId: 'postgres', driverType: 'postgres', driverDialect: 'postgresql', name: 'PostgreSQL',
  backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false, driverArtifacts: [], defaultPort: 5432,
  connectionVariants: [{ id: 'hostPort', label: 'Host / port', requiredFields: ['host', 'port', 'database', 'username'] }, { id: 'urlOnly', label: 'URL only', requiredFields: ['connectionUrl', 'username'] }],
  capabilities: { canConnect: true, canQuery: true, canStream: true, canReadMetadata: true, canCancel: true, canGenerateDdl: true },
}
const sqlServer: DriverDefinition = { ...pg, id: 'mssql', productId: 'mssql', driverType: 'mssql', driverDialect: 'mssql', name: 'SQL Server', defaultPort: 1433, connectionVariants: [{ id: 'hostPort', label: 'Host / port', requiredFields: ['host', 'port', 'database', 'username', 'password'] }] }

vi.mock('@/ipc/driver', async importOriginal => ({ ...await importOriginal<typeof import('@/ipc/driver')>(), listJdbcDownloads: vi.fn(async () => []) }))
const callbacks = () => ({ onSaveOnly: vi.fn(async () => {}), onSaveAndConnect: vi.fn(async () => {}), onTest: vi.fn(async () => {}), onCancel: vi.fn() })
const next = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.next') }))
const back = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.change') }))
async function implementation(name: RegExp) {
  fireEvent.click(document.querySelector('#driver-profile')!)
  const option = await screen.findByRole('option', { name })
  fireEvent.pointerDown(option, { pointerType: 'mouse' }); fireEvent.mouseUp(option); fireEvent.click(option)
}
beforeEach(() => { useDriverStore.setState({ products: [], drivers: [], installations: [], error: null, loading: false }) })

it('switches PostgreSQL → SQL Server → PostgreSQL using the real form and selectors', async () => {
  useDriverStore.setState({ products: [], installations: [], error: null, loading: false })
  render(<ConnectionForm driverDefinitions={[pg, { ...pg, id: 'jdbc-postgresql', name: 'PostgreSQL JDBC', backend: 'jdbc', userDriverRequired: true, jdbcDriverClass: 'org.postgresql.Driver' }, sqlServer]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: 'PostgreSQL' }))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.next') }))
  fireEvent.click(document.querySelector('#driver-profile')!)
  const nativeOption = await screen.findByRole('option', { name: /PostgreSQL ·/ })
  fireEvent.pointerDown(nativeOption, { pointerType: 'mouse' })
  fireEvent.mouseUp(nativeOption)
  fireEvent.click(nativeOption)
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.change') }))
  fireEvent.click(screen.getByRole('radio', { name: 'SQL Server' }))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.next') }))
  expect(document.querySelector('#connection-port')).toHaveValue(1433)
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.change') }))
  fireEvent.click(screen.getByRole('radio', { name: 'PostgreSQL' }))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.next') }))
  expect(document.querySelector('#connection-port')).toHaveValue(5432)
})

it('loads asynchronously without inventing implementations or losing the selected product', async () => {
  useDriverStore.setState({ loading: true })
  const props = callbacks()
  const view = render(<ConnectionForm driverDefinitions={[]} {...props} />)
  expect(screen.queryAllByRole('radio')).toHaveLength(0)
  expect(screen.getByRole('button', { name: i18n.t('connectionCatalog.next') })).toBeDisabled()
  act(() => useDriverStore.setState({ loading: false }))
  view.rerender(<ConnectionForm driverDefinitions={[pg, sqlServer]} {...props} />)
  fireEvent.click(screen.getByRole('radio', { name: 'SQL Server' })); next()
  expect(document.querySelector('#connection-port')).toHaveValue(1433)
  view.rerender(<ConnectionForm driverDefinitions={[]} {...props} />)
  expect(screen.getByRole('button', { name: i18n.t('connectionForm.testConnection') })).toBeDisabled()
  view.rerender(<ConnectionForm driverDefinitions={[pg, sqlServer]} {...props} />)
  expect(document.querySelector('#connection-port')).toHaveValue(1433)
})

it('cycles every built-in product and isolates drafts, including passwords, by product', () => {
  const drivers: DriverDefinition[] = [pg, sqlServer,
    { ...pg, id: 'mysql', productId: 'mysql', driverType: 'mysql', name: 'MySQL', defaultPort: 3306 },
    { ...pg, id: 'sqlite', productId: 'sqlite', driverType: 'sqlite', name: 'SQLite', connectionVariants: [{ id: 'file', label: 'File', requiredFields: ['connectionUrl'] }] },
    { ...pg, id: 'oracle', productId: 'oracle', driverType: 'oracle', name: 'Oracle', backend: 'jdbc', jdbcDriverClass: 'oracle.jdbc.OracleDriver', userDriverRequired: true, connectionVariants: [{ id: 'oracleService', label: 'Service', requiredFields: ['host'] }, { id: 'oracleSid', label: 'SID', requiredFields: ['host'] }] },
    { ...pg, id: 'jdbc', productId: 'jdbc', driverType: 'jdbc', name: 'Custom JDBC', backend: 'jdbc', userDriverRequired: true, connectionVariants: [{ id: 'urlOnly', label: 'URL', requiredFields: ['connectionUrl'] }] },
  ]
  render(<ConnectionForm driverDefinitions={drivers} {...callbacks()} />)
  next()
  fireEvent.change(document.querySelector('#connection-host')!, { target: { value: 'pg-draft.invalid' } })
  fireEvent.change(document.querySelector('#connection-password')!, { target: { value: 'fixture-only-secret' } })
  back()
  for (const name of ['SQL Server', 'MySQL', 'SQLite', 'Oracle', 'Custom']) {
    fireEvent.click(screen.getByRole('radio', { name: name === 'Custom' ? 'Custom' : name })); next()
    expect(document.querySelector('#connection-name')).toBeVisible()
    expect((document.querySelector('#connection-password') as HTMLInputElement | null)?.value).not.toBe('fixture-only-secret')
    expect((document.querySelector('#connection-host') as HTMLInputElement | null)?.value).not.toBe('pg-draft.invalid')
    back()
  }
  fireEvent.click(screen.getByRole('radio', { name: 'PostgreSQL' })); next()
  expect(document.querySelector('#connection-host')).toHaveValue('pg-draft.invalid')
  expect(document.querySelector('#connection-password')).toHaveValue('fixture-only-secret')
})

it('keeps common fields but isolates driver Properties across Native/JDBC switches', async () => {
  const jdbc: DriverDefinition = { ...pg, id: 'jdbc-postgresql', backend: 'jdbc', name: 'PG JDBC', jdbcDriverClass: 'org.postgresql.Driver', userDriverRequired: true }
  render(<ConnectionForm driverDefinitions={[pg, jdbc]} {...callbacks()} />); next()
  fireEvent.change(document.querySelector('#connection-port')!, { target: { value: '6000' } })
  await implementation(/PG JDBC/)
  expect(screen.getByRole('button', { name: i18n.t('connectionForm.testConnection') })).toBeDisabled()
  fireEvent.click(screen.getByText(i18n.t('connectionForm.advanced')))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('driverRefactor.addProperty') }))
  fireEvent.change(screen.getByLabelText(i18n.t('driverRefactor.propertyName')), { target: { value: 'applicationName' } })
  await implementation(/PostgreSQL ·/)
  expect(screen.queryByLabelText(i18n.t('driverRefactor.propertyName'))).not.toBeInTheDocument()
  expect(document.querySelector('#connection-port')).toHaveValue(6000)
  await implementation(/PG JDBC/)
  expect(screen.getByLabelText(i18n.t('driverRefactor.propertyName'))).toHaveValue('applicationName')
})

it.each(['en', 'zh'])('searches and keyboard-selects 50 custom products in %s without expanding the parameter page', async language => {
  await i18n.changeLanguage(language)
  const products = Array.from({ length: 50 }, (_, i) => ({ id: `product-${i}`, name: `QA ${String(i).padStart(2,'0')} 很长的产品名称 Long database product`, builtIn: false, iconKey: 'jdbc', adapterId: 'genericSql', defaultDriverDefinitionId: `driver-${i}` })) // i18n-hardcoded-ok: bilingual test-only product fixture
  const drivers = products.map(p => ({ ...pg, id: p.defaultDriverDefinitionId, productId: p.id, name: p.name, builtIn: false, backend: 'jdbc' as const, driverType: 'jdbc' as const, connectionVariants: [{ id: 'urlOnly', label: 'URL', requiredFields: ['connectionUrl'] }] }))
  useDriverStore.setState({ products, drivers })
  render(<ConnectionForm driverDefinitions={[pg, ...drivers]} {...callbacks()} />)
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionCatalog.custom') }))
  expect(screen.getAllByRole('radio')).toHaveLength(50)
  const first = screen.getAllByRole('radio')[0]; first.focus(); fireEvent.keyDown(first, { key: 'End' })
  expect(screen.getAllByRole('radio')[49]).toHaveFocus()
  fireEvent.change(screen.getByLabelText(i18n.t('driverRefactor.searchProducts')), { target: { value: 'QA 49' } })
  expect(screen.getAllByRole('radio')).toHaveLength(1)
  next()
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  fireEvent.change(document.querySelector('#connection-url')!, { target: { value: 'jdbc:fixture:qa49' } })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('driverRefactor.manage') }))
  await screen.findByRole('heading', { name: i18n.t('drivers.title') })
  fireEvent.click(screen.getAllByRole('button', { name: i18n.t('driverWorkflow.back') }).at(-1)!)
  await waitFor(() => expect(document.querySelector('#connection-url')).toBeVisible())
  expect(document.querySelector('#connection-url')).toHaveValue('jdbc:fixture:qa49')
  back(); next()
  expect(document.querySelector('#connection-url')).toHaveValue('jdbc:fixture:qa49')
})
