import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { checksumSourceLabel } from './workflowPresentation'
import { JdbcInstallationActions, DriverInstallationPage } from './JdbcInstallationActions'
import { useDriverStore } from '@/stores/driverStore'
import { useTaskStore } from '@/stores/taskStore'
import { checkJdbcRuntime, downloadJdbcDriver, validateExternalDriver } from '@/ipc/driver'
import { open } from '@tauri-apps/plugin-dialog'
import recipes from '@/shared/jdbc-downloads.json'
import type { DriverDefinition } from '@/types/driver'
import type { TaskInfo } from '@/types/task'

vi.mock('@/ipc/driver', async importOriginal => ({
  ...await importOriginal<typeof import('@/ipc/driver')>(), listJdbcDownloads: vi.fn(async () => recipes),
  downloadJdbcDriver: vi.fn(), checkJdbcRuntime: vi.fn(), validateExternalDriver: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
const driver: DriverDefinition = { id: 'jdbc-postgresql', productId: 'postgres', driverType: 'postgres', driverDialect: 'postgresql', name: 'PostgreSQL JDBC', backend: 'jdbc', status: 'configurable', builtIn: true, userDriverRequired: true, driverArtifacts: [], jdbcDriverClass: 'org.postgresql.Driver', connectionVariants: [{ id: 'hostPort', label: 'Host', requiredFields: ['host'] }], capabilities: { canConnect:true,canQuery:true,canStream:true,canReadMetadata:true,canCancel:true,canGenerateDdl:true } }
function task(status: TaskInfo['status']): TaskInfo { return { id:'fixture-download', kind:`driver.download:${driver.id}`, title:'PostgreSQL 42.7.14', status, progress:{current:10,total:100}, logs:[], error:status==='failed'?'Checksum verification failed':null, createdAt:'2026-10-29T00:00:00Z',updatedAt:status==='pending'?'2026-10-29T00:00:00Z':'2026-10-29T00:00:01Z' } }
async function review() { fireEvent.click(await screen.findByRole('button',{name:i18n.t('jdbcDownload.recommended',{version:'42.7.14'})})); await screen.findByText('checker-qual-3.55.1.jar'); expect(screen.getByRole('region')).toHaveTextContent('SHA-256'); }
beforeEach(() => {
  vi.clearAllMocks()
  useTaskStore.setState({ tasks:[] })
  useDriverStore.setState({ installations:[], loadDrivers:vi.fn(async () => {}), importJdbcArtifacts:vi.fn(async () => ({ ...driver, defaultInstallationId:'imported' })) })
  vi.mocked(downloadJdbcDriver).mockResolvedValue(task('pending'))
  vi.mocked(checkJdbcRuntime).mockResolvedValue(undefined)
  vi.mocked(validateExternalDriver).mockResolvedValue({valid:true,message:'Class loaded'})
})

it('previews the complete set and binds success once, even if its event arrives before IPC returns', async () => {
  let resolve!: (task: TaskInfo) => void
  vi.mocked(downloadJdbcDriver).mockReturnValue(new Promise(done => { resolve=done }))
  const installed=vi.fn()
  render(<JdbcInstallationActions driver={driver} onInstalled={installed} />)
  await review(); fireEvent.click(screen.getByRole('button',{name:i18n.t('jdbcDownload.confirm')}))
  await waitFor(()=>expect(downloadJdbcDriver).toHaveBeenCalledOnce())
  act(()=>{
    useDriverStore.setState({installations:[{id:'installation-fixture-download',driverDefinitionId:driver.id,label:'42.7.14',javaRequirement:'21',artifacts:[]}]})
    useTaskStore.getState().upsertTask(task('succeeded'))
  })
  expect(installed).not.toHaveBeenCalled()
  await act(async()=>{resolve(task('pending'))})
  await waitFor(()=>expect(installed).toHaveBeenCalledWith('installation-fixture-download'))
  expect(installed).toHaveBeenCalledOnce()
  expect(useTaskStore.getState().tasks[0].status).toBe('succeeded')
  expect(screen.getByRole('button',{name:i18n.t('driverWorkflow.complete')})).toBeEnabled()
  expect(screen.queryByRole('button',{name:i18n.t('jdbcDownload.confirm')})).not.toBeInTheDocument()
  expect(screen.getByText(i18n.t('jdbcDownload.separateChecks'))).toBeVisible()
  expect(checkJdbcRuntime).not.toHaveBeenCalled(); expect(validateExternalDriver).not.toHaveBeenCalled()
})

it('does not bind a late download to a different product or a closed form', async () => {
  let resolve!: (task: TaskInfo) => void
  vi.mocked(downloadJdbcDriver).mockReturnValue(new Promise(done => { resolve=done }))
  const old=vi.fn(),other=vi.fn()
  const view=render(<JdbcInstallationActions key={driver.id} driver={driver} onInstalled={old} />)
  await review(); fireEvent.click(screen.getByRole('button',{name:i18n.t('jdbcDownload.confirm')}))
  view.rerender(<JdbcInstallationActions key="custom" driver={{...driver,id:'custom',builtIn:false}} onInstalled={other} />)
  await act(async()=>{resolve(task('pending'));useTaskStore.getState().upsertTask(task('succeeded'))})
  expect(old).not.toHaveBeenCalled();expect(other).not.toHaveBeenCalled()
  expect(screen.queryByRole('button',{name:/42.7.14/})).not.toBeInTheDocument()
  view.unmount()
})

it.each(['failed','cancelled'] as const)('offers a reviewed retry after %s without selecting an installation',async status=>{
  useTaskStore.setState({tasks:[task(status)]})
  const installed=vi.fn();render(<DriverInstallationPage driver={driver} initialMode="download" onInstalled={installed} onBack={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByRole('region')).toHaveTextContent('42.7.14')
  fireEvent.click(await screen.findByRole('button',{name:i18n.t('jdbcDownload.retry')}))
  await waitFor(()=>expect(downloadJdbcDriver).toHaveBeenCalledWith(driver.id))
  expect(installed).not.toHaveBeenCalled()
})

it('keeps cancellation outside the scrolling preview and cancels through the existing task manager',async()=>{
  const cancel=vi.fn(async()=>{});useTaskStore.setState({tasks:[task('running')],cancel})
  render(<DriverInstallationPage driver={driver} initialMode="download" onBack={vi.fn()} onCancel={vi.fn()} />)
  const cancelButton = screen.getByRole('button',{name:i18n.t('driverWorkflow.cancelDownload')})
  expect(cancelButton.closest('footer')).not.toBeNull()
  expect(screen.getByRole('progressbar').closest('.overflow-auto')).toBeNull()
  fireEvent.click(cancelButton)
  expect(cancel).toHaveBeenCalledWith('fixture-download')
})

it('loads the selected installation class with its definition URL template, separately from connecting', async () => {
  const definition = { ...driver, urlTemplate: 'jdbc:postgresql://{host}:{port}/{database}' }
  render(<JdbcInstallationActions driver={definition} installationId="pinned-installation" />)
  fireEvent.click(screen.getByRole('button', { name: i18n.t('jdbcDownload.checkClass') }))
  await waitFor(() => expect(validateExternalDriver).toHaveBeenCalledWith({
    installationId: 'pinned-installation', driverType: driver.driverType, connectionUrl: definition.urlTemplate,
  }))
  expect(await screen.findByText(i18n.t('driverRefactor.classLoaded'))).toBeVisible()
})

it('imports the selected local dependency set in order and preserves state on file selection cancellation',async()=>{
  const installed=vi.fn();render(<DriverInstallationPage driver={{...driver,id:'custom',builtIn:false}} initialMode="local" onInstalled={installed} onBack={vi.fn()} onCancel={vi.fn()} />)
  vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce(['/fixture/main.jar','/fixture/dependency.jar'])
  fireEvent.click(screen.getByRole('button',{name:i18n.t('driverWorkflow.chooseJars')}))
  await waitFor(()=>expect(open).toHaveBeenCalledOnce())
  expect(installed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:i18n.t('driverWorkflow.chooseJars')}))
  await screen.findByText('main.jar')
  fireEvent.click(screen.getByRole('button',{name:i18n.t('driverWorkflow.installFiles')}))
  await waitFor(()=>expect(installed).toHaveBeenCalledWith('imported'))
  expect(useDriverStore.getState().importJdbcArtifacts).toHaveBeenCalledWith('custom',['/fixture/main.jar','/fixture/dependency.jar'],'')
})

it('reports missing Java separately and never claims driver/database success',async()=>{
  vi.mocked(checkJdbcRuntime).mockRejectedValue(new Error('Java runtime unavailable'))
  render(<JdbcInstallationActions driver={driver} installationId="selected" />)
  fireEvent.click(screen.getByRole('button',{name:i18n.t('jdbcDownload.checkClass')}))
  expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('driverWorkflow.errors.java'))
  expect(screen.getByText('Java runtime unavailable')).toBeInTheDocument()
  expect(validateExternalDriver).not.toHaveBeenCalled()
  expect(screen.queryByText(i18n.t('driverRefactor.classLoaded'))).not.toBeInTheDocument()
})

it('keeps the default download preview concise and exposes the full verification data on expansion',async()=>{
  const back=vi.fn()
  render(<DriverInstallationPage driver={driver} initialMode="download" onBack={back} onCancel={vi.fn()} />)
  const summary=await screen.findByText(i18n.t('jdbcDownload.details'))
  const details=summary.closest('details')!
  expect(details).not.toHaveAttribute('open')
  expect(screen.getByText(recipes[0].files[0].url)).not.toBeVisible()
  expect(screen.getByText('checker-qual-3.55.1.jar')).toBeVisible()
  expect(screen.getAllByRole('button',{name:i18n.t('driverWorkflow.back')})).toHaveLength(1)
  fireEvent.click(summary)
  expect(screen.getByText(recipes[0].files[0].url)).toBeVisible()
  expect(screen.getByText(`SHA-256: ${recipes[0].files[0].sha256}`)).toBeVisible()
  expect(screen.getByText(checksumSourceLabel(recipes[0].files[0].checksumSource,i18n.t))).toBeVisible()
  fireEvent.click(screen.getByRole('button',{name:i18n.t('driverWorkflow.back')}))
  expect(back).toHaveBeenCalledOnce()
})
