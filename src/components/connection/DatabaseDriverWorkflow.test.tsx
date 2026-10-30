import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useDriverStore } from '@/stores/driverStore'
import { ConnectionForm } from './ConnectionForm'
import { DriverDefinitionsSettings } from '@/components/settings/SettingsWorkspacePanel'
import type { DatabaseProduct, DriverDefinition, DriverInstallation } from '@/types/driver'

const db = vi.hoisted(() => ({ products: [] as DatabaseProduct[], drivers: [] as DriverDefinition[], installations: [] as DriverInstallation[] }))
vi.mock('@/ipc/driver', () => ({
  listJdbcDownloads: vi.fn(async () => []), downloadJdbcDriver: vi.fn(),
  listDatabaseProducts: vi.fn(async () => [...db.products]), listDriverDefinitions: vi.fn(async () => [...db.drivers]), listDriverInstallations: vi.fn(async () => [...db.installations]),
  saveDatabaseProduct: vi.fn(async (p: DatabaseProduct) => { db.products.push(p); return p }),
  saveCustomDriverDefinition: vi.fn(async (d: DriverDefinition) => { db.drivers.push(d); return d }),
  deleteCustomDriverDefinition: vi.fn(), deleteDriverInstallation: vi.fn(), importJdbcDriverArtifacts: vi.fn(), removeJdbcDriverArtifact: vi.fn(), validateExternalDriver: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
const native: DriverDefinition = { id: 'postgres', productId: 'postgres', name: 'PG native', driverType: 'postgres', driverDialect: 'postgresql', backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false, defaultPort: 5432, driverArtifacts: [], connectionVariants: [{ id: 'hostPort', label: 'Host', requiredFields: ['host','username','database'] }], capabilities: { canConnect: true, canQuery: true, canStream: true, canReadMetadata: true, canCancel: true, canGenerateDdl: true } }
const jdbc: DriverDefinition = { ...native, id: 'jdbc-postgresql', name: 'PG JDBC v2', backend: 'jdbc', userDriverRequired: true, defaultPort: 6543, jdbcDriverClass: 'org.postgresql.Driver', defaultInstallationId: 'install-pg', urlTemplate: 'jdbc:postgresql://{host}:{port}/{database}' }
beforeEach(() => {
  db.products = [{ id: 'postgres', name: 'PostgreSQL', builtIn: true, iconKey: 'postgres', adapterId: 'postgresql', defaultDriverDefinitionId: 'postgres' }]
  db.drivers = [native, jdbc]; db.installations = [{ id: 'install-pg', driverDefinitionId: jdbc.id, label: 'User version 2', javaRequirement: '21', artifacts: [] }]
  useDriverStore.setState({ products: db.products, drivers: db.drivers, installations: db.installations, loading: false, error: null })
})
function form() { const save = vi.fn().mockResolvedValue(undefined); return { ...render(<ConnectionForm driverDefinitions={useDriverStore.getState().drivers} onSaveOnly={save} onSaveAndConnect={save} onTest={vi.fn()} onCancel={vi.fn()} />), save } }
async function saveOnly() {fireEvent.click(screen.getByRole('button', { name: i18n.t('common.moreActions') }));fireEvent.click(await screen.findByRole('menuitem', {name:i18n.t('connectionForm.saveOnly')}))}

describe('Product → driver → installation workflows (mock IPC)', () => {
  it('creates two arbitrary products in the manager and immediately shows separate catalog entries', async () => {
    const manager=render(<DriverDefinitionsSettings />)
    for (const name of ['Arbitrary database A','Unrelated database B']) {
      fireEvent.click(screen.getByRole('button',{name:i18n.t('driverRefactor.addProduct')}))
      fireEvent.change(screen.getByLabelText(i18n.t('driverWorkflow.databaseName')), {target:{value:name}})
      fireEvent.change(screen.getByLabelText(i18n.t('driverWorkflow.driverName')), {target:{value:`${name} driver`}})
      fireEvent.change(screen.getByLabelText(i18n.t('drivers.driverClass')), {target:{value:'example.Driver'}})
      fireEvent.click(screen.getByRole('button',{name:i18n.t('common.save')}))
      await waitFor(()=>expect(db.products.some((p)=>p.name===name)).toBe(true))
      await waitFor(()=>expect(useDriverStore.getState().loading).toBe(false))
    }
    manager.unmount();const {save}=form()
    const a=screen.getByRole('radio',{name:'Arbitrary database A'});const b=screen.getByRole('radio',{name:'Unrelated database B'})
    fireEvent.click(a);expect(a).toHaveAttribute('aria-checked','true');expect(b).toHaveAttribute('aria-checked','false')
    fireEvent.click(screen.getByRole('button',{name:i18n.t('connectionCatalog.next')}))
    fireEvent.change(document.querySelector('#connection-url')!,{target:{value:'jdbc:example:fixture'}})
    await saveOnly();await waitFor(()=>expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0][0]).toMatchObject({productId:db.products.find((p)=>p.name==='Arbitrary database A')?.id,connectionMode:'urlOnly',driverType:'jdbc'})
    expect(db.products[1].id).not.toBe(db.products[2].id)
  })
  it.each([5432,61234])('preserves explicit endpoint/account/database when switching implementation at port %s',async (port)=>{
    const {save}=form()
    fireEvent.click(screen.getByRole('button',{name:i18n.t('connectionCatalog.next')}))
    for(const [id,value] of [['connection-host','custom.host'],['connection-username','alice'],['connection-database','catalog'],['connection-port',''],['connection-port',String(port)]]) fireEvent.change(document.querySelector(`#${id}`)!,{target:{value}})
    fireEvent.click(document.querySelector('#driver-profile')!)
    const option = await screen.findByRole('option',{name:/PG JDBC v2/})
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.mouseUp(option)
    fireEvent.click(option)
    await waitFor(() => expect(document.querySelector('#driver-profile')).toHaveTextContent('PG JDBC v2'))
    expect(document.querySelector('#connection-port')).toHaveValue(port)
    expect(document.querySelector('#connection-host')).toHaveValue('custom.host')
    await saveOnly();await waitFor(()=>expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0][0]).toMatchObject({productId:'postgres',driverDefinitionId:'jdbc-postgresql',driverInstallationId:'install-pg',host:'custom.host',port,username:'alice',database:'catalog',connectionMode:'hostPort',driverPaths:[]})
  })
  it('keeps invalid explicit driver references visible and blocks connecting',()=>{
    render(<ConnectionForm connection={{id:'old',name:'Missing driver',driverType:'postgres',productId:'postgres',driverDefinitionId:'missing'}} driverDefinitions={[native]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverRefactor.missingReference'))
    expect(screen.getByRole('button',{name:i18n.t('connectionForm.testConnection')})).toBeDisabled()
  })
  it('blocks a missing explicit installation instead of silently choosing the default', () => {
    render(<ConnectionForm connection={{id:'old',name:'Missing installation',driverType:'postgres',productId:'postgres',driverDefinitionId:jdbc.id,driverInstallationId:'deleted',connectionMode:'hostPort'}} driverDefinitions={[native,jdbc]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverRefactor.missingReference'))
    expect(screen.getByRole('button',{name:i18n.t('connectionForm.testConnection')})).toBeDisabled()
  })
  it('shows the pinned installation without presenting the newer default as its version', () => {
    const pinned={...db.installations[0],id:'install-old',label:'Pinned v1'}
    useDriverStore.setState({installations:[...db.installations,pinned]})
    render(<ConnectionForm connection={{id:'old',name:'Pinned',driverType:'postgres',productId:'postgres',driverDefinitionId:jdbc.id,driverInstallationId:pinned.id,connectionMode:'hostPort'}} driverDefinitions={[native,jdbc]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('combobox',{name:i18n.t('driverRefactor.installation')})).toHaveTextContent('Pinned v1')
    expect(document.querySelector('#driver-profile')).not.toHaveTextContent('User version 2')
  })
  it('keeps a saved null installation as a repair state even when a newer default exists', () => {
    render(<ConnectionForm connection={{id:'old',name:'Uninstalled',driverType:'postgres',productId:'postgres',driverDefinitionId:jdbc.id,driverInstallationId:null,connectionMode:'hostPort'}} driverDefinitions={[native,jdbc]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.notInstalled'))
    expect(screen.getByRole('button',{name:i18n.t('connectionForm.testConnection')})).toBeDisabled()
  })
  it('preserves an explicitly enabled SSH tunnel when saving a raw URL', async () => {
    const save=vi.fn().mockResolvedValue(undefined)
    render(<ConnectionForm connection={{id:'old',name:'SSH raw',driverType:'postgres',productId:'postgres',driverDefinitionId:native.id,connectionMode:'urlOnly',connectionUrl:'postgresql://host/db',username:'alice',sshTunnel:{enabled:true,host:'bastion',port:22,username:'qa',authMethod:'privateKey',privateKeyPath:'/tmp/qa-key',remoteHost:'host',remotePort:5432,localHost:'127.0.0.1'}}} driverDefinitions={[{...native,connectionVariants:[...native.connectionVariants,{id:'urlOnly',label:'URL',requiredFields:['connectionUrl','username']}]}]} onSaveOnly={save} onSaveAndConnect={save} onTest={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('switch',{name:i18n.t('connectionForm.enableSshTunnel')})).toBeChecked()
    await saveOnly(); await waitFor(()=>expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0][0].sshTunnel).toMatchObject({enabled:true,host:'bastion',remoteHost:'host',remotePort:5432})
  })
  it('excludes planned implementations from the selectable product catalog', () => {
    render(<ConnectionForm driverDefinitions={[native,{...jdbc,id:'planned',productId:'future',name:'Future product',status:'planned'}]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('radio', {name:'Future product'})).not.toBeInTheDocument()
  })
  it('supports keyboard selection and focus in the dynamic product catalog', () => {
    const other={...jdbc,id:'only-jdbc',productId:'arbitrary',name:'Arbitrary keyboard product'}
    render(<ConnectionForm driverDefinitions={[native,other]} onSaveOnly={vi.fn()} onSaveAndConnect={vi.fn()} onTest={vi.fn()} onCancel={vi.fn()} />)
    const pg=screen.getByRole('radio',{name:'PostgreSQL'})
    pg.focus();fireEvent.keyDown(pg,{key:'ArrowRight'})
    const product=screen.getByRole('radio',{name:'Arbitrary keyboard product'})
    expect(product).toHaveFocus();expect(product).toHaveAttribute('aria-checked','true')
    fireEvent.keyDown(product,{key:'End'})
    expect(pg).toHaveFocus();expect(pg).toHaveAttribute('aria-checked','true')
  })
  it('updates the catalog store without restarting after saving definitions',async()=>{
    await act(async()=>{await useDriverStore.getState().saveDriver({...jdbc,id:'custom-second-pg',builtIn:false})})
    expect(useDriverStore.getState().drivers.filter((d)=>d.productId==='postgres')).toHaveLength(3)
  })
})
