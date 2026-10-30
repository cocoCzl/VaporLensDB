import { useLeaveGuard } from './useLeaveGuard'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowDown, ArrowUp, Download, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { checkJdbcRuntime, downloadJdbcDriver, listJdbcDownloads, validateExternalDriver } from '@/ipc/driver'
import { normalizeAppError } from '@/ipc/client'
import { openExternalUrl } from '@/lib/openExternalUrl'
import { useDriverStore } from '@/stores/driverStore'
import { useTaskStore } from '@/stores/taskStore'
import type { DriverDefinition, JdbcDownloadRecipe } from '@/types/driver'
import { WorkflowFooter, WorkflowHeader } from './WorkflowPage'
import { checksumSourceLabel, driverDisplayName } from './workflowPresentation'
import { WorkflowError } from './WorkflowError'

export type InstallationMode = 'download' | 'local'
type ActionsProps = { driver: DriverDefinition; onInstalled?: (id: string) => void; installationId?: string | null; connectionTestStatus?: 'running' | 'succeeded' | 'failed'; showLocalImport?: boolean; onNavigate?: (mode: InstallationMode) => void }

function useJdbcInstallation(driver: DriverDefinition, onInstalled?: (id: string) => void) {
  const { t } = useTranslation()
  const [recipe, setRecipe] = useState<JdbcDownloadRecipe | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const [requested, setRequested] = useState<string | null>(null)
  const task = useTaskStore(state => state.tasks.find(task => task.kind === `driver.download:${driver.id}`))
  const installations = useDriverStore(state => state.installations)
  const active = Boolean(task && ['pending', 'running', 'cancelling'].includes(task.status))
  useEffect(() => {
    alive.current = true
    if (driver.builtIn) void listJdbcDownloads().then(recipes => {
      if (alive.current) setRecipe(recipes.find(recipe => recipe.driverDefinitionId === driver.id) ?? null)
    }).catch(error => { if (alive.current) setError(normalizeAppError(error).message) })
    return () => { alive.current = false }
  }, [driver.id, driver.builtIn])
  const bound = useRef<string | null>(null)
  useEffect(() => {
    if (task?.status === 'succeeded' && task.id === requested && bound.current !== task.id && installations.some(i => i.id === `installation-${task.id}`)) {
      bound.current = task.id
      onInstalled?.(`installation-${task.id}`)
    }
  }, [task, requested, installations, onInstalled])
  const start = async () => {
    setError(null); setBusy(true)
    try {
      const next = await downloadJdbcDriver(driver.id)
      if (alive.current) setRequested(next.id)
      useTaskStore.getState().upsertTask(next)
    } catch (error) { if (alive.current) setError(normalizeAppError(error).message) }
    finally { if (alive.current) setBusy(false) }
  }
  const importFiles = async (paths: string[], label: string) => {
    setError(null); setBusy(true)
    try {
      const saved = await useDriverStore.getState().importJdbcArtifacts(driver.id, paths, label)
      if (alive.current && saved?.defaultInstallationId) { onInstalled?.(saved.defaultInstallationId); return true }
      if (alive.current) setError(useDriverStore.getState().error ?? t('notifications.importJdbcJarFailed'))
    } catch (error) { if (alive.current) setError(normalizeAppError(error).message) }
    finally { if (alive.current) setBusy(false) }
    return false
  }
  return { recipe, busy, error, setError, task, active, start, importFiles }
}

/** Compact actions only. The containing task owns navigation and the modal. */
export function JdbcInstallationActions({ driver, onInstalled, installationId, connectionTestStatus, showLocalImport = true, onNavigate }: ActionsProps) {
  const { t } = useTranslation()
  const { recipe, error, setError } = useJdbcInstallation(driver)
  const [busy, setBusy] = useState(false)
  const [validation, setValidation] = useState<{ key: string; installationId?: string | null } | null>(null)
  const [mode, setMode] = useState<InstallationMode | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const check = async (loadClass: boolean) => {
    setBusy(true); setError(null); setValidation(null)
    try {
      await checkJdbcRuntime()
      if (alive.current) setValidation({ key: 'jdbcDownload.javaAvailable' })
      if (loadClass && installationId) {
        const result = await validateExternalDriver({ installationId, driverType: driver.driverType, connectionUrl: driver.urlTemplate })
        if (!result.valid) throw new Error(result.message)
        if (alive.current) { setValidation({ key: 'driverRefactor.classLoaded', installationId }); await useDriverStore.getState().loadDrivers(true) }
      }
    } catch (error) { if (alive.current) setError(normalizeAppError(error).message) }
    finally { if (alive.current) setBusy(false) }
  }
  if (mode) return <DriverInstallationPage driver={driver} initialMode={mode} onInstalled={onInstalled} onBack={() => setMode(null)} onCancel={() => setMode(null)} />
  const navigate = (mode: InstallationMode) => onNavigate ? onNavigate(mode) : setMode(mode)
  return <div className="grid min-w-0 gap-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      {recipe && <Button type="button" variant="outline" disabled={busy} onClick={() => navigate('download')}><Download />{t('jdbcDownload.recommended', { version: recipe.version })}</Button>}
      {showLocalImport && <Button type="button" variant="outline" disabled={busy || !driver.id} onClick={() => navigate('local')}><Upload />{t('drivers.importJar')}</Button>}
      <Button type="button" variant="ghost" disabled={busy} onClick={() => { void check(false) }}>{t('jdbcDownload.checkJava')}</Button>
      {installationId && <Button type="button" variant="ghost" disabled={busy} onClick={() => { void check(true) }}>{t('jdbcDownload.checkClass')}</Button>}
    </div>
    {validation && (!validation.installationId || validation.installationId === installationId) && <p role="status">{t(validation.key)}</p>}
    {connectionTestStatus && <p>{t(connectionTestStatus === 'succeeded' ? 'connectionForm.connectionTestSucceeded' : connectionTestStatus === 'running' ? 'connectionForm.testing' : 'driverWorkflow.errors.connection')}</p>}
    {!connectionTestStatus && installationId && <p>{t('connectionForm.testNotRun')}</p>}
    {error && <WorkflowError error={error} />}
  </div>
}

export function DriverInstallationPage({ driver, initialMode, onInstalled, onBack, onCancel, registerBack }: { driver: DriverDefinition; initialMode: InstallationMode; onInstalled?: (id: string) => void; onBack: () => void; onCancel: () => void; registerBack?: (handler: () => void) => void }) {
  const { t } = useTranslation()
  const { recipe, busy, error, setError, task, active, start, importFiles } = useJdbcInstallation(driver, onInstalled)
  const [paths, setPaths] = useState<string[]>([])
  const [label, setLabel] = useState('')
  const [imported, setImported] = useState(false)
  const installed = useDriverStore(state => state.installations.some(i => i.id === `installation-${task?.id}` && i.driverDefinitionId === driver.id))
  const guard = useLeaveGuard(initialMode === 'local' && !imported && (paths.length > 0 || Boolean(label)))
  const back = () => guard.request(onBack)
  useEffect(() => { registerBack?.(back) })
  async function chooseFiles() {
    try {
      const selected = await open({ title: t('drivers.importJar'), multiple: true, directory: false, filters: [{ name: 'JAR', extensions: ['jar'] }] })
      if (selected) { setPaths(current => [...new Set([...current, ...(Array.isArray(selected) ? selected : [selected])])]); setImported(false) }
    } catch (error) { setError(normalizeAppError(error).message) }
  }
  const move = (index: number, direction: number) => setPaths(current => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })
  return <section role="region" aria-label={t('jdbcDownload.title')} className="workflow-page flex h-full min-h-0 flex-col">
    <WorkflowHeader focus={initialMode === 'download'} title={t(initialMode === 'local' ? 'driverWorkflow.localInstall' : 'jdbcDownload.title')} description={driverDisplayName(driver, t)} onBack={back} />
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5 text-xs [overflow-wrap:anywhere]">
      {initialMode === 'download' ? recipe ? <>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{recipe.version}</strong><span className="text-muted-foreground">Java 21+</span></div>
        <p className="text-muted-foreground">{t('jdbcDownload.sourceLabel')}</p>
        <ul className="divide-y rounded-md border">{recipe.files.map(file => <li key={file.file} className="p-3"><strong>{file.file}</strong></li>)}</ul>
        <Button type="button" variant="link" className="h-auto whitespace-normal p-0 text-left text-xs" onClick={() => { void openExternalUrl(recipe.licenseUrl) }}>{recipe.license}</Button>
        <details className="space-y-3"><summary className="cursor-pointer font-medium">{t('jdbcDownload.details')}</summary>
          <p>{t(`jdbcDownload.scope.${driver.id}`)}</p>
          <p className="text-muted-foreground">{t('jdbcDownload.integrity')}</p>
          <ul className="divide-y rounded-md border">{recipe.files.map(file => <li key={file.file} className="grid gap-1 p-3"><span className="text-muted-foreground">{file.url}</span><code className="text-[11px]">SHA-256: {file.sha256}</code><span className="text-muted-foreground">{checksumSourceLabel(file.checksumSource, t)}</span></li>)}</ul>
          <p>{t('jdbcDownload.pinned')}</p>
        </details>
      </> : <p role="status">{t('common.loading')}</p> : <>
        <p className="text-muted-foreground">{t('driverWorkflow.jarHint')}</p>
        <label className="grid gap-1.5">{t('driverRefactor.versionLabel')}<Input autoFocus value={label} onChange={e => setLabel(e.target.value)} /></label>
        <Button type="button" variant="outline" disabled={busy} onClick={() => { void chooseFiles() }}><Upload />{t('driverWorkflow.chooseJars')}</Button>
        <ol className="divide-y rounded-md border">{paths.map((path, index) => <li key={path} className="flex min-w-0 items-center gap-2 p-2">
          <span className="w-5 shrink-0 text-muted-foreground">{index + 1}</span><span title={path} className="min-w-0 flex-1 break-words">{path.split(/[\\/]/).pop()}</span>
          <Button type="button" size="icon-sm" variant="ghost" disabled={index === 0 || busy} aria-label={t('driverWorkflow.moveUp')} onClick={() => move(index, -1)}><ArrowUp /></Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={index === paths.length - 1 || busy} aria-label={t('driverWorkflow.moveDown')} onClick={() => move(index, 1)}><ArrowDown /></Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label={t('drivers.removeJar')} onClick={() => setPaths(current => current.filter(p => p !== path))}><X /></Button>
        </li>)}</ol>
        {paths.length === 0 && <p className="text-muted-foreground">{t('drivers.noneImported')}</p>}
        {imported && <p role="status">{t('jdbcDownload.separateChecks')}</p>}
      </>}
      {error && <WorkflowError error={error} />}
    </div>
      {task && initialMode === 'download' && <div role="status" className="grid shrink-0 gap-1 border-t bg-muted/40 px-5 py-3 text-xs [overflow-wrap:anywhere]">
        <span>{t(`jdbcDownload.status.${task.status}`)} · {task.title}</span>
        {active && <><progress className="w-full" max={task.progress.total ?? 1} value={task.progress.current} aria-label={t('jdbcDownload.progress')} /><span>{Math.round(task.progress.current / 1024)} / {Math.round((task.progress.total ?? 0) / 1024)} KiB</span></>}
        {task.status === 'failed' && <WorkflowError error={task.error} />}
        {task.status === 'succeeded' && <p>{t('jdbcDownload.separateChecks')}</p>}
      </div>}
    <WorkflowFooter>{guard.prompt}<Button type="button" variant="ghost" title={t('driverWorkflow.cancelTask')} onClick={() => guard.request(onCancel)}>{t('common.cancel')}</Button><div className="flex gap-2">
      {active && initialMode === 'download' && <Button type="button" variant="outline" disabled={task?.status === 'cancelling'} onClick={() => { if (task) void useTaskStore.getState().cancel(task.id) }}>{t('driverWorkflow.cancelDownload')}</Button>}
      {(initialMode === 'download' && task?.status === 'succeeded' && installed) || (initialMode === 'local' && imported) ? <Button type="button" onClick={back}>{t('driverWorkflow.complete')}</Button> : initialMode === 'download' ? <Button type="button" disabled={busy || active || !recipe} onClick={() => { void start() }}>{t(task?.status === 'failed' || task?.status === 'cancelled' ? 'jdbcDownload.retry' : 'jdbcDownload.confirm')}</Button> : <Button type="button" disabled={busy || !paths.length || imported} onClick={() => { void importFiles(paths, label).then(ok => { if (ok) setImported(true) }) }}>{t('driverWorkflow.installFiles')}</Button>}
    </div></WorkflowFooter>
  </section>
}
