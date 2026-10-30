import { useLeaveGuard } from './useLeaveGuard'
import { FormEvent, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Database, Download, Plus, Search, Eye, EyeOff, MoreHorizontal, Network, PlugZap, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/ui/app-select'
import { normalizeAppError } from '@/ipc/client'
import { WorkflowError } from './WorkflowError'
import { workflowErrorSummary, driverDisplayName } from './workflowPresentation'
import { openExternalUrl } from '@/lib/openExternalUrl'
import { normalizeConnectionEndpoint } from '@/lib/connectionEndpoint'
import { normalizeConnectionUrl } from '@/lib/connectionUrlNormalization'
import { defaultConnectionName } from '@/lib/defaultConnectionName'
import { extractUrlCredentials } from '@/lib/connectionUrlCredentials'
import { supportedSslModes } from '@/lib/connectionSslModes'
import { useDriverStore } from '@/stores/driverStore'
import { WorkflowHeader } from './WorkflowPage'
import type { DriverWorkspaceEntry } from './DriverWorkspace'
import { JdbcInstallationActions } from './JdbcInstallationActions'
import { ModuleBoundary } from '@/components/common/ModuleBoundary'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig, ConnectionInput, DriverType } from '@/types/connection'
import type { DatabaseProduct, DriverDefinition } from '@/types/driver'
import type { AppError } from '@/types/error'

type ConnectionVariant = 'hostPort' | 'urlOnly' | 'oracleService' | 'oracleSid' | 'file'

type ConnectionVariantOption = {
  id: ConnectionVariant
  label: string
}

const DriverWorkspace = lazy(() => import('./DriverWorkspace').then(module => ({ default: module.DriverWorkspace })))

const ORACLE_JDBC_DOWNLOAD_URL = 'https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html'

interface ConnectionFormProps {
  connection?: ConnectionConfig | null
  loading?: boolean
  driverDefinitions?: DriverDefinition[]
  onSaveOnly: (input: ConnectionInput) => Promise<void>
  onSaveAndConnect: (input: ConnectionInput) => Promise<void>
  onTest: (input: ConnectionInput) => Promise<void>
  onCancel: () => void
  layout?: 'dialog' | 'panel'
  onDirtyChange?: (dirty: boolean) => void
  onDriverTypeChange?: (driverType: DriverType) => void
  closeRequestRef?: RefObject<(() => void) | null>
}

export function ConnectionForm({
  connection,
  driverDefinitions = [],
  loading = false,
  onSaveOnly,
  onSaveAndConnect,
  onTest,
  onCancel,
  onDirtyChange,
  onDriverTypeChange,
  closeRequestRef,
}: ConnectionFormProps) {
  const { t } = useTranslation()
  const products = useDriverStore((state) => state.products)
  const installations = useDriverStore((state) => state.installations)
  const catalogError = useDriverStore((state) => state.error)
  const catalogLoading = useDriverStore((state) => state.loading)
  const [productSearch, setProductSearch] = useState('')
  const [stage, setStage] = useState<'catalog' | 'parameters'>(connection ? 'parameters' : 'catalog')
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'common' | 'custom'>('all')
  const [pendingProduct, setPendingProduct] = useState(connection?.productId ?? connection?.driverType ?? 'postgres')
  const [auxiliary, setAuxiliary] = useState<DriverWorkspaceEntry | null>(null)
  const [dirty, setDirty] = useState(false)
  const guard = useLeaveGuard(dirty)
  const auxiliaryBack = useRef<(() => void) | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const markDirty = () => { setDirty(true); onDirtyChange?.(true) }
  const cancel = () => guard.request(onCancel)
  const openPage = (entry: DriverWorkspaceEntry) => { returnFocus.current = document.activeElement as HTMLElement; setAuxiliary(entry) }
  const returnToForm = () => { setAuxiliary(null); queueMicrotask(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus() }) }
  useEffect(() => {
    if (closeRequestRef) closeRequestRef.current = () => { if (auxiliary) auxiliaryBack.current?.(); else cancel() }
    return () => { if (closeRequestRef) closeRequestRef.current = null }
  })
  const productDrafts = useRef(new Map<string, { form: ConnectionInput; explicit: Set<keyof ConnectionInput>; variant: ConnectionVariant; generated: boolean; group: string }>())
  const driverProperties = useRef(new Map<string, ConnectionInput['driverProperties']>())
  const [explicitFields, setExplicitFields] = useState<Set<keyof ConnectionInput>>(() => new Set(connection ? ['host', 'port', 'database', 'username', 'connectionUrl'] : []))
  const dataSourceGroups = useConnectionStore((state) => state.dataSourceGroups)
  const initialUrlCredentials = extractUrlCredentials(connection?.connectionUrl ?? '')
  const [form, setForm] = useState<ConnectionInput>({
    id: connection?.id,
    driverProperties: connection?.driverProperties ?? [],
    productId: connection?.productId ?? connection?.driverType ?? 'postgres',
    driverInstallationId: connection?.driverInstallationId ?? null,
    connectionMode: connection?.connectionMode ?? null,
    name: connection?.name ?? defaultConnectionName('postgres'),
    driverDefinitionId: connection?.driverDefinitionId ?? connection?.driverType ?? 'postgres',
    driverType: connection?.driverType ?? 'postgres',
    driverDialect: connection?.driverDialect ?? connection?.driverType ?? 'postgresql',
    host: connection?.host ?? 'localhost',
    port: connection?.port ?? 5432,
    database: connection?.database ?? '',
    connectionUrl: initialUrlCredentials.connectionUrl,
    username: initialUrlCredentials.username ?? connection?.username ?? '',
    password: initialUrlCredentials.password ?? '',
    savePassword: connection?.hasSavedPassword ?? true,
    driverClass: connection?.driverClass ?? '',
    driverPaths: connection?.driverPaths ?? [],
    sslMode: connection?.sslMode ?? '',
    group: connection?.group ?? '',
    colorTag: connection?.colorTag ?? '',
    sshTunnel: connection?.sshTunnel
      ? { ...connection.sshTunnel, password: '', privateKeyPassphrase: '' }
      : {
          enabled: false,
          host: '',
          port: 22,
          username: '',
          authMethod: 'privateKey',
          password: '',
          privateKeyPath: '',
          privateKeyPassphrase: '',
          remoteHost: '',
          remotePort: null,
          localHost: '127.0.0.1',
        },
  })
  const [message, setMessage] = useState<string | null>(null)
  const [messageDetail, setMessageDetail] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ key: string; status: 'running' | 'succeeded' | 'failed'; error?: AppError; input: ConnectionInput } | null>(null)
  const testGeneration = useRef(0)
  const [nameIsGenerated, setNameIsGenerated] = useState(!connection)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [groupSelection, setGroupSelection] = useState(connection?.groupId ?? '')
  const [connectionVariant, setConnectionVariant] = useState<ConnectionVariant>(
    (connection?.connectionMode as ConnectionVariant) ?? (connection?.connectionUrl && connection.driverType !== 'sqlite' ? 'urlOnly' : defaultConnectionVariant(connection?.driverType ?? 'postgres')),
  )
  const selectableDrivers = driverDefinitions.length ? driverDefinitions.filter((driver) => driver.status !== 'planned').sort(compareDriverChoices) : []
  const selectedDriver = driverDefinitions.find((driver) => driver.id === form.driverDefinitionId)
  const driverProfile = localizedProfile(profileForDriver(form.driverType, selectedDriver), form.driverType, t)
  if (!selectedDriver || selectedDriver.builtIn) driverProfile.connectionVariants = driverProfile.connectionVariants.map(v => ({ ...v, label: t(`driverRefactor.modes.${v.id}`, { defaultValue: v.label }) }))
  const sslModes = selectedDriver?.backend === 'jdbc' ? (form.sslMode ? ['', form.sslMode] : ['']) : supportedSslModes(form.driverType, form.sslMode)
  const installationId = form.driverInstallationId
  const missingInstallation = selectedDriver?.backend === 'jdbc' && (!installationId || !installations.some((i) => i.id === installationId && i.driverDefinitionId === selectedDriver.id))
  const missingReference = (driverDefinitions.length > 0 && !selectedDriver) || Boolean(installationId && missingInstallation)
  const readinessIssue = missingReference ? t('driverRefactor.missingReference') : missingInstallation ? t('driverWorkflow.notInstalled') : connectionReadinessIssue(form, driverProfile, selectedDriver, t)
  const runtimeCapabilityUnavailable = !selectedDriver?.capabilities.canConnect || Boolean(readinessIssue)
  const databaseTypes = databaseTypeOptions(selectableDrivers, products)
  const filteredDatabaseTypes = databaseTypes.filter(p => p.label.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase()) && (catalogFilter === 'all' || (catalogFilter === 'common' ? p.builtIn && p.defaultDriver.backend === 'nativeRust' : !p.builtIn)))
  const activeDatabaseType = databaseTypes.find((option) => option.productId === form.productId)
  const driverVariants = activeDatabaseType?.drivers ?? []
  const availableInstallations = installations.filter((installation) => installation.driverDefinitionId === form.driverDefinitionId)

  const activeConnectionVariant = driverProfile.connectionVariants.some(
    (variant) => variant.id === connectionVariant,
  )
    ? connectionVariant
    : driverProfile.connectionVariants[0].id
  const isUrlOnly = activeConnectionVariant === 'urlOnly'
  // Include the selected definition and installation bytes, not only their IDs.
  // Presentation fields do not affect what the backend actually tests.
  const testParameters = { ...normalizeInput(form, activeConnectionVariant, driverProfile, selectedDriver), name: undefined, group: undefined, groupId: undefined, colorTag: undefined }
  const testedInstallation = installations.find(i => i.id === installationId)
  const testKey = JSON.stringify([testParameters, selectedDriver && { id: selectedDriver.id, backend: selectedDriver.backend, implementation: selectedDriver.nativeImplementationId, metadataDialectSql: selectedDriver.metadataDialectSql }, testedInstallation && { id: testedInstallation.id, definition: testedInstallation.driverDefinitionId, version: testedInstallation.version, artifacts: testedInstallation.artifacts, java: testedInstallation.javaRequirement }])
  const [testDraftKey, setTestDraftKey] = useState(testKey)
  if (testDraftKey !== testKey) { setTestDraftKey(testKey); setTestResult(null) }
  useLayoutEffect(() => {
    testGeneration.current += 1
    return () => { testGeneration.current += 1 }
  }, [testKey])
  const currentTest = testResult?.key === testKey ? testResult : null
  const testMessage = currentTest ? currentTest.status === 'failed'
    ? workflowErrorSummary(currentTest.error!, t, 'connection')
    : t(currentTest.status === 'succeeded' ? 'connectionForm.connectionTestSucceeded' : 'connectionForm.testing') : null
  const testDetail = currentTest?.error ? formatConnectionErrorDetail(currentTest.error, currentTest.input, t) : null

  const update = (key: keyof ConnectionInput, value: string | number | string[] | boolean | null) => {
    markDirty()
    setExplicitFields((current) => new Set([...current, key]))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateConnectionUrl = (value: string) => {
    const extracted = extractUrlCredentials(value)
    markDirty()
    setForm((current) => ({
      ...current,
      connectionUrl: extracted.connectionUrl,
      username: extracted.username ?? current.username,
      password: extracted.password ?? current.password,
    }))
    if (extracted.username || extracted.password) setMessage(t('connectionForm.urlCredentialsExtracted'))
  }

  const updateSshTunnel = (key: string, value: string | number | boolean | null) => {
    markDirty()
    setForm((current) => ({
      ...current,
      sshTunnel: {
        enabled: false,
        host: '',
        port: 22,
        username: '',
        authMethod: 'privateKey',
        password: '',
        privateKeyPath: '',
        privateKeyPassphrase: '',
        remoteHost: '',
        remotePort: null,
        localHost: '127.0.0.1',
        ...current.sshTunnel,
        [key]: value,
      },
    }))
  }

  const changeDriver = (driverDefinitionId: string, provided?: DriverDefinition) => {
    const definition = provided ?? driverDefinitions.find((driver) => driver.id === driverDefinitionId)
    // A selector can outlive its catalogue during an asynchronous refresh. Never
    // interpret an empty/stale definition ID as a registered native driver type.
    if (!definition && !FALLBACK_DRIVER_OPTIONS.some(driver => driver.id === driverDefinitionId)) return
    markDirty()
    const driverType = definition?.driverType ?? (driverDefinitionId as DriverType)
    const profile = profileForDriver(driverType, definition)
    const productId = definition?.productId || driverType
    const sameProduct = productId === form.productId
    const nextVariant = sameProduct && profile.connectionVariants.some((v) => v.id === connectionVariant) ? connectionVariant : profile.connectionVariants[0].id
    onDriverTypeChange?.(driverType)
    setConnectionVariant(nextVariant)
    if (sameProduct && (form.driverProperties?.length || form.driverPaths?.length || form.driverClass || form.sslMode)) setMessage(t('driverRefactor.driverChanged'))
    if (sameProduct) driverProperties.current.set(form.driverDefinitionId ?? '', form.driverProperties)
    else productDrafts.current.set(form.productId ?? form.driverType, { form, explicit: explicitFields, variant: connectionVariant, generated: nameIsGenerated, group: groupSelection })
    const previous = !sameProduct ? productDrafts.current.get(productId) : undefined
    if (previous) {
      setForm(previous.form); setExplicitFields(previous.explicit); setConnectionVariant(previous.variant); setNameIsGenerated(previous.generated); setGroupSelection(previous.group); setPasswordVisible(false); setMessage(null); setMessageDetail(null)
      return
    }
    if (!sameProduct) { setExplicitFields(new Set()); setNameIsGenerated(true); setGroupSelection(''); setPasswordVisible(false); setMessage(null); setMessageDetail(null) }
    setForm((current) => ({
      ...current,
      id: sameProduct ? current.id : undefined,
      productId,
      driverDefinitionId: definition?.id ?? driverType,
      driverInstallationId: definition?.defaultInstallationId ?? null,
      connectionMode: nextVariant,
      driverType,
      driverDialect: definition?.driverDialect ?? driverType,
      // A just-saved product may precede this render's catalogue snapshot.
      name: sameProduct ? current.name : useDriverStore.getState().products.find((p) => p.id === productId)?.name ?? profile.defaultName,
      port: sameProduct && explicitFields.has('port') ? current.port : profile.defaultPort,
      host: sameProduct ? current.host : 'localhost',
      database: sameProduct ? current.database : profile.defaultDatabase,
      username: sameProduct ? current.username : profile.defaultUsername,
      password: sameProduct ? current.password : '',
      savePassword: sameProduct ? current.savePassword : true,
      sshTunnel: sameProduct ? current.sshTunnel : null,
      connectionUrl: sameProduct && nextVariant === connectionVariant && (nextVariant === 'urlOnly' || nextVariant === 'file') ? current.connectionUrl : '',
      driverClass: profile.driverClass ?? '',
      driverPaths: [],
      driverProperties: sameProduct ? driverProperties.current.get(definition?.id ?? '') ?? [] : [],
      sslMode: sameProduct ? current.sslMode : null,
    }))
  }

  const enterParameters = () => {
    const choice = filteredDatabaseTypes.find(option => option.productId === pendingProduct)
    if (!choice) return
    if (pendingProduct !== form.productId || !selectedDriver) changeDriver(choice.defaultDriver.id)
    setStage('parameters')
  }

  const selectedGroup = dataSourceGroups.find((group) => group.id === groupSelection)?.name ?? ''
  const normalizedForm = () => normalizeInput({
    ...form,
    groupId: groupSelection || null,
    group: selectedGroup.trim() || null,
  }, activeConnectionVariant, driverProfile, selectedDriver)

  const normalizeHostAndPort = () => {
    const endpoint = normalizeConnectionEndpoint(form.host, form.port)
    if (endpoint.host === form.host && endpoint.port === form.port) return
    markDirty()
    if (endpoint.port !== form.port) setExplicitFields(current => new Set([...current, 'port']))
    setForm((current) => ({ ...current, host: endpoint.host, port: endpoint.port }))
  }

  const validate = (requireExternalDriver: boolean) => {
    if (requireExternalDriver && missingReference) return t('driverRefactor.missingReference')
    return validateRequiredFields(form, activeConnectionVariant, {
      requireExternalDriver,
      profile: driverProfile,
      definition: selectedDriver,
    }, t)
  }

  const selectGroup = (value: string) => {
    markDirty()
    setGroupSelection(value)
    update('group', dataSourceGroups.find((group) => group.id === value)?.name ?? '')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (stage === 'catalog') { enterParameters(); return }
    setMessage(null)
    setMessageDetail(null)
    const validationError = validate(true)
    if (validationError) {
      setMessage(validationError)
      return
    }
    await onSaveAndConnect(normalizedForm())
    onDirtyChange?.(false)
  }

  const saveOnly = async () => {
    setMessage(null)
    setMessageDetail(null)
    const validationError = validate(false)
    if (validationError) {
      setMessage(validationError)
      return
    }
    await onSaveOnly(normalizedForm())
    onDirtyChange?.(false)
  }

  const test = async () => {
    setMessage(null)
    setMessageDetail(null)
    const validationError = validate(true)
    if (validationError) {
      setMessage(validationError)
      return
    }

    const input = normalizeInput(form, activeConnectionVariant, driverProfile, selectedDriver)
    const generation = ++testGeneration.current
    setTestResult({ key: testKey, status: 'running', input })
    try {
      await onTest(input)
      if (generation === testGeneration.current) setTestResult({ key: testKey, status: 'succeeded', input })
    } catch (error) {
      if (generation === testGeneration.current) setTestResult({ key: testKey, status: 'failed', error: normalizeAppError(error), input })
    }
  }

  return (
    <div className="h-full min-h-0 min-w-0">
    <div hidden={Boolean(auxiliary)} className="h-full min-h-0">
    <form
      className="connection-form @container/form flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      autoComplete="off"
      onSubmit={submit}
    >
      <WorkflowHeader title={connection ? t('connection.editTitle') : stage === 'catalog' ? t('connectionCatalog.title') : t('driverWorkflow.parameters')} description={stage === 'catalog' ? t('driverWorkflow.catalogHint') : undefined} />
      <div className={`min-h-0 flex-1 ${stage === 'catalog' ? 'overflow-hidden' : 'overflow-y-auto'} overflow-x-hidden [scrollbar-gutter:stable]`}>
        <div className={`mx-auto ${stage === 'catalog' ? 'flex h-full min-h-0 flex-col' : 'grid'} w-full gap-4 p-5`}>
          {stage === 'catalog' ? <section className="flex h-full min-h-0 flex-col gap-4" aria-label={t('connectionCatalog.title')}>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-40 flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" disableTextAssistance aria-label={t('driverRefactor.searchProducts')} placeholder={t('driverRefactor.searchProducts')} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} /></div>
              <Button type="button" variant="outline" onClick={() => openPage({ page: 'product' })}><Plus />{t('driverRefactor.addProduct')}</Button>
            </div>
            <div role="group" aria-label={t('connectionCatalog.filter')} className="flex flex-wrap gap-2">
              {(['common', 'all', 'custom'] as const).map(filter => <Button key={filter} type="button" size="sm" variant={catalogFilter === filter ? 'secondary' : 'ghost'} aria-pressed={catalogFilter === filter} onClick={() => setCatalogFilter(filter)}>{t(`connectionCatalog.${filter}`)}</Button>)}
            </div>
            {catalogLoading && <p role="status">{t('common.loading')}</p>}
            {catalogError && <div><WorkflowError error={catalogError} /><Button type="button" size="sm" variant="outline" onClick={() => { void useDriverStore.getState().loadDrivers(true) }}>{t('app.retryView')}</Button></div>}
            {!catalogLoading && filteredDatabaseTypes.length === 0 && <p role="status">{t('connectionCatalog.empty')}</p>}
            {filteredDatabaseTypes.length > 0 && <DatabaseTypeSelector
              options={filteredDatabaseTypes}
              selectedDriverType={pendingProduct}
              onChange={setPendingProduct}
              t={t}
            />}
          </section> : <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex min-w-0 items-center gap-2"><DatabaseVendorIcon driverType={form.driverType} className="size-6 shrink-0" /><span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{activeDatabaseType?.label ?? form.productId ?? form.driverType}</span></div>
            {!connection && <Button type="button" size="sm" variant="outline" onClick={() => { setPendingProduct(form.productId ?? form.driverType); setStage('catalog') }}>{t('connectionCatalog.change')}</Button>}
          </div>

          <div className="grid gap-3 rounded-md bg-muted/25 p-3">
              {driverVariants.length > 0 && (
                <FormRow label={t('connectionForm.driver')}>
                  <AppSelect
                    id="driver-profile"
                    value={selectedDriver?.id ?? form.driverType}
                    onValueChange={changeDriver}
                    options={driverVariants.map((driver) => ({
                      value: driver.id,
                      label: `${driverProfileOptionLabel(driver, t)}${activeDatabaseType?.defaultDriver.id === driver.id ? ` · ${t('connectionForm.recommended')}` : ''}`,
                    }))}
                  />
                </FormRow>
              )}

            {(missingReference || missingInstallation) && <p role="alert" className="text-xs text-warning-foreground">{t(missingInstallation && !installationId ? 'driverWorkflow.notInstalled' : 'driverRefactor.missingReference')}</p>}
            {selectedDriver?.backend === 'jdbc' && <FormRow label={t('driverRefactor.installation')}>
              <AppSelect aria-label={t('driverRefactor.installation')} value={installationId ?? ''} onValueChange={(id) => update('driverInstallationId', id || null)} options={[{ value: '', label: t('driverRefactor.chooseInstallation') }, ...availableInstallations.map((i) => ({ value: i.id, label: i.label }))]} />
            </FormRow>}
            {selectedDriver?.backend === 'jdbc' && <div className="grid gap-2"><JdbcInstallationActions key={selectedDriver.id} driver={selectedDriver} installationId={installationId} connectionTestStatus={currentTest?.status} onNavigate={page => openPage({ page, driverId: selectedDriver.id })} /><Button type="button" variant="ghost" className="w-fit" onClick={() => openPage({ page: 'manage', driverId: selectedDriver.id })}>{t('driverRefactor.manage')}</Button></div>}

          </div>

          <section className="grid gap-3 pt-0.5">
            <div className="grid gap-1.5">
              <SectionLabel htmlFor="connection-name">{t('connectionForm.name')}</SectionLabel>
              <Input autoFocus id="connection-name" value={form.name} disableTextAssistance onChange={(event) => {
                setNameIsGenerated(false)
                update('name', event.target.value)
              }} required />
            </div>

            {activeConnectionVariant === 'file' ? (
              <div className="grid gap-1.5">
                <SectionLabel htmlFor="connection-url">{t('connectionForm.connectionUrl')}</SectionLabel>
                <Input id="connection-url" value={form.connectionUrl ?? ''} placeholder={driverProfile.urlPlaceholder} disableTextAssistance onChange={(event) => updateConnectionUrl(event.target.value)} required />
              </div>
            ) : null}
            {(activeConnectionVariant !== 'file' || selectedDriver?.connectionVariants.find((v) => v.id === activeConnectionVariant)?.requiredFields.includes('username')) && (
              <>
                {activeConnectionVariant === 'file' ? null : isUrlOnly ? (
                  <div className="grid gap-1.5">
                    <SectionLabel htmlFor="connection-url">{t('connectionForm.connectionUrl')}</SectionLabel>
                    <Input id="connection-url" value={form.connectionUrl ?? ''} placeholder={driverProfile.urlPlaceholder} disableTextAssistance onChange={(event) => updateConnectionUrl(event.target.value)} required />
                    <p className="text-[11px] text-muted-foreground">{t('connectionForm.urlCredentialsWarning')}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-4">
                    <div className="grid gap-1.5">
                      <SectionLabel htmlFor="connection-host">{t('connectionForm.host')}</SectionLabel>
                      <Input id="connection-host" value={form.host ?? ''} disableTextAssistance onChange={(event) => update('host', event.target.value)} onBlur={normalizeHostAndPort} required />
                    </div>
                    <div className="grid gap-1.5">
                      <SectionLabel htmlFor="connection-port">{t('connectionForm.port')}</SectionLabel>
                      <Input id="connection-port" type="number" value={form.port ?? 5432} disableTextAssistance onChange={(event) => update('port', Number(event.target.value))} required />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 items-start gap-4 @min-[600px]/form:grid-cols-2">
                  <div className="grid gap-1.5">
                    <SectionLabel htmlFor="connection-username">{t('connectionForm.user')}</SectionLabel>
                    <Input id="connection-username" value={form.username ?? ''} disableTextAssistance onChange={(event) => update('username', event.target.value)} required={selectedDriver ? selectedDriver.connectionVariants.find((v) => v.id === activeConnectionVariant)?.requiredFields.includes('username') : requiresUsername(form.driverType)} />
                  </div>
                  <div className="grid gap-1.5">
                    <SectionLabel htmlFor="connection-password">{t('connectionForm.password')}</SectionLabel>
                    <div className="relative">
                      <Input id="connection-password" type={passwordVisible ? 'text' : 'password'} value={form.password ?? ''} placeholder={connection ? t('common.hidden') : ''} className="pr-8" disableTextAssistance onChange={(event) => update('password', event.target.value)} />
                      <Button type="button" size="icon-xs" variant="ghost" className="absolute inset-y-1 right-1" aria-label={passwordVisible ? t('connectionForm.hidePassword') : t('connectionForm.showPassword')} onClick={() => setPasswordVisible((visible) => !visible)}>
                        {passwordVisible ? <EyeOff /> : <Eye />}
                      </Button>
                    </div>
                    <label className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" role="switch" className="h-4 w-7 cursor-pointer appearance-none rounded-full bg-muted p-0.5 transition-colors checked:bg-primary before:block before:size-3 before:rounded-full before:bg-card before:transition-transform checked:before:translate-x-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" checked={form.savePassword ?? true} onChange={(event) => update('savePassword', event.target.checked)} />
                      <span>{t('connectionForm.savePassword')}</span>
                      <span className="text-[11px]">{t('connectionForm.storedSecurely')}</span>
                    </label>
                  </div>
                </div>

                {!isUrlOnly && activeConnectionVariant !== 'file' && (
                  <div className="grid gap-1.5">
                    <SectionLabel htmlFor="connection-database">{databaseFieldLabel(activeConnectionVariant, t)}</SectionLabel>
                    <Input id="connection-database" value={form.database ?? ''} disableTextAssistance onChange={(event) => update('database', event.target.value)} required={selectedDriver ? selectedDriver.connectionVariants.find((v) => v.id === activeConnectionVariant)?.requiredFields.includes('database') : requiresDatabase(form.driverType)} />
                  </div>
                )}
              </>
            )}
          </section>

          {((!isUrlOnly && activeConnectionVariant !== 'file') || form.sshTunnel?.enabled) && (
            <DisclosureSection title={t('connectionForm.sshTunnelSection')} icon={<Network />} defaultOpen={Boolean(form.sshTunnel?.enabled)}>
              <div className="grid gap-3 pt-3">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" role="switch" className="h-4 w-7 cursor-pointer appearance-none rounded-full bg-muted p-0.5 transition-colors checked:bg-primary before:block before:size-3 before:rounded-full before:bg-card before:transition-transform checked:before:translate-x-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" checked={Boolean(form.sshTunnel?.enabled)} onChange={(event) => updateSshTunnel('enabled', event.target.checked)} />
                  {t('connectionForm.enableSshTunnel')}
                </label>
                {form.sshTunnel?.enabled && <SshTunnelFields form={form} connection={connection} updateSshTunnel={updateSshTunnel} t={t} />}
              </div>
            </DisclosureSection>
          )}

          {activeConnectionVariant !== 'file' && (
            <DisclosureSection title={t('connectionForm.sslSection')} icon={<ShieldCheck />} defaultOpen={Boolean(form.sslMode)}>
              <div className="pt-3">
                <FormRow label={t('connectionForm.sslMode')}>
                  <AppSelect value={form.sslMode ?? ''} onValueChange={(value) => update('sslMode', value || null)} options={sslModes.map((value) => ({ value, label: value || t('common.default') }))} />
                </FormRow>
              </div>
            </DisclosureSection>
          )}

          <DisclosureSection title={t('connectionForm.advanced')} icon={<SlidersHorizontal />}>
            <div className="grid gap-3 pt-3">
              {driverProfile.connectionVariants.length > 1 && (
                <FormRow label={t('connectionForm.connectionType')}>
                  <SegmentedControl options={driverProfile.connectionVariants} value={activeConnectionVariant} onChange={(value) => { markDirty(); setConnectionVariant(value) }} />
                </FormRow>
              )}
              <FormRow label={t('connectionForm.group')}>
                <AppSelect id="connection-group" value={groupSelection} onValueChange={selectGroup} options={[{ value: '', label: t('connectionForm.ungrouped') }, ...dataSourceGroups.map((group) => ({ value: group.id, label: group.name }))]} />
              </FormRow>
              {!isUrlOnly && driverProfile.usesUrl && activeConnectionVariant !== 'file' && (
                <FormRow label={t('connectionForm.connectionUrl')}>
                  <Input id="generated-connection-url" value={driverProfile.defaultUrl(form, activeConnectionVariant)} placeholder={driverProfile.urlPlaceholder} disableTextAssistance readOnly />
                </FormRow>
              )}
              {driverProfile.externalDriver && (
                <>
                  <FormRow label={t('connectionForm.driverClass')}>
                    <Input readOnly id="driver-class" value={selectedDriver?.jdbcDriverClass ?? form.driverClass ?? ''} placeholder={driverProfile.driverClass} disableTextAssistance onChange={(event) => update('driverClass', event.target.value)} />
                  </FormRow>
                  <FormRow label={t('connectionForm.driverFiles')}>
                    <Input readOnly id="driver-paths" value={availableInstallations.find((i) => i.id === installationId)?.artifacts.map((a) => a.path).join('\n') ?? ''} placeholder={driverArtifactPathPlaceholder(selectedDriver?.driverArtifact)} disableTextAssistance onChange={(event) => update('driverPaths', event.target.value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean))} />
                  </FormRow>
                </>
              )}

              {selectedDriver?.backend === 'jdbc' && <div className="grid gap-2">
                <SectionLabel>{t('driverRefactor.properties')}</SectionLabel>
                {(form.driverProperties ?? []).map((property, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[600px]/form:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
                  <Input disableTextAssistance aria-label={t('driverRefactor.propertyName')} value={property.name} onChange={(e) => { markDirty(); setForm((f) => ({ ...f, driverProperties: f.driverProperties?.map((p,i) => i === index ? { ...p, name: e.target.value } : p) })) }} />
                  <Input disableTextAssistance aria-label={t('driverRefactor.propertyValue')} type={property.sensitive ? 'password' : 'text'} value={property.value ?? ''} placeholder={property.hasSavedValue ? t('common.hidden') : ''} onChange={(e) => { markDirty(); setForm((f) => ({ ...f, driverProperties: f.driverProperties?.map((p,i) => i === index ? { ...p, value: e.target.value } : p) })) }} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={property.sensitive} onChange={(e) => setForm((f) => ({ ...f, driverProperties: f.driverProperties?.map((p,i) => i === index ? { ...p, sensitive: e.target.checked } : p) }))} />{t('driverRefactor.sensitive')}</label>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setForm((f) => ({ ...f, driverProperties: f.driverProperties?.filter((_,i) => i !== index) }))}>{t('common.delete')}</Button>
                </div>)}
                <Button type="button" size="xs" variant="outline" onClick={() => setForm((f) => ({ ...f, driverProperties: [...(f.driverProperties ?? []), { name: '', value: '', sensitive: true }] }))}>{t('driverRefactor.addProperty')}</Button>
              </div>}
              <DriverSupportSummary driver={selectedDriver} profile={driverProfile} input={form} readinessIssue={readinessIssue} t={t} />
            </div>
          </DisclosureSection>
          </>}
        </div>
      </div>

      <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/75 bg-surface px-6 py-2">
        {guard.prompt}
        {stage === 'catalog' ? <><Button type="button" variant="ghost" onClick={cancel}>{t('common.cancel')}</Button><Button type="button" onClick={enterParameters} disabled={!filteredDatabaseTypes.some(option => option.productId === pendingProduct)}>{t('connectionCatalog.next')}</Button></> : <>
        <Button type="button" variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
        <div className="min-w-0 flex-1 text-xs text-muted-foreground" role={testMessage || message ? 'status' : undefined}>
          <span className={testMessage || message ? 'text-foreground' : undefined}>{testMessage ?? message ?? readinessIssue ?? ' '}</span>
          {(testDetail || messageDetail) && <details className="mt-1 text-[11px]"><summary className="cursor-pointer">{t('connectionForm.errorDetails')}</summary><pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap font-sans">{testDetail ?? messageDetail}</pre></details>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" className="h-9 px-3" onClick={test} disabled={loading || currentTest?.status === 'running' || runtimeCapabilityUnavailable}><PlugZap />{t('connectionForm.testConnection')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="icon" variant="ghost" aria-label={t('common.moreActions')}><MoreHorizontal /></Button>} />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={saveOnly} disabled={loading}>{t('connectionForm.saveOnly')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="submit" className="h-9 px-3" title={t('connectionForm.saveAndConnect')} disabled={loading || Boolean(readinessIssue) || runtimeCapabilityUnavailable}><Database />{t('connection.connect')}</Button>
        </div>
        </>}
      </div>

    </form>
    </div>
    {auxiliary && <ModuleBoundary><Suspense fallback={<p role="status" className="p-5">{t('common.loading')}</p>}><DriverWorkspace entry={auxiliary} registerBack={handler => { auxiliaryBack.current = handler }} onBack={returnToForm} onCancel={() => { setAuxiliary(null); cancel() }} onUse={driver => { changeDriver(driver.id, driver); setStage('parameters'); setAuxiliary(null); queueMicrotask(() => document.querySelector<HTMLInputElement>('#connection-name')?.focus()) }} onInstalled={(driverId, id) => { if (!connection && form.driverDefinitionId === driverId && !form.driverInstallationId) update('driverInstallationId', id) }} /></Suspense></ModuleBoundary>}
    </div>
  )
}

function formatConnectionErrorDetail(error: AppError, input: ConnectionInput, t: TFunction) {
  const lines = [error.message, ...(error.detail?.split(/\r?\n|;\s*/).filter(Boolean) ?? [])]
  if (input.host?.trim()) {
    const endpoint = input.port ? `${input.host.trim()}:${input.port}` : input.host.trim()
    const driverIndex = lines.findIndex((line) => line.startsWith('driver='))
    lines.splice(driverIndex >= 0 ? driverIndex + 1 : 0, 0, `endpoint=${endpoint}`)
  }

  if (/no route to host/i.test(error.message)) {
    if (!lines.includes('phase=tcp_connect')) lines.push('phase=tcp_connect')
    if (!lines.includes('cause=no_route_to_host')) lines.push('cause=no_route_to_host')
    lines.push('', t('connectionForm.noRouteToHostHint'))
  }

  return lines.length ? lines.join('\n') : null
}

function FormRow({
  label,
  children,
  align = 'center',
  labelClassName,
}: {
  label: string
  children: ReactNode
  align?: 'center' | 'start'
  labelClassName?: string
}) {
  return (
    <div className={`grid grid-cols-1 @min-[480px]/form:grid-cols-[104px_minmax(0,1fr)] gap-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <Label className={`@min-[480px]/form:text-right text-xs ${labelClassName ?? ''}`}>{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function SectionLabel({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor?: string
}) {
  return <Label htmlFor={htmlFor} className="text-xs font-medium text-foreground">{children}</Label>
}

function DatabaseTypeSelector({
  options,
  selectedDriverType,
  onChange,
  t,
}: {
  options: DatabaseTypeOption[]
  selectedDriverType: string
  onChange: (driverType: string) => void
  t: TFunction
}) {
  return (
    <div role="radiogroup" aria-label={t('connectionForm.databaseType')} className="grid min-h-0 content-start flex-1 grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2 overflow-y-auto overscroll-contain p-1">
      {options.map((option) => <button key={option.productId} type="button" role="radio" aria-label={option.label} aria-checked={option.productId === selectedDriverType} tabIndex={option.productId === selectedDriverType || (!options.some((p) => p.productId === selectedDriverType) && options[0] === option) ? 0 : -1} onKeyDown={(event) => {
        const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
        if (!direction && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        const index = options.indexOf(option)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + direction + options.length) % options.length
        onChange(options[next].productId)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
      }} title={option.label} className={`flex min-w-0 items-center gap-2 rounded-lg border p-3 text-left text-xs ${option.productId === selectedDriverType ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => onChange(option.productId)}>
        <DatabaseVendorIcon driverType={option.driverType} className="size-5 shrink-0" /><span className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><span className="font-medium">{option.label}</span><span className="text-[11px] text-muted-foreground">{[...new Set(option.drivers.map(d => d.backend === 'nativeRust' ? 'Native' : 'JDBC'))].join(' · ')}</span></span>
      </button>)}
    </div>
  )
}

type DriverChoice = Pick<DriverDefinition, 'id' | 'productId' | 'defaultInstallationId' | 'driverType' | 'driverDialect' | 'name' | 'backend' | 'status' | 'builtIn' | 'userDriverRequired'>
type DatabaseTypeOption = { builtIn: boolean; productId: string; driverType: DriverType; label: string; defaultDriver: DriverChoice; drivers: DriverChoice[] }

function databaseTypeOptions(drivers: DriverChoice[], products: DatabaseProduct[]): DatabaseTypeOption[] {
  const ids = [...new Set(drivers.map((d) => d.productId || d.driverType))]
  return ids.map((productId) => {
    const product = products.find((p) => p.id === productId)
    const profiles = drivers.filter((d) => (d.productId || d.driverType) === productId)
    const defaultDriver = profiles.find((d) => d.id === product?.defaultDriverDefinitionId) ?? profiles.find((d) => d.backend === 'nativeRust') ?? profiles[0]
    return { builtIn: product?.builtIn ?? defaultDriver.builtIn, productId, driverType: defaultDriver.driverType, label: product?.name ?? defaultDriver.name.replace(/\s*[（(].*?[）)]/g, '').replace(/\s+JDBC\b.*/i, '').trim(), defaultDriver, drivers: profiles }
  })
}

function driverProfileOptionLabel(driver: DriverChoice, t: TFunction) {
  const implementation = driver.backend === 'nativeRust' ? t('connectionForm.nativeDriver') : t('connectionForm.jdbcDriver')
  const name = driverDisplayName(driver, t)
  return driver.backend === 'jdbc' && /\bJDBC\b/i.test(name) ? name : `${name} · ${implementation}`
}

function DisclosureSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <details className="group rounded-lg border border-transparent bg-surface transition-colors hover:border-border/70 hover:bg-surface-secondary/60" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3.5 text-[13px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5"><span className="grid size-6 place-items-center rounded-md bg-primary/[0.065] text-primary [&_svg]:size-[15px]">{icon}</span>{title}</span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t border-border/60 px-3.5 pb-3.5">{children}</div>
    </details>
  )
}

function SshTunnelFields({
  form,
  connection,
  updateSshTunnel,
  t,
}: {
  form: ConnectionInput
  connection?: ConnectionConfig | null
  updateSshTunnel: (key: string, value: string | number | boolean | null) => void
  t: TFunction
}) {
  const tunnel = form.sshTunnel
  if (!tunnel) return null

  return (
    <div className="grid gap-3">
      <FormRow label={t('connectionForm.sshHost')}>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <Input value={tunnel.host} disableTextAssistance onChange={(event) => updateSshTunnel('host', event.target.value)} required />
          <Input type="number" value={tunnel.port} disableTextAssistance onChange={(event) => updateSshTunnel('port', Number(event.target.value))} required aria-label={t('connectionForm.port')} />
        </div>
      </FormRow>
      <FormRow label={t('connectionForm.sshUser')}>
        <Input value={tunnel.username} disableTextAssistance onChange={(event) => updateSshTunnel('username', event.target.value)} required />
      </FormRow>
      <FormRow label={t('connectionForm.sshAuth')}>
        <AppSelect value={tunnel.authMethod} onValueChange={(value) => updateSshTunnel('authMethod', value)} options={[{ value: 'privateKey', label: t('connectionForm.privateKey') }, { value: 'password', label: t('connectionForm.password') }]} />
      </FormRow>
      {tunnel.authMethod === 'password' ? (
        <FormRow label={t('connectionForm.sshPassword')}>
          <Input type="password" value={tunnel.password ?? ''} placeholder={connection?.sshTunnel ? t('common.hidden') : ''} disableTextAssistance onChange={(event) => updateSshTunnel('password', event.target.value)} />
        </FormRow>
      ) : (
        <>
          <FormRow label={t('connectionForm.privateKeyPath')}>
            <Input value={tunnel.privateKeyPath ?? ''} placeholder="/Users/me/.ssh/id_ed25519" disableTextAssistance onChange={(event) => updateSshTunnel('privateKeyPath', event.target.value)} required />
          </FormRow>
          <FormRow label={t('connectionForm.privateKeyPassphrase')}>
            <Input type="password" value={tunnel.privateKeyPassphrase ?? ''} placeholder={connection?.sshTunnel ? t('common.hidden') : ''} disableTextAssistance onChange={(event) => updateSshTunnel('privateKeyPassphrase', event.target.value)} />
          </FormRow>
        </>
      )}
      <FormRow label={t('connectionForm.remoteAddress')}>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <Input value={tunnel.remoteHost ?? ''} placeholder={form.host ?? t('connectionForm.databaseHost')} disableTextAssistance onChange={(event) => updateSshTunnel('remoteHost', event.target.value)} />
          <Input type="number" value={tunnel.remotePort ?? ''} placeholder={String(form.port ?? '')} disableTextAssistance onChange={(event) => updateSshTunnel('remotePort', event.target.value ? Number(event.target.value) : null)} aria-label={t('connectionForm.port')} />
        </div>
      </FormRow>
    </div>
  )
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: ConnectionVariantOption[]
  value: ConnectionVariant
  onChange: (value: ConnectionVariant) => void
}) {
  return (
    <div className="inline-flex h-8 overflow-hidden rounded-md border">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          className={[
            'border-r px-4 text-sm last:border-r-0',
            value === option.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
          ].join(' ')}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function DriverSupportSummary({
  driver,
  profile,
  input,
  readinessIssue,
  t,
}: {
  driver?: DriverDefinition
  profile: DriverProfile
  input: ConnectionInput
  readinessIssue: string | null
  t: TFunction
}) {
  const capabilities = driver?.capabilities ?? unknownCapabilities()
  const missing = externalDriverMissingItems(input, profile, driver, t)
  const ready = Boolean(driver?.capabilities.canConnect) && !readinessIssue && missing.length === 0
  const requiresLocalJar = profile.externalDriver || Boolean(driver?.userDriverRequired)
  const status = driverStatusLabel(driver?.status ?? profile.status, t)
  const downloadUrl = driver?.downloadUrl ?? (input.driverType === 'oracle' ? ORACLE_JDBC_DOWNLOAD_URL : null)
  const title = requiresLocalJar ? t('connectionForm.localDriverRequired') : driverBackendLabel(driver?.backend ?? profileBackend(profile))
  const detail = requiresLocalJar
    ? (missing.length > 0
        ? t('connectionForm.missing', { items: missing.join(t('common.listSeparator', { defaultValue: ', ' })) })
        : t('connectionForm.externalDriverReady'))
    : t('connectionForm.nativeDriverReady')

  return (
    <div className="border-t pt-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{t('connectionForm.driver')}</span>
        <span>{title}</span>
        <span className="text-muted-foreground">{status}</span>
        <span className="text-muted-foreground">· {ready ? t('connectionForm.connectable') : driverSupportStateLabel(profile.status, missing, t)}</span>
      </div>
      {!ready && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
      {requiresLocalJar && downloadUrl && (
        <Button
          type="button"
          size="xs"
          variant="link"
          className="mt-1 h-5 px-0 text-[11px]"
          onClick={() => {
            void openExternalUrl(downloadUrl)
          }}
        >
          <Download className="size-3" />
          {t('connectionForm.openDownloadPage')}
        </Button>
      )}
      <details className="mt-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">{t('connectionForm.viewCapabilities')}</summary>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {driverCapabilityBadges(capabilities, t).map((item) => (
            <span key={item.label} className={item.enabled ? capabilityOnClass : capabilityOffClass}>
              {item.label}
            </span>
          ))}
        </div>
      </details>
    </div>
  )
}

const capabilityOnClass =
  'rounded-sm border border-border bg-surface-secondary px-1.5 py-0.5 text-[11px] text-foreground'
const capabilityOffClass =
  'rounded-sm border border-border bg-muted/45 px-1.5 py-0.5 text-[11px] text-muted-foreground'

function driverSupportStateLabel(status: DriverDefinition['status'], missing: string[], t: TFunction) {
  if (status === 'planned') return t('connectionForm.statusPlanned')
  if (missing.length > 0) return t('connectionForm.missing', { items: missing.join(t('common.listSeparator', { defaultValue: ', ' })) })
  if (status === 'configurable') return t('connectionForm.statusConfigurable')
  return t('connectionForm.statusNotReady')
}

function externalDriverMissingItems(
  input: ConnectionInput,
  profile: DriverProfile,
  driver?: DriverDefinition,
  t?: TFunction,
) {
  if (!profile.externalDriver && !driver?.userDriverRequired) {
    return []
  }

  const missing: string[] = []
  if (!(driver?.jdbcDriverClass ?? input.driverClass)?.trim()) missing.push(t ? t('connectionForm.missingDriverClass') : 'driver class')
  if (!input.driverInstallationId && !input.driverPaths?.length) missing.push(t ? t('connectionForm.missingLocalJar') : 'local JAR')
  return missing
}

function driverCapabilityBadges(capabilities: DriverDefinition['capabilities'], t: TFunction) {
  return [
    { label: t('connectionForm.capability.connect'), enabled: capabilities.canConnect },
    { label: t('connectionForm.capability.query'), enabled: capabilities.canQuery },
    { label: t('connectionForm.capability.stream'), enabled: capabilities.canStream },
    { label: t('connectionForm.capability.metadata'), enabled: capabilities.canReadMetadata },
    { label: 'DDL', enabled: capabilities.canGenerateDdl },
    { label: t('connectionForm.capability.cancel'), enabled: capabilities.canCancel },
  ]
}

function unknownCapabilities(): DriverDefinition['capabilities'] {
  return {
    canConnect: false,
    canQuery: false,
    canStream: false,
    canReadMetadata: false,
    canCancel: false,
    canGenerateDdl: false,
  }
}

function profileBackend(profile: DriverProfile): DriverDefinition['backend'] {
  return profile.externalDriver ? 'jdbc' : 'nativeRust'
}

function driverBackendLabel(backend: DriverDefinition['backend']) {
  if (backend === 'nativeRust') return 'Native Rust'
  if (backend === 'jdbc') return 'JDBC'
  return 'Planned'
}

function driverStatusLabel(status: DriverDefinition['status'] | DriverProfile['status'] | undefined, t: TFunction) {
  if (status === 'ready') return t('connectionForm.statusReady')
  if (status === 'configurable') return t('connectionForm.statusConfigurable')
  if (status === 'planned') return t('connectionForm.statusPlanned')
  return t('connectionForm.statusUnknown')
}

function normalizeInput(
  input: ConnectionInput,
  variant: ConnectionVariant,
  profile: DriverProfile,
  definition?: DriverDefinition,
): ConnectionInput {
  const fileWithoutCredentials = variant === 'file' && !definition?.connectionVariants.find((v) => v.id === variant)?.requiredFields.includes('username')
  const endpoint = normalizeConnectionEndpoint(input.host, input.port)
  return {
    ...input,
    driverDefinitionId: input.driverDefinitionId ?? input.driverType,
    connectionMode: variant,
    driverInstallationId: input.driverInstallationId ?? null,
    driverDialect: definition?.driverDialect ?? input.driverDialect ?? input.driverType,
    host: emptyToNull(endpoint.host),
    port: endpoint.port,
    database: emptyToNull(input.database),
    connectionUrl: normalizeConnectionUrl(input, variant, profile),
    username: fileWithoutCredentials ? null : emptyToNull(input.username),
    password: fileWithoutCredentials ? null : emptyToNull(input.password),
    savePassword: fileWithoutCredentials ? false : input.savePassword,
    driverClass: emptyToNull(definition?.jdbcDriverClass ?? input.driverClass),
    driverPaths: [],
    group: emptyToNull(input.group),
    // Legacy color tags are retained for saved-connection compatibility but no
    // longer carry environment or safety semantics in the user interface.
    colorTag: input.colorTag ?? null,
    sshTunnel: normalizeSshTunnel(input),
  }
}

function normalizeSshTunnel(input: ConnectionInput) {
  const tunnel = input.sshTunnel
  if (!tunnel?.enabled) return null
  return {
    enabled: true,
    host: tunnel.host.trim(),
    port: tunnel.port || 22,
    username: tunnel.username.trim(),
    authMethod: tunnel.authMethod,
    password: emptyToNull(tunnel.password),
    privateKeyPath: emptyToNull(tunnel.privateKeyPath),
    privateKeyPassphrase: emptyToNull(tunnel.privateKeyPassphrase),
    remoteHost: emptyToNull(tunnel.remoteHost),
    remotePort: tunnel.remotePort || null,
    localHost: emptyToNull(tunnel.localHost) ?? '127.0.0.1',
  }
}

function emptyToNull(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : null
}


function validateRequiredFields(
  input: ConnectionInput,
  variant: ConnectionVariant,
  validationMode: { requireExternalDriver: boolean; profile: DriverProfile; definition?: DriverDefinition },
  t: TFunction,
) {
  if (!input.name.trim()) {
    return t('connectionForm.validation.nameRequired')
  }

  if (
    validationMode.requireExternalDriver &&
    requiresExternalDriverConfig(validationMode.profile, validationMode.definition)
  ) {
    if (!(validationMode.definition?.jdbcDriverClass ?? input.driverClass)?.trim()) {
      return t('connectionForm.validation.oracleDriverClassRequired')
    }
    if (!input.driverInstallationId && !input.driverPaths?.length) {
      return t('connectionForm.validation.oracleJarRequired')
    }
  }

  if (input.sshTunnel?.enabled) {
    if (!input.sshTunnel.host?.trim()) return 'SSH host is required'
    if (!input.sshTunnel.username?.trim()) return 'SSH username is required'
    if (input.sshTunnel.authMethod === 'privateKey' && !input.sshTunnel.privateKeyPath?.trim()) {
      return 'SSH private key path is required'
    }
  }

  const schema = validationMode.definition?.connectionVariants.find((v) => v.id === variant)
  const usernameRequired = schema ? schema.requiredFields.includes('username') : requiresUsername(input.driverType)
  const databaseRequired = schema ? schema.requiredFields.includes('database') : requiresDatabase(input.driverType)
  if (variant === 'urlOnly' || variant === 'file') {
    if (!input.connectionUrl?.trim()) {
      return t('connectionForm.validation.urlRequired')
    }
    if (usernameRequired && !input.username?.trim()) {
      return t('connectionForm.validation.usernameRequired')
    }
    return null
  }

  if (!input.host?.trim()) {
    return t('connectionForm.validation.hostRequired')
  }

  if (!input.database?.trim() && databaseRequired) {
    return t('connectionForm.validation.databaseRequired')
  }

  if (!input.username?.trim() && usernameRequired) {
    return t('connectionForm.validation.usernameRequired')
  }

  return null
}

function connectionReadinessIssue(
  input: ConnectionInput,
  profile: DriverProfile,
  definition: DriverDefinition | undefined,
  t: TFunction,
) {
  if (!requiresExternalDriverConfig(profile, definition)) {
    return null
  }
  if (!(definition?.jdbcDriverClass ?? input.driverClass)?.trim()) {
    return t('connectionForm.validation.missingJdbcClassReadiness')
  }
  if (!input.driverInstallationId && !input.driverPaths?.length) {
    return t('connectionForm.validation.missingJarReadiness')
  }
  return null
}

function requiresDatabase(driverType: DriverType) {
  // MySQL accepts a server-level connection (for example
  // `jdbc:mysql://host:3306/`) and lets the user choose a database later.
  // Requiring a default database here rejected valid MySQL connection URLs.
  return driverType === 'postgres' || driverType === 'mssql'
}

function requiresUsername(driverType: DriverType) {
  return driverType === 'postgres' || driverType === 'mysql' || driverType === 'mssql' || driverType === 'oracle' || driverType === 'jdbc'
}

function requiresExternalDriverConfig(profile: DriverProfile, definition?: DriverDefinition) {
  return profile.externalDriver || definition?.backend === 'jdbc' || definition?.userDriverRequired
}

type DriverProfile = {
  defaultName: string
  defaultPort: number
  defaultDatabase: string
  defaultUsername: string
  status: DriverDefinition['status']
  usesUrl?: boolean
  externalDriver?: boolean
  description?: string
  driverClass?: string
  urlPlaceholder?: string
  connectionVariants: ConnectionVariantOption[]
  defaultUrl: (input: ConnectionInput, variant: ConnectionVariant) => string
}

function profileForDriver(
  driverType: DriverType,
  definition?: DriverDefinition,
): DriverProfile {
  const fallback = DRIVER_PROFILES[driverType] ?? DRIVER_PROFILES.jdbc
  if (!definition) {
    return fallback
  }

  const variants = definition.connectionVariants
    .map((variant) => ({
      id: isConnectionVariant(variant.id) ? variant.id : null,
      label: variant.label,
    }))
    .filter((variant): variant is ConnectionVariantOption => variant.id !== null)

  const urlTemplate = definition.urlTemplate ?? fallback.urlPlaceholder ?? ''

  return {
    ...fallback,
    defaultPort: definition.defaultPort ?? fallback.defaultPort,
    defaultDatabase: definition.defaultDatabase ?? fallback.defaultDatabase,
    defaultUsername: definition.defaultUsername ?? fallback.defaultUsername,
    status: definition.status,
    usesUrl: fallback.usesUrl || Boolean(definition.urlTemplate),
    externalDriver: fallback.externalDriver || definition.userDriverRequired,
    description: definition.notes ?? fallback.description,
    driverClass: definition.jdbcDriverClass ?? fallback.driverClass,
    urlPlaceholder: definition.urlTemplate ?? fallback.urlPlaceholder,
    connectionVariants: variants.length ? variants : fallback.connectionVariants,
    defaultUrl: definition.urlTemplate
      ? (input, variant) => driverType === 'oracle' ? fallback.defaultUrl(input, variant) : applyUrlTemplate(urlTemplate, input)
      : fallback.defaultUrl,
  }
}

function localizedProfile(profile: DriverProfile, driverType: DriverType, t: TFunction): DriverProfile {
  if (driverType === 'oracle') {
    return { ...profile, description: t('connectionForm.description.oracle') }
  }
  if (driverType === 'jdbc') {
    return { ...profile, description: t('connectionForm.description.jdbc') }
  }
  if (driverType === 'sqlite') {
    return { ...profile, description: t('connectionForm.description.sqlite') }
  }
  return profile
}

function isConnectionVariant(value: string): value is ConnectionVariant {
  return value === 'hostPort' ||
    value === 'urlOnly' ||
    value === 'oracleService' ||
    value === 'oracleSid' ||
    value === 'file'
}

function applyUrlTemplate(template: string, input: ConnectionInput) {
  const values: Record<string, string | number | null | undefined> = {
    host: input.host || 'localhost',
    port: input.port,
    database: input.database,
    file: input.connectionUrl,
    username: input.username,
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
}

function driverArtifactPathPlaceholder(driverArtifact?: string | null) {
  const fileName = driverArtifact?.trim()
  return fileName ? `/path/to/${fileName}` : '/path/to/driver.jar'
}

const HOST_PORT_VARIANTS: ConnectionVariantOption[] = [
  { id: 'hostPort', label: 'Host/Port' },
  { id: 'urlOnly', label: 'URL only' },
]

const DRIVER_PROFILES: Record<DriverType, DriverProfile> = {
  postgres: {
    defaultName: defaultConnectionName('postgres'),
    defaultPort: 5432,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  mysql: {
    defaultName: defaultConnectionName('mysql'),
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  oracle: {
    defaultName: defaultConnectionName('oracle'),
    defaultPort: 1521,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'configurable',
    usesUrl: true,
    externalDriver: true,
    driverClass: 'oracle.jdbc.OracleDriver',
    urlPlaceholder: 'jdbc:oracle:thin:@//localhost:1521/<service-name>',
    connectionVariants: [
      { id: 'oracleService', label: 'Service Name' },
      { id: 'oracleSid', label: 'SID' },
      { id: 'urlOnly', label: 'URL only' },
    ],
    defaultUrl: (input, variant) => {
      const host = input.host || 'localhost'
      const port = input.port || 1521
      const database = input.database || ''
      if (variant === 'oracleSid') return `jdbc:oracle:thin:@${host}:${port}:${database}`
      return `jdbc:oracle:thin:@//${host}:${port}/${database}`
    },
  },
  jdbc: {
    defaultName: defaultConnectionName('jdbc'),
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'configurable',
    usesUrl: true,
    externalDriver: true,
    urlPlaceholder: 'jdbc:vendor://host:port/database',
    connectionVariants: [{ id: 'urlOnly', label: 'URL only' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  sqlite: {
    defaultName: defaultConnectionName('sqlite'),
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    usesUrl: true,
    urlPlaceholder: '/path/to/database.sqlite',
    connectionVariants: [{ id: 'file', label: 'File' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  mssql: {
    defaultName: defaultConnectionName('mssql'),
    defaultPort: 1433,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    usesUrl: true,
    urlPlaceholder: 'server=tcp:host,1433;database=<database>;user=<username>;password=<password>;TrustServerCertificate=true',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  mongo: {
    defaultName: 'MongoDB',
    defaultPort: 27017,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'planned',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  redis: {
    defaultName: 'Redis',
    defaultPort: 6379,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'planned',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
}

function defaultConnectionVariant(driverType: DriverType) {
  return DRIVER_PROFILES[driverType].connectionVariants[0].id
}

function databaseFieldLabel(variant: ConnectionVariant, t: TFunction) {
  if (variant === 'oracleSid') return 'SID:'
  if (variant === 'oracleService') return t('connectionForm.serviceName')
  return t('connectionForm.database')
}

const PRIMARY_DRIVER_ORDER = new Map<DriverType, number>(
  ['postgres', 'mysql', 'sqlite', 'mssql', 'oracle'].map((driver, index) => [driver as DriverType, index]),
)

const FALLBACK_DRIVER_OPTIONS: DriverChoice[] = [
  { id: 'postgres', driverType: 'postgres', driverDialect: 'postgresql', name: 'PostgreSQL', backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false },
  { id: 'mysql', driverType: 'mysql', driverDialect: 'mysql', name: 'MySQL', backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false },
  { id: 'sqlite', driverType: 'sqlite', driverDialect: 'sqlite', name: 'SQLite', backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false },
  { id: 'mssql', driverType: 'mssql', driverDialect: 'mssql', name: 'SQL Server', backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false },
  { id: 'oracle', driverType: 'oracle', driverDialect: 'oracle', name: 'Oracle', backend: 'jdbc', status: 'configurable', builtIn: true, userDriverRequired: true },
  { id: 'jdbc', driverType: 'jdbc', driverDialect: 'genericJdbc', name: 'Custom JDBC', backend: 'jdbc', status: 'configurable', builtIn: false, userDriverRequired: true },
]

function compareDriverChoices(
  left: Pick<DriverDefinition, 'driverType' | 'name'>,
  right: Pick<DriverDefinition, 'driverType' | 'name'>,
) {
  const leftRank = PRIMARY_DRIVER_ORDER.get(left.driverType) ?? 99
  const rightRank = PRIMARY_DRIVER_ORDER.get(right.driverType) ?? 99
  return leftRank === rightRank ? left.name.localeCompare(right.name) : leftRank - rightRank
}
