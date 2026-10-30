import { useLeaveGuard } from './useLeaveGuard'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Download, FileJson, Plus, Search, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/app-select'
import { useDriverStore } from '@/stores/driverStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { exportDriverConfiguration, importDriverConfiguration } from '@/ipc/driver'
import { normalizeAppError } from '@/ipc/client'
import { driverDisplayName } from './workflowPresentation'
import { WorkflowError } from './WorkflowError'
import type { DriverDefinition } from '@/types/driver'
import { JdbcInstallationActions, DriverInstallationPage, type InstallationMode } from './JdbcInstallationActions'
import { WorkflowHeader, WorkflowFooter } from './WorkflowPage'

type Page = 'manage' | 'product' | 'definition' | 'configuration' | InstallationMode
export type DriverWorkspaceEntry = { page: 'manage' | 'product' | InstallationMode; driverId?: string }
export interface DriverWorkspaceProps {
  entry?: DriverWorkspaceEntry
  onBack?: () => void
  onCancel?: () => void
  onUse?: (driver: DriverDefinition) => void
  onInstalled?: (driverId: string, installationId: string) => void
  registerBack?: (handler: () => void) => void
}

/** Content shared by Settings and the connection task. No dialog or settings shell. */
export function DriverWorkspace({ entry, onBack, onCancel, onUse, onInstalled, registerBack }: DriverWorkspaceProps) {
  const { t } = useTranslation()
  const { drivers, products, installations, loading, error, loadDrivers, saveDriver, deleteDriver, deleteInstallation, validateDriver } = useDriverStore()
  const connections = useConnectionStore(state => state.connections)
  const [page, setPage] = useState<Page>(entry?.page ?? 'manage')
  const [selectedId, setSelectedId] = useState(entry?.driverId ?? '')
  const [draft, setDraft] = useState<DriverDefinition>(() => newDefinition())
  const [original, setOriginal] = useState(() => JSON.stringify(newDefinition()))
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [tab, setTab] = useState<'basic' | 'files' | 'advanced'>('basic')
  const [installFrom, setInstallFrom] = useState<Page>('manage')
  const [editorFrom, setEditorFrom] = useState<Page | 'parent'>(entry?.page === 'product' ? 'parent' : 'manage')
  const lastFocus = useRef<HTMLElement | null>(null)
  const selected = drivers.find(d => d.id === selectedId)
  const dirty = (page === 'product' || page === 'definition') && JSON.stringify(draft) !== original
  const guard = useLeaveGuard(dirty)
  useEffect(() => { void loadDrivers() }, [loadDrivers])
  function restoreFocus() { queueMicrotask(() => { if (lastFocus.current?.isConnected) lastFocus.current.focus() }) }
  function goBack() {
    guard.request(() => {
      setMessage(null)
      if (page === 'product' || page === 'definition') { if (editorFrom === 'parent') onBack?.(); else setPage(editorFrom) }
      else if (page === 'configuration') setPage('manage')
      else if (selectedId && !onBack) setSelectedId('')
      else onBack?.()
      restoreFocus()
    })
  }
  // Child pages own Escape, including their unsaved-file guards and source page.
  useEffect(() => { if (page !== 'local' && page !== 'download' && page !== 'configuration') registerBack?.(goBack) })
  function edit(driver?: DriverDefinition, product = false) {
    lastFocus.current = document.activeElement as HTMLElement
    const next = driver ?? newDefinition()
    setDraft(next); setOriginal(JSON.stringify(next)); setTab('basic'); setMessage(null); setEditorFrom(page); setPage(product ? 'product' : 'definition')
  }
  async function save(use: boolean) {
    const saved = await saveDriver({ ...draft, name: draft.name.trim(), jdbcDriverClass: draft.jdbcDriverClass?.trim(), urlTemplate: draft.urlTemplate?.trim(), metadataDialectSql: draft.metadataDialectSql?.trim() || null })
    if (!saved) return
    setDraft(saved); setOriginal(JSON.stringify(saved)); setSelectedId(saved.id); setMessage(null)
    if (use && onUse) onUse(saved)
    else { setPage('manage'); restoreFocus() }
  }
  function install(mode: InstallationMode, driver: DriverDefinition) { lastFocus.current = document.activeElement as HTMLElement; setSelectedId(driver.id); setInstallFrom(page); setPage(mode) }
  const editing = page === 'product' || page === 'definition'
  if ((page === 'download' || page === 'local') && selected) return <DriverInstallationPage key={`${selected.id}:${page}`} driver={selected} initialMode={page} onInstalled={id => { onInstalled?.(selected.id, id) }} onBack={() => { if (entry?.page === page) onBack?.(); else { setPage(installFrom); restoreFocus() } }} onCancel={onCancel ?? (() => setPage('manage'))} registerBack={registerBack} />
  if (page === 'configuration') return <ConfigurationPage onBack={() => setPage('manage')} onCancel={onCancel} registerBack={registerBack} />
  const visibleDrivers = drivers.filter(d => d.backend === 'jdbc' && d.status !== 'planned' && `${d.name} ${products.find(p => p.id === d.productId)?.name ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const title = editing ? t(page === 'product' ? 'driverRefactor.addProduct' : draft.id ? 'drivers.editCustom' : 'driverWorkflow.addDefinition') : t('drivers.title')
  return <section className="workflow-page @container/driver flex h-full min-h-0 min-w-0 flex-col" aria-label={title}>
    <WorkflowHeader focus={!editing} title={title} description={editing ? t('driverWorkflow.saveFirst') : t('driverWorkflow.managerHint')} onBack={editing || onBack || selectedId ? goBack : undefined} />
    {editing ? <>
      <div role="tablist" aria-label={t('driverWorkflow.sections')} className="flex shrink-0 gap-1 border-b px-5 py-2">{(['basic', 'files', 'advanced'] as const).map(value => <Button key={value} type="button" role="tab" aria-selected={tab === value} variant={tab === value ? 'secondary' : 'ghost'} onClick={() => setTab(value)}>{t(`driverWorkflow.${value}`)}</Button>)}</div>
      <form id="driver-definition-editor" className="min-h-0 flex-1 overflow-auto p-5" onSubmit={e => { e.preventDefault(); void save(Boolean(onUse)) }}>
        <div role="tabpanel" className="grid min-w-0 gap-4">
          {tab === 'basic' && <div className="grid grid-cols-1 gap-4 @min-[480px]/driver:grid-cols-2">
            {page === 'product' || !draft.productId ? <Field label={t('driverWorkflow.databaseName')}><Input autoFocus required value={draft.newProductName ?? ''} onChange={e => setDraft(d => ({ ...d, newProductName: e.target.value }))} /></Field> : <Field label={t('driverRefactor.product')}><AppSelect disabled={Boolean(draft.id)} value={draft.productId} onValueChange={id => setDraft(d => ({ ...d, productId: id }))} options={products.map(p => ({ value: p.id, label: p.name }))} /></Field>}
            <Field label={t('driverWorkflow.driverName')}><Input autoFocus={page !== 'product' && Boolean(draft.productId)} required value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></Field>
            <Field wide label={t('drivers.driverClass')}><Input required value={draft.jdbcDriverClass ?? ''} placeholder="org.example.jdbc.Driver" onChange={e => setDraft(d => ({ ...d, jdbcDriverClass: e.target.value }))} /></Field>
            <Field wide label={t('drivers.urlTemplate')}><Input required value={draft.urlTemplate ?? ''} onChange={e => setDraft(d => ({ ...d, urlTemplate: e.target.value }))} /></Field>
            <Field label={t('driverRefactor.defaultPort')}><Input type="number" min={1} max={65535} value={draft.defaultPort ?? ''} onChange={e => setDraft(d => ({ ...d, defaultPort: e.target.value ? Number(e.target.value) : null }))} /></Field>
            <Field label={t('connectionForm.connectionType')}><AppSelect value={draft.connectionVariants[0]?.id ?? 'urlOnly'} onValueChange={mode => setDraft(d => ({ ...d, connectionVariants: [{ id: mode, label: mode, requiredFields: mode === 'file' || mode === 'urlOnly' ? ['connectionUrl'] : ['host', 'port'] }] }))} options={['urlOnly', 'hostPort', 'file'].map(mode => ({ value: mode, label: t(`driverRefactor.modes.${mode}`) }))} /></Field>
          </div>}
          {tab === 'files' && <div className="space-y-3 text-xs">{draft.id ? <><JdbcInstallationActions key={draft.id} driver={draft} onNavigate={mode => install(mode, draft)} />{installations.filter(i => i.driverDefinitionId === draft.id).map(i => <div key={i.id} className="grid gap-1 border-b py-2"><strong>{i.label}</strong><p>{t(i.validation?.classLoaded ? 'driverRefactor.classLoaded' : 'driverRefactor.filesPresent')}</p></div>)}</> : <><p>{t('driverWorkflow.notInstalled')}</p><p className="text-muted-foreground">{t('driverWorkflow.saveFirst')}</p></>}</div>}
          {tab === 'advanced' && <>
            <Field label={t('driverRefactor.dialect')}><AppSelect value={draft.driverDialect} onValueChange={value => setDraft(d => ({ ...d, driverDialect: value }))} options={['genericJdbc','postgresql','mysql','sqlite','mssql','oracle'].map(value => ({ value, label: value === 'genericJdbc' ? t('driverRefactor.unknownDialect') : value }))} /></Field>
            <div className="flex flex-wrap gap-4">{['username','database'].map(field => <label key={field} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.connectionVariants[0]?.requiredFields.includes(field) ?? false} onChange={e => setDraft(d => ({ ...d, connectionVariants: d.connectionVariants.map(v => ({ ...v, requiredFields: e.target.checked ? [...new Set([...v.requiredFields, field])] : v.requiredFields.filter(f => f !== field) })) }))} />{t(field === 'username' ? 'driverRefactor.requireUsername' : 'driverRefactor.requireDatabase')}</label>)}</div>
            <Field label={t('drivers.metadataSql')}><textarea className="ide-input min-h-40 w-full font-mono text-xs" value={draft.metadataDialectSql ?? ''} onChange={e => setDraft(d => ({ ...d, metadataDialectSql: e.target.value }))} /></Field>
          </>}
        </div>
      </form>
    </> : <>
      <div className="flex shrink-0 flex-wrap gap-2 border-b px-5 py-3">
        <Button type="button" variant="outline" onClick={() => edit(undefined, true)}><Plus />{t('driverRefactor.addProduct')}</Button>
        <Button type="button" variant="ghost" onClick={() => { setMessage(null); setPage('configuration') }}><FileJson />{t('driverRefactor.configuration')}</Button>
      </div>
      <div className="grid min-h-0 flex-1 @min-[700px]/driver:grid-cols-[15rem_minmax(0,1fr)]">
        <div className={`${selectedId ? 'hidden @min-[700px]/driver:flex' : 'flex'} min-h-0 flex-col border-r`}>
          <div className="relative m-3 shrink-0"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input aria-label={t('drivers.search')} className="pl-8" value={query} placeholder={t('drivers.search')} onChange={e => setQuery(e.target.value)} /></div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2" role="list" aria-label={t('drivers.title')}>
            {visibleDrivers.map(driver => <button type="button" role="listitem" key={driver.id} aria-current={selectedId === driver.id ? true : undefined} onClick={() => { setSelectedId(driver.id); setMessage(null); setConfirmDelete(null) }} className={`mb-1 grid w-full min-w-0 gap-1 rounded-md p-3 text-left text-xs ${selectedId === driver.id ? 'bg-accent-selected' : 'hover:bg-muted'}`}><strong className="font-medium [overflow-wrap:anywhere]">{driverDisplayName(driver, t)}</strong><span className="text-muted-foreground">{products.find(p => p.id === driver.productId)?.name} · JDBC</span></button>)}
            {visibleDrivers.length === 0 && <p className="p-3 text-xs text-muted-foreground">{t('drivers.noMatches')}</p>}
          </div>
        </div>
        <div className={`${selectedId ? 'block' : 'hidden @min-[700px]/driver:block'} min-h-0 min-w-0 overflow-auto p-5`}>
          {selected ? <div className="grid gap-5">
            <div className="grid gap-1"><h3 className="break-words text-sm font-semibold">{driverDisplayName(selected, t)}</h3><span className="text-xs text-muted-foreground">{products.find(p => p.id === selected.productId)?.name} · JDBC</span></div>
            <dl className="grid min-w-0 gap-3 text-xs"><div><dt className="text-muted-foreground">{t('drivers.driverClass')}</dt><dd className="mt-1 break-all">{selected.jdbcDriverClass}</dd></div><div><dt className="text-muted-foreground">{t('drivers.urlTemplate')}</dt><dd className="mt-1 break-all">{selected.urlTemplate}</dd></div></dl>
            <div className="flex flex-wrap gap-2">
              {!selected.builtIn && <Button type="button" variant="outline" onClick={() => edit(selected)}>{t('connection.edit')}</Button>}
              <Button type="button" variant="outline" onClick={() => edit({ ...selected, id: '', name: `${driverDisplayName(selected, t)} ${t('driverWorkflow.copySuffix')}`, builtIn: false, defaultInstallationId: null, driverArtifacts: [], newProductName: undefined })}><Copy />{t('driverRefactor.copyDefinition')}</Button>
              <Button type="button" variant="ghost" onClick={() => edit({ ...newDefinition(), productId: selected.productId })}><Plus />{t('driverWorkflow.addDefinition')}</Button>
            </div>
            <section className="grid gap-3 border-t pt-4"><h3 className="text-xs font-semibold">{t('driverWorkflow.installations')}</h3>
              <JdbcInstallationActions key={selected.id} driver={selected} onNavigate={mode => install(mode, selected)} />
              {installations.filter(i => i.driverDefinitionId === selected.id).map(i => {
                const refs = connections.filter(c => c.driverInstallationId === i.id)
                return <div key={i.id} className="grid gap-2 border-b pb-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{i.label}{i.version && i.version !== i.label ? ` · ${i.version}` : ''}</strong><span className="text-muted-foreground">{i.source ? t(`jdbcDownload.source.${i.source.kind}`) : t('driverWorkflow.unknownSource')}</span></div><p>{t(i.validation?.classLoaded ? 'driverRefactor.classLoaded' : 'driverRefactor.filesPresent')}</p>
                  <ul className="text-muted-foreground">{i.artifacts.map(a => <li key={a.path} title={a.path} className="break-words">{a.path.split(/[\\/]/).pop()}</li>)}</ul>
                  {refs.length > 0 && <p>{t('driverRefactor.references')}: {refs.map(c => c.name).join(', ')}</p>}
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { void validateDriver({ ...selected, defaultInstallationId: i.id }).then(result => setMessage(result.valid ? 'driverRefactor.classLoaded' : 'driverRefactor.classFailed')) }}>{t('jdbcDownload.checkClass')}</Button><Button type="button" variant="ghost" disabled={loading || refs.length > 0} onClick={() => { void deleteInstallation(i.id) }}>{t('common.delete')}</Button></div>
                </div>
              })}
              {!installations.some(i => i.driverDefinitionId === selected.id) && <p className="text-xs text-muted-foreground">{t('driverWorkflow.notInstalled')}</p>}
            </section>
            {!selected.builtIn && <div><Button type="button" variant="destructive" disabled={loading || connections.some(c => c.driverDefinitionId === selected.id)} onClick={() => { if (confirmDelete !== selected.id) { setConfirmDelete(selected.id); return } void deleteDriver(selected.id).then(ok => { if (ok) setSelectedId('') }) }}>{t(confirmDelete === selected.id ? 'common.confirm' : 'common.delete')}</Button></div>}
          </div> : <p className="py-12 text-center text-sm text-muted-foreground">{t('drivers.emptySelection')}</p>}
        </div>
      </div>
    </>}
    <WorkflowFooter>{guard.prompt}{message && <p role="status" className="w-full break-words text-xs">{t(message)}</p>}{error && <WorkflowError error={error} />}
      {onCancel ? <Button type="button" variant="ghost" title={t('driverWorkflow.cancelTask')} onClick={() => guard.request(onCancel)}>{t('common.cancel')}</Button> : <span />}
      <div className="ml-auto flex gap-2">
        {editing ? <><Button type="button" variant={onUse ? 'outline' : 'default'} disabled={loading || !validDraft(draft)} onClick={() => { void save(false) }}>{t('common.save')}</Button>{onUse && <Button type="button" disabled={loading || !validDraft(draft)} onClick={() => { void save(true) }}>{t('driverWorkflow.saveUse')}</Button>}</> : null}
      </div>
    </WorkflowFooter>
  </section>
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`grid min-w-0 content-start gap-1.5 text-xs ${wide ? '@min-[480px]/driver:col-span-2' : ''}`}><span className="font-medium text-muted-foreground">{label}</span>{children}</label>
}
function validDraft(d: DriverDefinition) { return Boolean(d.name.trim() && (d.productId || d.newProductName?.trim()) && d.jdbcDriverClass?.trim() && d.urlTemplate?.trim()) }
function newDefinition(): DriverDefinition {
  return { id:'',name:'',driverType:'jdbc',driverDialect:'genericJdbc',backend:'jdbc',status:'configurable',builtIn:false,userDriverRequired:true,driverArtifacts:[],jdbcDriverClass:'',urlTemplate:'jdbc:vendor://{host}:{port}/{database}',defaultPort:null,connectionVariants:[{id:'urlOnly',label:'URL only',requiredFields:['connectionUrl']}],metadataDialectSql:'',capabilities:{canConnect:true,canQuery:true,canStream:true,canReadMetadata:true,canCancel:true,canGenerateDdl:false} }
}

function ConfigurationPage({ onBack, onCancel, registerBack }: { onBack: () => void; onCancel?: () => void; registerBack?: (handler: () => void) => void }) {
  const { t } = useTranslation()
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const guard = useLeaveGuard(Boolean(json.trim()))
  useEffect(() => { registerBack?.(() => guard.request(onBack)) })
  return <section className="flex h-full min-h-0 flex-col"><WorkflowHeader focus title={t('driverRefactor.configuration')} description={t('driverRefactor.configurationHint')} onBack={() => guard.request(onBack)} />
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => fileInput.current?.click()}><Upload />{t('driverWorkflow.chooseConfiguration')}</Button><input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label={t('driverWorkflow.chooseConfiguration')} onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(setJson).catch(error => setError(normalizeAppError(error).message)) }} /><Button type="button" variant="outline" onClick={() => { void exportDriverConfiguration().then(bundle => { const href = URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'})); const link = document.createElement('a'); link.href=href; link.download='vaporlensdb-drivers.json'; link.click(); URL.revokeObjectURL(href) }).catch(error => setError(normalizeAppError(error).message)) }}><Download />{t('driverRefactor.exportConfiguration')}</Button></div>
      <label className="grid gap-2 text-xs">{t('driverRefactor.configuration')}<textarea className="ide-input min-h-44 w-full font-mono text-xs" value={json} onChange={e => setJson(e.target.value)} /></label>
      {message && <p role="status" className="break-words text-xs">{message}</p>}{error && <WorkflowError error={error} />}
    </div><WorkflowFooter>{guard.prompt}{onCancel ? <Button type="button" variant="ghost" title={t('driverWorkflow.cancelTask')} onClick={() => guard.request(onCancel)}>{t('common.cancel')}</Button> : <span />}<Button type="button" disabled={!json.trim()} onClick={() => { void (async () => { try { const count = await importDriverConfiguration(JSON.parse(json)); await Promise.all([useDriverStore.getState().loadDrivers(true),useConnectionStore.getState().loadConnections()]); setMessage(t('driverRefactor.importedConfiguration',{count})); setJson('') } catch(error) { setError(normalizeAppError(error).message) } })() }}>{t('driverRefactor.importConfiguration')}</Button></WorkflowFooter>
  </section>
}
