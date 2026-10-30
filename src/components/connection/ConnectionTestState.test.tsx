import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ConnectionForm } from './ConnectionForm'
import { useDriverStore } from '@/stores/driverStore'
import { checkJdbcRuntime, validateExternalDriver } from '@/ipc/driver'
import type { DriverDefinition, DriverInstallation } from '@/types/driver'

vi.mock('@/ipc/driver', () => ({ listJdbcDownloads: vi.fn(async () => []), checkJdbcRuntime: vi.fn(async () => {}), validateExternalDriver: vi.fn(async () => ({valid:true,message:'backend class loaded'})) }))
const driver: DriverDefinition = { id:'jdbc-postgresql', productId:'postgres', name:'PostgreSQL JDBC', backend:'jdbc', driverType:'postgres', driverDialect:'postgresql', status:'configurable', builtIn:true, userDriverRequired:true, jdbcDriverClass:'org.postgresql.Driver', driverArtifacts:[], connectionVariants:[{id:'hostPort',label:'Host / port',requiredFields:['host','port','database','username']}], capabilities:{canConnect:true,canQuery:true,canStream:true,canReadMetadata:true,canCancel:true,canGenerateDdl:true} }
const installation: DriverInstallation = {id:'version-a',driverDefinitionId:driver.id,label:'User version A',javaRequirement:'21',artifacts:[{path:'/qa/driver.jar',sha256:'abc',role:'main'}]}
const connection = {id:'qa',name:'\u7528\u6237\u81ea\u5b9a\u4e49 Keep me',productId:'postgres',driverDefinitionId:driver.id,driverInstallationId:installation.id,driverType:'postgres' as const,host:'localhost',port:5432,database:'qa',username:'qa',connectionMode:'hostPort'}
function deferred() { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((yes,no) => {resolve=yes;reject=no});return {promise,resolve,reject} }
function setup(onTest = vi.fn(async () => {})) {
  const props = {connection,driverDefinitions:[driver],onTest,onSaveOnly:vi.fn(),onSaveAndConnect:vi.fn(),onCancel:vi.fn()}
  return {...render(<ConnectionForm {...props} />),props,onTest}
}
const test = () => fireEvent.click(screen.getByRole('button',{name:i18n.t('connectionForm.testConnection')}))
const change = (id:string,value:string) => fireEvent.change(document.querySelector(`#connection-${id}`)!,{target:{value}})
beforeEach(async () => {
  await i18n.changeLanguage('en')
  useDriverStore.setState({drivers:[driver],products:[{id:'postgres',name:'PostgreSQL',builtIn:true,iconKey:'postgres',adapterId:'postgresql',defaultDriverDefinitionId:driver.id}],installations:[installation],loadDrivers:vi.fn(async()=>{})})
})
it('uses the current connection test result alongside class loading and follows language without changing names',async()=>{
  setup()
  fireEvent.click(screen.getByRole('button',{name:i18n.t('jdbcDownload.checkClass')}))
  await screen.findByText(i18n.t('driverRefactor.classLoaded'))
  test()
  await waitFor(()=>expect(screen.getAllByText(i18n.t('connectionForm.connectionTestSucceeded'))).toHaveLength(2))
  expect(screen.queryByText(i18n.t('connectionForm.testNotRun'))).not.toBeInTheDocument()
  expect(screen.queryByText(i18n.t('driverRefactor.classValidationSuccess'))).not.toBeInTheDocument()
  expect(document.querySelector('#driver-profile')).not.toHaveTextContent('JDBC · JDBC')
  await act(async()=>{await i18n.changeLanguage('zh')})
  expect(screen.getAllByText(i18n.t('connectionForm.connectionTestSucceeded'))).toHaveLength(2)
  expect(document.querySelector('#connection-name')).toHaveValue(connection.name)
  expect(document.querySelector('#driver-profile')).toHaveTextContent(driver.name)
  expect(checkJdbcRuntime).toHaveBeenCalled();expect(validateExternalDriver).toHaveBeenCalled()
})
it.each([['host','other.invalid'],['port','6543'],['database','other'],['username','other'],['password','fixture']])('invalidates a completed result when %s changes',async(field,value)=>{
  setup();test();await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
  change(field,value)
  expect(screen.queryByText(i18n.t('connectionForm.connectionTestSucceeded'))).not.toBeInTheDocument()
  expect(screen.getByText(i18n.t('connectionForm.testNotRun'))).toBeVisible()
})
it('keeps a test after a presentation-only rename, but invalidates it when selected installation bytes or definition change',async()=>{
  const view=setup();test();await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
  change('name','My custom JDBC · JDBC')
  act(()=>useDriverStore.setState({installations:[{...installation,validation:{fingerprint:'receipt',checkedAt:'now',classLoaded:true}}]}))
  expect(screen.getAllByText(i18n.t('connectionForm.connectionTestSucceeded'))).toHaveLength(2)
  act(()=>useDriverStore.setState({installations:[{...installation,artifacts:[{...installation.artifacts[0],sha256:'changed'}]}]}))
  expect(screen.queryByText(i18n.t('connectionForm.connectionTestSucceeded'))).not.toBeInTheDocument()
  test();await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
  view.rerender(<ConnectionForm {...view.props} driverDefinitions={[{...driver,jdbcDriverClass:'changed.Driver'}]} />)
  expect(screen.queryByText(i18n.t('connectionForm.connectionTestSucceeded'))).not.toBeInTheDocument()
})
it.each(['resolve','reject'] as const)('ignores an old %s after edits, reverting parameters and a newer successful test',async finish=>{
  const old=deferred(),fresh=deferred();const onTest=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  setup(onTest);test();change('host','new.invalid');change('host','localhost')
  expect(screen.queryByText(i18n.t('connectionForm.testing'))).not.toBeInTheDocument()
  test();await act(async()=>fresh.resolve())
  expect(screen.getAllByText(i18n.t('connectionForm.connectionTestSucceeded'))).toHaveLength(2)
  await act(async()=>{if(finish==='resolve')old.resolve();else old.reject(new Error('obsolete failure'))})
  expect(screen.getAllByText(i18n.t('connectionForm.connectionTestSucceeded'))).toHaveLength(2)
  expect(screen.queryByText('obsolete failure')).not.toBeInTheDocument()
})
it('localizes a failed test summary and retains the backend diagnostic in expandable details',async()=>{
  setup(vi.fn().mockRejectedValue({code:'CONNECTION_FAILED',message:'Connection refused fixture',detail:'cause=connection_refused'}));test()
  await screen.findAllByText(i18n.t('driverWorkflow.errors.connection'))
  expect(screen.getByText(/Connection refused fixture/)).toBeInTheDocument()
  await act(async()=>{await i18n.changeLanguage('zh')})
  expect(screen.getAllByText(i18n.t('driverWorkflow.errors.connection'))).toHaveLength(2)
  change('host','new.invalid')
  expect(screen.queryByText(/Connection refused fixture/)).not.toBeInTheDocument()
})

it('invalidates the test when another installed version is selected',async()=>{
  act(()=>useDriverStore.setState({installations:[installation,{...installation,id:'version-b',label:'User version B'}]}))
  setup();test();await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
  fireEvent.click(screen.getByRole('combobox',{name:i18n.t('driverRefactor.installation')}))
  const option=await screen.findByRole('option',{name:'User version B'})
  fireEvent.pointerDown(option,{pointerType:'mouse'});fireEvent.mouseUp(option);fireEvent.click(option)
  expect(screen.queryByText(i18n.t('connectionForm.connectionTestSucceeded'))).not.toBeInTheDocument()
  expect(screen.getByText(i18n.t('connectionForm.testNotRun'))).toBeVisible()
  test();await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
})
it('invalidates results after SSH settings or JDBC properties change',async()=>{
  setup();test();await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
  fireEvent.click(screen.getByText(i18n.t('connectionForm.sshTunnelSection')))
  fireEvent.click(screen.getByRole('switch',{name:i18n.t('connectionForm.enableSshTunnel')}))
  expect(screen.queryByText(i18n.t('connectionForm.connectionTestSucceeded'))).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch',{name:i18n.t('connectionForm.enableSshTunnel')}));test()
  await screen.findAllByText(i18n.t('connectionForm.connectionTestSucceeded'))
  fireEvent.click(screen.getByText(i18n.t('connectionForm.advanced')))
  fireEvent.click(screen.getByRole('button',{name:i18n.t('driverRefactor.addProperty')}))
  fireEvent.change(screen.getByRole('textbox',{name:i18n.t('driverRefactor.propertyName')}),{target:{value:'applicationName'}})
  expect(screen.queryByText(i18n.t('connectionForm.connectionTestSucceeded'))).not.toBeInTheDocument()
})
