import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ConnectionDialog } from './ConnectionDialog'
import { DriverWorkspace } from './DriverWorkspace'
import { useDriverStore } from '@/stores/driverStore'
import { useConnectionStore } from '@/stores/connectionStore'
import type { DatabaseProduct, DriverDefinition, DriverInstallation } from '@/types/driver'
import recipes from '@/shared/jdbc-downloads.json'
import { open } from '@tauri-apps/plugin-dialog'
import { importJdbcDriverArtifacts } from '@/ipc/driver'

const db = vi.hoisted(() => ({ products: [] as DatabaseProduct[], drivers: [] as DriverDefinition[], installations: [] as DriverInstallation[] }))
vi.mock('@/ipc/driver', () => ({
  listJdbcDownloads: vi.fn(async () => recipes), downloadJdbcDriver: vi.fn(), checkJdbcRuntime: vi.fn(),
  listDatabaseProducts: vi.fn(async () => db.products), listDriverDefinitions: vi.fn(async () => db.drivers), listDriverInstallations: vi.fn(async () => db.installations),
  saveDatabaseProduct: vi.fn(async (p: DatabaseProduct) => { db.products = [...db.products, p]; return p }),
  saveCustomDriverDefinition: vi.fn(async (d: DriverDefinition) => { db.drivers = [...db.drivers, d]; return d }),
  deleteCustomDriverDefinition: vi.fn(), deleteDriverInstallation: vi.fn(), importJdbcDriverArtifacts: vi.fn(), removeJdbcDriverArtifact: vi.fn(), validateExternalDriver: vi.fn(), exportDriverConfiguration: vi.fn(), importDriverConfiguration: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
const pg: DriverDefinition = { id:'postgres',productId:'postgres',name:'PostgreSQL',driverType:'postgres',driverDialect:'postgresql',backend:'nativeRust',status:'ready',builtIn:true,userDriverRequired:false,driverArtifacts:[],defaultPort:5432,connectionVariants:[{id:'hostPort',label:'Host',requiredFields:['host']}],capabilities:{canConnect:true,canQuery:true,canStream:true,canReadMetadata:true,canCancel:true,canGenerateDdl:true} }
const jdbc: DriverDefinition = { ...pg,id:'jdbc-postgresql',name:'PostgreSQL JDBC',backend:'jdbc',jdbcDriverClass:'org.postgresql.Driver',urlTemplate:'jdbc:postgresql://{host}:{port}/{database}',userDriverRequired:true }
const click = (key: string) => fireEvent.click(screen.getByRole('button', { name:i18n.t(key) }))
const select = async (id: string, name: RegExp) => { fireEvent.click(document.querySelector(id)!); const option = await screen.findByRole('option',{name});fireEvent.pointerDown(option,{pointerType:'mouse'});fireEvent.mouseUp(option);fireEvent.click(option) }
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage('en')
  db.products=[{id:'postgres',name:'PostgreSQL',builtIn:true,iconKey:'postgres',adapterId:'postgresql',defaultDriverDefinitionId:'postgres'}];db.drivers=[pg,jdbc];db.installations=[]
  useDriverStore.setState({ products:db.products,drivers:db.drivers,installations:[],loading:false,error:null })
  useConnectionStore.setState({ connections:[],dataSourceGroups:[],loading:false })
})
async function newDialog() { render(<ConnectionDialog />);fireEvent.click(document.querySelector('[data-slot="dialog-trigger"]')!);await screen.findByRole('radiogroup') }

it.each(['en','zh'])('opens a focused new-product page immediately, saves and uses its independent identity in %s', async language => {
  await i18n.changeLanguage(language); await newDialog()
  click('driverRefactor.addProduct')
  const name = await screen.findByLabelText(i18n.t('driverWorkflow.databaseName'))
  await waitFor(()=>expect(name).toHaveFocus())
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getAllByRole('heading',{name:i18n.t('driverRefactor.addProduct')})).toHaveLength(1)
  expect(screen.queryByRole('button',{name:i18n.t('common.close')})).not.toBeInTheDocument()
  fireEvent.change(name,{target:{value:'Independent database'}})
  fireEvent.change(screen.getByLabelText(i18n.t('driverWorkflow.driverName')),{target:{value:'Independent driver'}})
  fireEvent.change(screen.getByLabelText(i18n.t('drivers.driverClass')),{target:{value:'example.jdbc.Driver'}})
  click('driverWorkflow.saveUse')
  await waitFor(()=>expect(document.querySelector('#connection-name')).toBeVisible())
  expect(document.querySelector('#connection-name')).toHaveValue('Independent database')
  expect(document.querySelector('#driver-profile')).toHaveTextContent('Independent driver')
  expect(screen.getByRole('button',{name:i18n.t('connectionForm.testConnection')})).toBeDisabled()
  expect(screen.queryByText(i18n.t('driverRefactor.missingReference'))).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.notInstalled'))
  expect(db.products).toHaveLength(2)
  expect(db.drivers.at(-1)?.productId).toBe(db.products.at(-1)?.id)
  expect(db.drivers.at(-1)?.metadataDialectSql).toBeNull()
})

it('protects an unsaved new product on Escape, preserves it when kept, and restores entry focus after discarding',async()=>{
  await newDialog();const entry=screen.getByRole('button',{name:i18n.t('driverRefactor.addProduct')});entry.focus();fireEvent.click(entry)
  fireEvent.change(await screen.findByLabelText(i18n.t('driverWorkflow.databaseName')),{target:{value:'Unsaved product'}})
  fireEvent.keyDown(document,{key:'Escape'})
  expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  click('driverWorkflow.keepEditing')
  expect(screen.getByLabelText(i18n.t('driverWorkflow.databaseName'))).toHaveValue('Unsaved product')
  fireEvent.keyDown(document,{key:'Escape'});click('driverWorkflow.discard')
  await waitFor(()=>expect(screen.getByRole('radiogroup')).toBeVisible())
  expect(entry).toHaveFocus();expect(screen.getAllByRole('dialog')).toHaveLength(1)
})

it('preserves endpoint, password, security and installation draft through manager, download and local import navigation',async()=>{
  await newDialog();click('connectionCatalog.next')
  fireEvent.change(document.querySelector('#connection-name')!,{target:{value:'Keep draft'}})
  fireEvent.change(document.querySelector('#connection-host')!,{target:{value:'draft.invalid'}})
  fireEvent.change(document.querySelector('#connection-port')!,{target:{value:'61234'}})
  fireEvent.change(document.querySelector('#connection-username')!,{target:{value:'qa-user'}})
  fireEvent.change(document.querySelector('#connection-password')!,{target:{value:'fixture-password'}})
  fireEvent.click(screen.getByText(i18n.t('connectionForm.sshTunnelSection')))
  fireEvent.click(screen.getByRole('switch',{name:i18n.t('connectionForm.enableSshTunnel')}))
  const ssh=screen.getByText(i18n.t('connectionForm.sshTunnelSection')).closest('details')!
  fireEvent.change(within(ssh).getAllByRole('textbox')[0],{target:{value:'bastion.invalid'}})
  fireEvent.click(screen.getByText(i18n.t('connectionForm.sslSection')))
  const ssl=screen.getByText(i18n.t('connectionForm.sslSection')).closest('details')!
  fireEvent.click(within(ssl).getByRole('combobox'))
  const requireTls=await screen.findByRole('option',{name:'require'})
  fireEvent.pointerDown(requireTls,{pointerType:'mouse'});fireEvent.mouseUp(requireTls);fireEvent.click(requireTls)
  await select('#driver-profile', /PostgreSQL JDBC/)
  click('driverRefactor.manage')
  await screen.findByRole('heading',{name:i18n.t('drivers.title')})
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getAllByRole('button',{name:i18n.t('driverWorkflow.back')}).at(-1)!)
  await waitFor(()=>expect(document.querySelector('#connection-host')).toBeVisible())
  const installEntry=screen.getByRole('button',{name:i18n.t('jdbcDownload.recommended',{version:'42.7.14'})})
  installEntry.focus();fireEvent.click(installEntry)
  await screen.findByText('checker-qual-3.55.1.jar')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.keyDown(document,{key:'Escape'})
  await waitFor(()=>expect(installEntry).toHaveFocus())
  click('drivers.importJar');await screen.findByRole('heading',{name:i18n.t('driverWorkflow.localInstall')})
  fireEvent.keyDown(document,{key:'Escape'})
  expect(document.querySelector('#connection-name')).toHaveValue('Keep draft')
  expect(document.querySelector('#connection-host')).toHaveValue('draft.invalid')
  expect(document.querySelector('#connection-port')).toHaveValue(61234)
  expect(document.querySelector('#connection-username')).toHaveValue('qa-user')
  expect(document.querySelector('#connection-password')).toHaveValue('fixture-password')
  expect(screen.getByRole('switch',{name:i18n.t('connectionForm.enableSshTunnel')})).toBeChecked()
  expect(within(ssh).getAllByRole('textbox')[0]).toHaveValue('bastion.invalid')
  expect(within(ssl).getByRole('combobox')).toHaveTextContent('require')
  expect(document.querySelector('#driver-profile')).toHaveTextContent('PostgreSQL JDBC')
  click('common.cancel');click('driverWorkflow.keepEditing')
  expect(document.querySelector('#connection-password')).toHaveValue('fixture-password')
})

it('copies a definition onto its existing product and never creates a second product',async()=>{
  render(<DriverWorkspace />)
  fireEvent.click(screen.getByText('PostgreSQL JDBC',{selector:'strong'}))
  click('driverRefactor.copyDefinition')
  expect(screen.getByRole('combobox',{name:i18n.t('driverRefactor.product')})).toHaveTextContent('PostgreSQL')
  click('common.save')
  await waitFor(()=>expect(db.drivers).toHaveLength(3))
  expect(db.products).toHaveLength(1);expect(db.drivers.at(-1)?.productId).toBe('postgres')
  expect(db.drivers.at(-1)?.defaultInstallationId).toBeNull()
})

it('orders local JARs before publishing, keeps the original connection pin and shows separate validation states',async()=>{
  useConnectionStore.setState({connections:[{id:'pinned',name:'Pinned',driverType:'postgres',productId:'postgres',driverDefinitionId:jdbc.id,driverInstallationId:'old-install'}]})
  const installed=vi.fn()
  render(<DriverWorkspace entry={{page:'local',driverId:jdbc.id}} onBack={vi.fn()} onInstalled={installed} />)
  vi.mocked(open).mockResolvedValue(['/qa/dep.jar','/qa/main.jar'])
  click('driverWorkflow.chooseJars');await screen.findByText('main.jar')
  fireEvent.click(screen.getAllByRole('button',{name:i18n.t('driverWorkflow.moveUp')})[1])
  vi.mocked(importJdbcDriverArtifacts).mockResolvedValue({...jdbc,defaultInstallationId:'new-install'})
  click('driverWorkflow.installFiles')
  await waitFor(()=>expect(installed).toHaveBeenCalledWith(jdbc.id,'new-install'))
  expect(importJdbcDriverArtifacts).toHaveBeenCalledWith({driverDefinitionId:jdbc.id,paths:['/qa/main.jar','/qa/dep.jar'],label:''})
  expect(useConnectionStore.getState().connections[0].driverInstallationId).toBe('old-install')
  expect(screen.getByRole('status')).toHaveTextContent(i18n.t('jdbcDownload.separateChecks'))
})

it('an empty search never advances to a hidden selection, and 50 products retain keyboard selection',async()=>{
  db.products.push(...Array.from({length:50},(_,i)=>({id:`qa-${i}`,name:`QA ${i} long product name`,builtIn:false,iconKey:'jdbc',adapterId:'genericSql',defaultDriverDefinitionId:`qa-driver-${i}`})))
  db.drivers.push(...db.products.slice(1).map(p=>({...jdbc,id:p.defaultDriverDefinitionId!,productId:p.id,name:p.name,builtIn:false})))
  await act(async()=>{await useDriverStore.getState().loadDrivers(true)})
  await newDialog();click('connectionCatalog.custom')
  expect(screen.getAllByRole('radio')).toHaveLength(50)
  const first=screen.getAllByRole('radio')[0];first.focus();fireEvent.keyDown(first,{key:'End'})
  expect(screen.getAllByRole('radio')[49]).toHaveFocus()
  fireEvent.change(screen.getByRole('textbox',{name:i18n.t('driverRefactor.searchProducts')}),{target:{value:'no match'}})
  expect(screen.getByRole('button',{name:i18n.t('connectionCatalog.next')})).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(i18n.t('connectionCatalog.empty'))
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox',{name:i18n.t('driverRefactor.searchProducts')}),{target:{value:'QA 49'}})
  fireEvent.click(screen.getByRole('radio',{name:'QA 49 long product name'}))
  expect(screen.getByRole('button',{name:i18n.t('connectionCatalog.next')})).toBeEnabled()
})

it('Escape closes the driver menu before asking to leave an unsaved connection', async () => {
  await newDialog(); click('connectionCatalog.next')
  fireEvent.change(document.querySelector('#connection-name')!, { target: { value: 'Keep this draft' } })
  fireEvent.click(document.querySelector('#driver-profile')!)
  const option = await screen.findByRole('option', { name: /PostgreSQL JDBC/ })
  fireEvent.keyDown(option, { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  expect(screen.queryByText(i18n.t('driverWorkflow.unsaved'))).not.toBeInTheDocument()
  expect(document.querySelector('#connection-name')).toHaveValue('Keep this draft')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(await screen.findByText(i18n.t('driverWorkflow.unsaved'))).toBeVisible()
})


it('returns to the manager after saving a new product and reopening its editor',async()=>{
  const back=vi.fn()
  render(<DriverWorkspace entry={{page:'product'}} onBack={back} />)
  fireEvent.change(screen.getByLabelText(i18n.t('driverWorkflow.databaseName')),{target:{value:'New product'}})
  fireEvent.change(screen.getByLabelText(i18n.t('driverWorkflow.driverName')),{target:{value:'New driver'}})
  fireEvent.change(screen.getByLabelText(i18n.t('drivers.driverClass')),{target:{value:'example.Driver'}})
  click('common.save')
  await screen.findByRole('heading',{name:i18n.t('drivers.title')})
  click('connection.edit')
  fireEvent.change(screen.getByLabelText(i18n.t('driverWorkflow.driverName')),{target:{value:'Unsaved driver'}})
  fireEvent.click(screen.getAllByRole('button',{name:i18n.t('driverWorkflow.back')})[0])
  click('driverWorkflow.discard')
  expect(screen.getByRole('heading',{name:i18n.t('drivers.title')})).toBeVisible()
  expect(back).not.toHaveBeenCalled()
})

it('routes Escape to the local installation page, preserving its unsaved-file guard and exact source',async()=>{
  const custom={...jdbc,id:'custom-offline',builtIn:false}
  useDriverStore.setState({drivers:[custom]})
  const registerBack=vi.fn(),back=vi.fn()
  render(<DriverWorkspace entry={{page:'local',driverId:custom.id}} onBack={back} registerBack={registerBack} />)
  act(()=>registerBack.mock.lastCall![0]())
  expect(back).toHaveBeenCalledOnce()
  back.mockClear()
  fireEvent.change(screen.getByLabelText(i18n.t('driverRefactor.versionLabel')),{target:{value:'Unsaved version'}})
  act(()=>registerBack.mock.lastCall![0]())
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.unsaved'))
  expect(back).not.toHaveBeenCalled()
  click('driverWorkflow.keepEditing')
  expect(screen.getByLabelText(i18n.t('driverRefactor.versionLabel'))).toHaveValue('Unsaved version')
  act(()=>registerBack.mock.lastCall![0]());click('driverWorkflow.discard')
  expect(back).toHaveBeenCalledOnce()
})

it('offers one Back action, prioritizes Save and use, and restores focus after keeping an unsaved draft',async()=>{
  await newDialog()
  click('driverRefactor.addProduct')
  const field=await screen.findByLabelText(i18n.t('driverWorkflow.databaseName'))
  fireEvent.change(field,{target:{value:'Keep my product'}})
  expect(screen.getAllByRole('button',{name:i18n.t('driverWorkflow.back')})).toHaveLength(1)
  expect(screen.getByRole('button',{name:i18n.t('common.save')})).toHaveClass('bg-surface')
  expect(screen.getByRole('button',{name:i18n.t('driverWorkflow.saveUse')})).toHaveClass('bg-primary')
  field.focus();fireEvent.keyDown(document,{key:'Escape'})
  click('driverWorkflow.keepEditing')
  await waitFor(()=>expect(field).toHaveFocus())
  expect(field).toHaveValue('Keep my product')
})
