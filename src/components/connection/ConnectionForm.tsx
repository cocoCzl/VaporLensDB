import { FormEvent, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Database, Download, Eye, EyeOff, MoreHorizontal, Network, PlugZap, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/ui/app-select'
import { normalizeAppError } from '@/ipc/client'
import { openExternalUrl } from '@/lib/openExternalUrl'
import { normalizeConnectionEndpoint } from '@/lib/connectionEndpoint'
import { extractUrlCredentials } from '@/lib/connectionUrlCredentials'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig, ConnectionInput, DriverType } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'
import type { AppError } from '@/types/error'

type ConnectionVariant = 'hostPort' | 'urlOnly' | 'oracleService' | 'oracleSid' | 'file'

type ConnectionVariantOption = {
  id: ConnectionVariant
  label: string
}

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
}

export function ConnectionForm({
  connection,
  driverDefinitions = [],
  loading = false,
  onSaveOnly,
  onSaveAndConnect,
  onTest,
  onCancel,
  layout = 'dialog',
  onDirtyChange,
  onDriverTypeChange,
}: ConnectionFormProps) {
  const { t } = useTranslation()
  const dataSourceGroups = useConnectionStore((state) => state.dataSourceGroups)
  const initialUrlCredentials = extractUrlCredentials(connection?.connectionUrl ?? '')
  const [form, setForm] = useState<ConnectionInput>({
    id: connection?.id,
    name: connection?.name ?? 'Local PostgreSQL',
    driverDefinitionId: connection?.driverDefinitionId ?? connection?.driverType ?? 'postgres',
    driverType: connection?.driverType ?? 'postgres',
    driverDialect: connection?.driverDialect ?? connection?.driverType ?? 'postgresql',
    host: connection?.host ?? 'localhost',
    port: connection?.port ?? 5432,
    database: connection?.database ?? '',
    connectionUrl: initialUrlCredentials.connectionUrl,
    username: initialUrlCredentials.username ?? connection?.username ?? '',
    password: initialUrlCredentials.password ?? '',
    savePassword: initialUrlCredentials.password ? true : (connection?.hasSavedPassword ?? true),
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
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [groupSelection, setGroupSelection] = useState(connection?.groupId ?? '')
  const [connectionVariant, setConnectionVariant] = useState<ConnectionVariant>(
    defaultConnectionVariant(connection?.driverType ?? 'postgres'),
  )
  const selectableDrivers = driverDefinitions.length
    ? driverDefinitions.filter(
        (driver) =>
          PRIMARY_DRIVER_IDS.includes(driver.driverType) ||
          (!driver.builtIn && driver.driverType === 'jdbc'),
      ).sort(compareDriverChoices)
    : FALLBACK_DRIVER_OPTIONS
  const selectedDriver =
    driverDefinitions.find((driver) => driver.id === form.driverDefinitionId) ??
    driverDefinitions.find((driver) => driver.driverType === form.driverType)
  const driverProfile = localizedProfile(profileForDriver(form.driverType, selectedDriver), form.driverType, t)
  const readinessIssue = connectionReadinessIssue(form, driverProfile, selectedDriver, t)
  const databaseTypes = databaseTypeOptions(selectableDrivers, t)
  const activeDatabaseType = databaseTypes.find((option) => option.driverType === form.driverType)
  const driverVariants = activeDatabaseType?.drivers ?? []

  const activeConnectionVariant = driverProfile.connectionVariants.some(
    (variant) => variant.id === connectionVariant,
  )
    ? connectionVariant
    : driverProfile.connectionVariants[0].id
  const isUrlOnly = activeConnectionVariant === 'urlOnly'

  const update = (key: keyof ConnectionInput, value: string | number | string[] | boolean | null) => {
    onDirtyChange?.(true)
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateConnectionUrl = (value: string) => {
    const extracted = extractUrlCredentials(value)
    onDirtyChange?.(true)
    setForm((current) => ({
      ...current,
      connectionUrl: extracted.connectionUrl,
      username: extracted.username ?? current.username,
      password: extracted.password ?? current.password,
      savePassword: extracted.password ? true : current.savePassword,
    }))
    if (extracted.username || extracted.password) setMessage(t('connectionForm.urlCredentialsExtracted'))
  }

  const updateSshTunnel = (key: string, value: string | number | boolean | null) => {
    onDirtyChange?.(true)
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

  const changeDriver = (driverDefinitionId: string) => {
    onDirtyChange?.(true)
    const definition = driverDefinitions.find((driver) => driver.id === driverDefinitionId)
    const driverType = definition?.driverType ?? (driverDefinitionId as DriverType)
    const profile = profileForDriver(driverType, definition)
    const nextVariant = profile.connectionVariants[0].id
    onDriverTypeChange?.(driverType)
    setConnectionVariant(nextVariant)
    setForm((current) => ({
      ...current,
      driverDefinitionId: definition?.id ?? driverType,
      driverType,
      driverDialect: definition?.driverDialect ?? driverType,
      name: current.name || definition?.name || profile.defaultName,
      port: profile.defaultPort,
      database: current.database || profile.defaultDatabase,
      username: current.username || profile.defaultUsername,
      connectionUrl: profile.defaultUrl(current, nextVariant),
      driverClass: profile.driverClass ?? '',
      driverPaths: definition?.driverArtifacts ?? [],
    }))
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
    onDirtyChange?.(true)
    setForm((current) => ({ ...current, host: endpoint.host, port: endpoint.port }))
  }

  const validate = (requireExternalDriver: boolean) => {
    return validateRequiredFields(form, activeConnectionVariant, {
      requireExternalDriver,
      profile: driverProfile,
      definition: selectedDriver,
    }, t)
  }

  const selectGroup = (value: string) => {
    onDirtyChange?.(true)
    setGroupSelection(value)
    update('group', dataSourceGroups.find((group) => group.id === value)?.name ?? '')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
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
    try {
      await onTest(input)
      setMessage(t('connectionForm.connectionTestSucceeded'))
    } catch (error) {
      const appError = normalizeAppError(error)
      setMessage(appError.message)
      setMessageDetail(formatConnectionErrorDetail(appError, input, t))
    }
  }

  return (
    <form
      className="connection-form flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      autoComplete="off"
      onSubmit={submit}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        <div className="mx-auto grid w-full max-w-[46rem] gap-4 p-7">
          <section className="grid gap-2.5">
            <SectionLabel>{t('connectionForm.databaseType')}</SectionLabel>
            <DatabaseTypeSelector
              options={databaseTypes}
              selectedDriverType={form.driverType}
              onChange={(driverType) => {
                const option = databaseTypes.find((item) => item.driverType === driverType)
                if (option) changeDriver(option.defaultDriver.id)
              }}
              t={t}
            />
          </section>

          <section className="grid gap-3.5 pt-0.5">
            <div className="grid gap-1.5">
              <SectionLabel htmlFor="connection-name">{t('connectionForm.name')}</SectionLabel>
              <Input id="connection-name" value={form.name} disableTextAssistance onChange={(event) => update('name', event.target.value)} required />
            </div>

            {activeConnectionVariant === 'file' ? (
              <div className="grid gap-1.5">
                <SectionLabel htmlFor="connection-url">{t('connectionForm.connectionUrl')}</SectionLabel>
                <Input id="connection-url" value={form.connectionUrl ?? ''} placeholder={driverProfile.urlPlaceholder} disableTextAssistance onChange={(event) => updateConnectionUrl(event.target.value)} required />
              </div>
            ) : (
              <>
                {isUrlOnly ? (
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <SectionLabel htmlFor="connection-username">{t('connectionForm.user')}</SectionLabel>
                    <Input id="connection-username" value={form.username ?? ''} disableTextAssistance onChange={(event) => update('username', event.target.value)} required={requiresUsername(form.driverType)} />
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

                {!isUrlOnly && (
                  <div className="grid gap-1.5">
                    <SectionLabel htmlFor="connection-database">{databaseFieldLabel(activeConnectionVariant, t)}</SectionLabel>
                    <Input id="connection-database" value={form.database ?? ''} disableTextAssistance onChange={(event) => update('database', event.target.value)} required={requiresDatabase(form.driverType)} />
                  </div>
                )}
              </>
            )}
          </section>

          {!isUrlOnly && activeConnectionVariant !== 'file' && (
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
                  <AppSelect value={form.sslMode ?? ''} onValueChange={(value) => update('sslMode', value || null)} options={['', 'disable', 'prefer', 'require', 'verify-ca', 'verify-full'].map((value) => ({ value, label: value || t('common.default') }))} />
                </FormRow>
              </div>
            </DisclosureSection>
          )}

          <DisclosureSection title={t('connectionForm.advanced')} icon={<SlidersHorizontal />}>
            <div className="grid gap-3 pt-3">
              {driverVariants.length > 1 && (
                <FormRow label={t('connectionForm.driver')}>
                  <AppSelect
                    id="driver-profile"
                    value={selectedDriver?.id ?? form.driverType}
                    onValueChange={changeDriver}
                    options={driverVariants.map((driver) => ({
                      value: driver.id,
                      label: driverProfileOptionLabel(driver, t),
                    }))}
                  />
                </FormRow>
              )}
              {driverProfile.connectionVariants.length > 1 && (
                <FormRow label={t('connectionForm.connectionType')}>
                  <SegmentedControl options={driverProfile.connectionVariants} value={activeConnectionVariant} onChange={(value) => { onDirtyChange?.(true); setConnectionVariant(value) }} />
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
                    <Input id="driver-class" value={form.driverClass ?? ''} placeholder={driverProfile.driverClass} disableTextAssistance onChange={(event) => update('driverClass', event.target.value)} />
                  </FormRow>
                  <FormRow label={t('connectionForm.driverFiles')}>
                    <Input id="driver-paths" value={form.driverPaths?.join('\n') ?? ''} placeholder={driverArtifactPathPlaceholder(selectedDriver?.driverArtifact)} disableTextAssistance onChange={(event) => update('driverPaths', event.target.value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean))} />
                  </FormRow>
                </>
              )}
              <DriverSupportSummary driver={selectedDriver} profile={driverProfile} input={form} readinessIssue={readinessIssue} t={t} />
            </div>
          </DisclosureSection>
        </div>
      </div>

      <div className="flex min-h-14 items-center justify-between gap-3 border-t border-border/75 bg-surface px-6 py-2">
        <div className="min-w-0 text-xs text-muted-foreground" role={message ? 'status' : undefined}>
          <span className={message ? 'text-foreground' : undefined}>{message ?? readinessIssue ?? ' '}</span>
          {messageDetail && <details className="mt-1 text-[11px]"><summary className="cursor-pointer">{t('connectionForm.errorDetails')}</summary><pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap font-sans">{messageDetail}</pre></details>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" className="h-9 px-3" onClick={test} disabled={loading}><PlugZap />{t('connectionForm.testConnection')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="icon" variant="ghost" aria-label={t('common.moreActions')}><MoreHorizontal /></Button>} />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={saveOnly} disabled={loading}>{t('connectionForm.saveOnly')}</DropdownMenuItem>
              {layout === 'panel' && <DropdownMenuItem onClick={onCancel}>{t('common.cancel')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="submit" className="h-9 px-3" title={t('connectionForm.saveAndConnect')} disabled={loading || Boolean(readinessIssue)}><Database />{t('connection.connect')}</Button>
        </div>
      </div>
    </form>
  )
}

function formatConnectionErrorDetail(error: AppError, input: ConnectionInput, t: TFunction) {
  const lines = error.detail?.split(/\r?\n|;\s*/).filter(Boolean) ?? []
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
    <div className={`grid grid-cols-[104px_minmax(0,1fr)] gap-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <Label className={`text-right text-xs ${labelClassName ?? ''}`}>{label}</Label>
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
  selectedDriverType: DriverType
  onChange: (driverType: DriverType) => void
  t: TFunction
}) {
  const primaryOptions = options.filter((option) => option.driverType !== 'jdbc')
  const secondaryOption = options.find((option) => option.driverType === 'jdbc')

  return (
    <div role="radiogroup" aria-label={t('connectionForm.databaseType')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {primaryOptions.map((option) => <DatabaseTypeOptionButton key={option.driverType} option={option} selected={option.driverType === selectedDriverType} onChange={onChange} />)}
      </div>
      {secondaryOption && (
        <div className="mt-2 flex">
          <DatabaseTypeOptionButton option={secondaryOption} selected={secondaryOption.driverType === selectedDriverType} onChange={onChange} secondary />
        </div>
      )}
    </div>
  )
}

function DatabaseTypeOptionButton({
  option,
  selected,
  onChange,
  secondary = false,
}: {
  option: DatabaseTypeOption
  selected: boolean
  onChange: (driverType: DriverType) => void
  secondary?: boolean
}) {
  const unavailable = option.defaultDriver.status === 'planned'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={unavailable}
      className={[
        'flex min-w-0 items-center gap-2 rounded-lg border text-left text-xs transition-[background-color,border-color,color,box-shadow]',
        secondary ? 'h-9 px-3 text-muted-foreground' : 'h-11 px-3.5',
        selected ? 'border-primary/55 bg-primary/[0.08] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.08)]' : 'border-border/85 bg-surface text-muted-foreground hover:border-border-strong hover:bg-surface-secondary hover:text-foreground',
        unavailable ? 'cursor-not-allowed opacity-45' : '',
      ].join(' ')}
      onClick={() => onChange(option.driverType)}
    >
      <DatabaseVendorIcon driverType={option.driverType} className={`${secondary ? 'size-4' : 'size-5'} shrink-0`} />
      <span className="min-w-0 truncate font-medium">{option.label}</span>
    </button>
  )
}

type DriverChoice = Pick<DriverDefinition, 'id' | 'driverType' | 'driverDialect' | 'name' | 'backend' | 'status' | 'builtIn' | 'userDriverRequired'>

type DatabaseTypeOption = {
  driverType: DriverType
  label: string
  defaultDriver: DriverChoice
  drivers: DriverChoice[]
}

function databaseTypeOptions(drivers: DriverChoice[], t: TFunction): DatabaseTypeOption[] {
  const byType = new Map<DriverType, DriverChoice[]>()
  for (const driver of drivers) {
    const current = byType.get(driver.driverType) ?? []
    current.push(driver)
    byType.set(driver.driverType, current)
  }

  return [...byType.entries()]
    .map(([driverType, profiles]) => {
      const defaultDriver = profiles.find((driver) => driver.backend === 'nativeRust' && driver.status === 'ready')
        ?? profiles.find((driver) => driver.status === 'ready')
        ?? profiles.find((driver) => driver.builtIn && !driver.userDriverRequired)
        ?? profiles[0]
      return {
        driverType,
        label: driverType === 'jdbc' ? t('connectionForm.other') : databaseProductName(defaultDriver.name),
        defaultDriver,
        drivers: profiles,
      }
    })
    .sort((left, right) => (PRIMARY_DRIVER_ORDER.get(left.driverType) ?? 99) - (PRIMARY_DRIVER_ORDER.get(right.driverType) ?? 99))
}

function databaseProductName(name: string) {
  return name
    .replace(/\s*[（(].*?[）)]/g, '')
    .replace(/\s+JDBC\b.*/i, '')
    .trim()
}

function driverProfileOptionLabel(driver: DriverChoice, t: TFunction) {
  const implementation = driver.backend === 'nativeRust' ? t('connectionForm.nativeDriver') : t('connectionForm.jdbcDriver')
  return driver.backend === 'nativeRust' && driver.status === 'ready'
    ? `${implementation} · ${t('connectionForm.recommended')}`
    : implementation
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
  const capabilities = driver?.capabilities ?? profileCapabilities(profile)
  const missing = externalDriverMissingItems(input, profile, driver, t)
  const ready = !readinessIssue && missing.length === 0 && profile.status !== 'planned'
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
  if (!input.driverClass?.trim()) missing.push(t ? t('connectionForm.missingDriverClass') : 'driver class')
  if (!input.driverPaths?.length) missing.push(t ? t('connectionForm.missingLocalJar') : 'local JAR')
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

function profileCapabilities(profile: DriverProfile): DriverDefinition['capabilities'] {
  const queryable = profile.status !== 'planned'
  return {
    canConnect: queryable,
    canQuery: queryable,
    canStream: queryable,
    canReadMetadata: queryable,
    canCancel: false,
    canGenerateDdl: queryable,
  }
}

function profileBackend(profile: DriverProfile): DriverDefinition['backend'] {
  if (profile.status === 'planned') return 'planned'
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
  const isUrlOnly = variant === 'urlOnly'
  const endpoint = normalizeConnectionEndpoint(input.host, input.port)
  return {
    ...input,
    driverDefinitionId: input.driverDefinitionId ?? input.driverType,
    driverDialect: definition?.driverDialect ?? input.driverDialect ?? input.driverType,
    host: emptyToNull(endpoint.host),
    port: endpoint.port,
    database: emptyToNull(input.database),
    connectionUrl:
      profile.usesUrl && variant !== 'urlOnly'
        ? emptyToNull(profile.defaultUrl(input, variant))
        : emptyToNull(input.connectionUrl),
    username: variant === 'file' ? null : emptyToNull(input.username),
    password: variant === 'file' ? null : emptyToNull(input.password),
    savePassword: variant === 'file' ? false : input.savePassword,
    driverClass: emptyToNull(input.driverClass),
    driverPaths: input.driverPaths?.length ? input.driverPaths : (definition?.driverArtifacts ?? []),
    group: emptyToNull(input.group),
    // Legacy color tags are retained for saved-connection compatibility but no
    // longer carry environment or safety semantics in the user interface.
    colorTag: input.colorTag ?? null,
    sshTunnel: isUrlOnly || variant === 'file' ? null : normalizeSshTunnel(input),
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
    if (!input.driverClass?.trim()) {
      return t('connectionForm.validation.oracleDriverClassRequired')
    }
    if (!input.driverPaths?.length) {
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

  if (variant === 'urlOnly' || variant === 'file') {
    if (!input.connectionUrl?.trim()) {
      return t('connectionForm.validation.urlRequired')
    }
    if (variant === 'urlOnly' && requiresUsername(input.driverType) && !input.username?.trim()) {
      return t('connectionForm.validation.usernameRequired')
    }
    return null
  }

  if (!input.host?.trim()) {
    return t('connectionForm.validation.hostRequired')
  }

  if (!input.database?.trim() && requiresDatabase(input.driverType)) {
    return t('connectionForm.validation.databaseRequired')
  }

  if (!input.username?.trim() && requiresUsername(input.driverType)) {
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
  if (!input.driverClass?.trim()) {
    return t('connectionForm.validation.missingJdbcClassReadiness')
  }
  if (!input.driverPaths?.length) {
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
  const fallback = DRIVER_PROFILES[driverType]
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
      ? (input) => applyUrlTemplate(urlTemplate, input)
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
    defaultName: 'Local PostgreSQL',
    defaultPort: 5432,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  mysql: {
    defaultName: 'Local MySQL',
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  oracle: {
    defaultName: 'Oracle',
    defaultPort: 1521,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'configurable',
    usesUrl: true,
    externalDriver: true,
    description: 'Oracle requires a user-provided local ojdbc.jar.',
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
    defaultName: 'Custom JDBC',
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'configurable',
    usesUrl: true,
    externalDriver: true,
    description: 'Custom JDBC loads the driver class, JDBC URL, and JAR paths through the JDBC bridge.',
    urlPlaceholder: 'jdbc:vendor://host:port/database',
    connectionVariants: [{ id: 'urlOnly', label: 'URL only' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  sqlite: {
    defaultName: 'SQLite',
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'ready',
    usesUrl: true,
    description: 'Local SQLite file with query execution, object browsing, DDL, and read-only data preview.',
    urlPlaceholder: '/path/to/database.sqlite',
    connectionVariants: [{ id: 'file', label: 'File' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  mssql: {
    defaultName: 'SQL Server',
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

const PRIMARY_DRIVER_IDS: DriverType[] = ['postgres', 'mysql', 'oracle', 'sqlite', 'mssql']
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
