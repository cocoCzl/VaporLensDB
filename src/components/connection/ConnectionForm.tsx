import { FormEvent, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Database, Download, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AppSelect } from '@/components/ui/app-select'
import { normalizeAppError } from '@/ipc/client'
import { openExternalUrl } from '@/lib/openExternalUrl'
import { extractUrlCredentials } from '@/lib/connectionUrlCredentials'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionConfig, ConnectionInput, DriverType } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'

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
  const driverStatus = selectedDriver?.status ?? driverProfile.status
  const readinessIssue = connectionReadinessIssue(form, driverProfile, selectedDriver, t)

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
    const validationError = validate(true)
    if (validationError) {
      setMessage(validationError)
      return
    }

    try {
      await onTest(normalizeInput(form, activeConnectionVariant, driverProfile, selectedDriver))
      setMessage(driverProfile.externalDriver ? t('connectionForm.localDriverValidated') : t('connectionForm.connectionTestSucceeded'))
    } catch (error) {
      const appError = normalizeAppError(error)
      setMessage(appError.detail ? `${appError.message}\n${appError.detail}` : appError.message)
    }
  }

  return (
    <form
      className={layout === 'panel'
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
        : 'grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] overflow-hidden rounded-md border'}
      autoComplete="off"
      onSubmit={submit}
    >
      {layout === 'dialog' && <aside className="border-r bg-muted/35">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          {t('connectionForm.projectDataSources')}
        </div>
        <div className="m-2 flex h-9 w-[calc(100%-1rem)] items-center gap-2 rounded-md bg-primary/15 px-2 text-left text-sm text-primary ring-1 ring-primary/30">
          <DatabaseVendorIcon driverType={form.driverType} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{form.name || driverProfile.defaultName}</span>
        </div>
      </aside>}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 border-b p-4">
          <Label htmlFor="connection-name" className="text-right text-sm">
            {t('connectionForm.name')}
          </Label>
          <Input
            id="connection-name"
            value={form.name}
            disableTextAssistance
            onChange={(event) => update('name', event.target.value)}
            required
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5 [scrollbar-gutter:stable]">
          <div className="mx-auto grid max-w-4xl gap-3">
            <>
                <FormRow label={t('connectionForm.driver')}>
                  <div className="grid gap-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <AppSelect
                      id="driver-type"
                      value={selectedDriver?.id ?? form.driverType}
                      onValueChange={changeDriver}
                      options={selectableDrivers.map((driver) => ({ value: driver.id, disabled: driver.status === 'planned', label: `${driver.name}${!driver.builtIn ? ` (${t('connectionForm.custom')})` : ''}${driver.status === 'planned' ? ` (${t('connectionForm.planned')})` : ''}` }))}
                    />
                    <span className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground">
                      {driverStatusLabel(driverStatus, t)}
                    </span>
                  </div>
                  <DriverSupportSummary
                    driver={selectedDriver}
                    profile={driverProfile}
                    input={form}
                    readinessIssue={readinessIssue}
                    t={t}
                  />
                  </div>
                </FormRow>

                <FormRow label={t('connectionForm.connectionType')}>
                  <SegmentedControl
                    options={driverProfile.connectionVariants}
                    value={activeConnectionVariant}
                    onChange={(value) => {
                      onDirtyChange?.(true)
                      setConnectionVariant(value)
                    }}
                  />
                </FormRow>

                {isUrlOnly && (
                  <FormRow label={t('connectionForm.connectionUrl')}>
                    <div className="grid gap-2">
                      <Input
                        id="connection-url"
                        value={form.connectionUrl ?? ''}
                        placeholder={driverProfile.urlPlaceholder}
                        disableTextAssistance
                        onChange={(event) => updateConnectionUrl(event.target.value)}
                        required
                      />
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        {t('connectionForm.urlCredentialsWarning')}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {t('connectionForm.urlOnlySshUnsupported')}
                      </p>
                    </div>
                  </FormRow>
                )}

                {!isUrlOnly && activeConnectionVariant !== 'file' && (
                  <FormRow label={t('connectionForm.host')}>
                    <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                      <Input
                        id="connection-host"
                        value={form.host ?? ''}
                        disableTextAssistance
                        onChange={(event) => update('host', event.target.value)}
                        required
                      />
                      <Label htmlFor="connection-port" className="self-center text-right text-sm">
                        {t('connectionForm.port')}
                      </Label>
                      <Input
                        id="connection-port"
                        type="number"
                        value={form.port ?? 5432}
                        disableTextAssistance
                        onChange={(event) => update('port', Number(event.target.value))}
                        required
                      />
                    </div>
                  </FormRow>
                )}

                {activeConnectionVariant !== 'file' && (
                  <>
                    <FormRow label={t('connectionForm.authentication')}>
                      <AppSelect value="userPassword" disabled onValueChange={() => undefined} options={[{ value: 'userPassword', label: t('connectionForm.userPassword') }]} />
                    </FormRow>

                    <FormRow label={t('connectionForm.user')}>
                      <Input
                        id="connection-username"
                        value={form.username ?? ''}
                        disableTextAssistance
                        onChange={(event) => update('username', event.target.value)}
                        required
                      />
                    </FormRow>

                    <FormRow
                      label={t('connectionForm.password')}
                      align="start"
                      labelClassName="pt-1.5"
                    >
                      <div className="grid gap-2">
                        <Input
                          id="connection-password"
                          type="password"
                          value={form.password ?? ''}
                          placeholder={connection ? t('common.hidden') : ''}
                          disableTextAssistance
                          onChange={(event) => update('password', event.target.value)}
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            role="switch"
                            className="h-4 w-7 cursor-pointer appearance-none rounded-full bg-muted p-0.5 transition-colors checked:bg-primary before:block before:size-3 before:rounded-full before:bg-card before:transition-transform checked:before:translate-x-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            checked={form.savePassword ?? true}
                            onChange={(event) => update('savePassword', event.target.checked)}
                          />
                          <span>{t('connectionForm.savePassword')}</span>
                        </label>
                        <p className="text-[11px] text-muted-foreground">{t('connectionForm.savePasswordHint')}</p>
                      </div>
                    </FormRow>
                  </>
                )}

                {activeConnectionVariant !== 'urlOnly' && activeConnectionVariant !== 'file' && (
                  <FormRow label={databaseFieldLabel(activeConnectionVariant, t)}>
                    <Input
                      id="connection-database"
                      value={form.database ?? ''}
                      disableTextAssistance
                      onChange={(event) => update('database', event.target.value)}
                      required
                    />
                  </FormRow>
                )}

                {!isUrlOnly && driverProfile.usesUrl && (
                  <FormRow label={t('connectionForm.connectionUrl')}>
                    <Input
                      id="connection-url"
                      value={
                        activeConnectionVariant === 'file'
                          ? (form.connectionUrl ?? '')
                          : driverProfile.defaultUrl(form, activeConnectionVariant)
                      }
                      placeholder={driverProfile.urlPlaceholder}
                      disableTextAssistance
                      readOnly={activeConnectionVariant !== 'file'}
                      onChange={(event) => updateConnectionUrl(event.target.value)}
                    />
                  </FormRow>
                )}

                {driverProfile.externalDriver && (
                  <>
                    <FormRow label={t('connectionForm.driverClass')}>
                      <Input
                        id="driver-class"
                        value={form.driverClass ?? ''}
                        placeholder={driverProfile.driverClass}
                        disableTextAssistance
                        onChange={(event) => update('driverClass', event.target.value)}
                      />
                    </FormRow>
                    <FormRow label={t('connectionForm.driverFiles')}>
                      <Input
                        id="driver-paths"
                        value={form.driverPaths?.join('\n') ?? ''}
                        placeholder={driverArtifactPathPlaceholder(selectedDriver?.driverArtifact)}
                        disableTextAssistance
                        onChange={(event) =>
                          update(
                            'driverPaths',
                            event.target.value
                              .split(/\r?\n|,/)
                              .map((value) => value.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    </FormRow>
                  </>
                )}

                <FormRow label={t('connectionForm.group')}>
                  <div className="grid gap-2">
                    <AppSelect
                      id="connection-group"
                      value={groupSelection}
                      onValueChange={selectGroup}
                      options={[{ value: '', label: t('connectionForm.ungrouped') }, ...dataSourceGroups.map((group) => ({ value: group.id, label: group.name }))]}
                    />
                  </div>
                </FormRow>

                <details className="rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t('connectionForm.advanced')}</summary>
                  <div className="mt-3 grid gap-3">
                    <FormRow label={t('connectionForm.sslMode')}>
                      <AppSelect
                        value={form.sslMode ?? ''}
                        onValueChange={(value) => update('sslMode', value || null)}
                        options={['', 'disable', 'prefer', 'require', 'verify-ca', 'verify-full'].map((value) => ({ value, label: value || t('common.default') }))}
                      />
                    </FormRow>

                    {!isUrlOnly && <FormRow label={t('connectionForm.sshTunnel')}>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(form.sshTunnel?.enabled)}
                          onChange={(event) => updateSshTunnel('enabled', event.target.checked)}
                        />
                        <span>{t('connectionForm.enableSshTunnel')}</span>
                      </label>
                    </FormRow>}

                    {!isUrlOnly && form.sshTunnel?.enabled && (
                      <>
                        <FormRow label={t('connectionForm.sshHost')}>
                          <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                            <Input
                              value={form.sshTunnel.host}
                              disableTextAssistance
                              onChange={(event) => updateSshTunnel('host', event.target.value)}
                              required
                            />
                            <Label className="self-center text-right text-sm">{t('connectionForm.port')}</Label>
                            <Input
                              type="number"
                              value={form.sshTunnel.port}
                              disableTextAssistance
                              onChange={(event) => updateSshTunnel('port', Number(event.target.value))}
                              required
                            />
                          </div>
                        </FormRow>
                        <FormRow label={t('connectionForm.sshUser')}>
                          <Input
                            value={form.sshTunnel.username}
                            disableTextAssistance
                            onChange={(event) => updateSshTunnel('username', event.target.value)}
                            required
                          />
                        </FormRow>
                        <FormRow label={t('connectionForm.sshAuth')}>
                          <AppSelect
                            value={form.sshTunnel.authMethod}
                            onValueChange={(value) => updateSshTunnel('authMethod', value)}
                            options={[{ value: 'privateKey', label: 'Private key' }, { value: 'password', label: 'Password' }]}
                          />
                        </FormRow>
                        {form.sshTunnel.authMethod === 'password' ? (
                          <FormRow label={t('connectionForm.sshPassword')}>
                            <Input
                              type="password"
                              value={form.sshTunnel.password ?? ''}
                              placeholder={connection?.sshTunnel ? t('common.hidden') : ''}
                              disableTextAssistance
                              onChange={(event) => updateSshTunnel('password', event.target.value)}
                            />
                          </FormRow>
                        ) : (
                          <>
                            <FormRow label={t('connectionForm.privateKeyPath')}>
                              <Input
                                value={form.sshTunnel.privateKeyPath ?? ''}
                                placeholder="/Users/me/.ssh/id_ed25519"
                                disableTextAssistance
                                onChange={(event) => updateSshTunnel('privateKeyPath', event.target.value)}
                                required
                              />
                            </FormRow>
                            <FormRow label={t('connectionForm.privateKeyPassphrase')}>
                              <Input
                                type="password"
                                value={form.sshTunnel.privateKeyPassphrase ?? ''}
                                placeholder={connection?.sshTunnel ? t('common.hidden') : ''}
                                disableTextAssistance
                                onChange={(event) => updateSshTunnel('privateKeyPassphrase', event.target.value)}
                              />
                            </FormRow>
                          </>
                        )}
                        <FormRow label={t('connectionForm.remoteAddress')}>
                          <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                            <Input
                              value={form.sshTunnel.remoteHost ?? ''}
                              placeholder={form.host ?? t('connectionForm.databaseHost')}
                              disableTextAssistance
                              onChange={(event) => updateSshTunnel('remoteHost', event.target.value)}
                            />
                            <Label className="self-center text-right text-sm">{t('connectionForm.port')}</Label>
                            <Input
                              type="number"
                              value={form.sshTunnel.remotePort ?? ''}
                              placeholder={String(form.port ?? '')}
                              disableTextAssistance
                              onChange={(event) =>
                                updateSshTunnel(
                                  'remotePort',
                                  event.target.value ? Number(event.target.value) : null,
                                )
                              }
                            />
                          </div>
                        </FormRow>
                      </>
                    )}
                  </div>
                </details>
              </>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <div className="min-w-0 whitespace-pre-line text-xs text-muted-foreground">
            {message ?? readinessIssue ?? ' '}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={test} disabled={loading}>
              <PlugZap />
              {t('connectionForm.testConnection')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={saveOnly}>
              {t('connectionForm.saveOnly')}
            </Button>
            <Button type="submit" disabled={loading || Boolean(readinessIssue)}>
              <Database />
              {t('connectionForm.saveAndConnect')}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
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
    <div className={`grid grid-cols-[112px_minmax(0,1fr)] gap-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <Label className={`text-right text-sm ${labelClassName ?? ''}`}>{label}</Label>
      <div className="min-w-0">{children}</div>
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
  const downloadUrl = driver?.downloadUrl ?? (input.driverType === 'oracle' ? ORACLE_JDBC_DOWNLOAD_URL : null)
  const title = requiresLocalJar ? t('connectionForm.localDriverRequired') : driverBackendLabel(driver?.backend ?? profileBackend(profile))
  const detail = requiresLocalJar
    ? (missing.length > 0
        ? t('connectionForm.missing', { items: missing.join(t('common.listSeparator', { defaultValue: ', ' })) })
        : t('connectionForm.externalDriverReady'))
    : t('connectionForm.nativeDriverReady')

  return (
    <div className="rounded-md border bg-background/70 px-3 py-2 text-xs">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">{title}</span>
            <span className={ready ? supportBadgeClass('ready') : supportBadgeClass('blocked')}>
              {ready ? t('connectionForm.connectable') : driverSupportStateLabel(profile.status, missing, t)}
            </span>
            <span className="text-[11px] text-muted-foreground">{detail}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {driverCapabilityBadges(capabilities, t).map((item) => (
              <span key={item.label} className={item.enabled ? capabilityOnClass : capabilityOffClass}>
                {item.label}
              </span>
            ))}
            {requiresLocalJar && downloadUrl && (
              <Button
                type="button"
                size="xs"
                variant="link"
                className="h-5 px-0 text-[11px]"
                onClick={() => {
                  void openExternalUrl(downloadUrl)
                }}
              >
                <Download className="size-3" />
                {t('connectionForm.openDownloadPage')}
              </Button>
            )}
          </div>
        </div>
        {ready ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        )}
      </div>
    </div>
  )
}

const capabilityOnClass =
  'rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-800'
const capabilityOffClass =
  'rounded-md border bg-muted/45 px-1.5 py-0.5 text-[11px] text-muted-foreground'

function supportBadgeClass(state: 'ready' | 'blocked') {
  return state === 'ready'
    ? 'rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-800'
    : 'rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800'
}

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
  return {
    ...input,
    driverDefinitionId: input.driverDefinitionId ?? input.driverType,
    driverDialect: definition?.driverDialect ?? input.driverDialect ?? input.driverType,
    host: emptyToNull(input.host),
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
  return driverType === 'postgres' || driverType === 'mysql' || driverType === 'mssql'
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
  ['postgres', 'mysql', 'oracle', 'sqlite', 'mssql'].map((driver, index) => [driver as DriverType, index]),
)

const FALLBACK_DRIVER_OPTIONS: Array<Pick<DriverDefinition, 'id' | 'driverType' | 'name' | 'status' | 'builtIn'>> = [
  { id: 'postgres', driverType: 'postgres', name: 'PostgreSQL', status: 'ready', builtIn: true },
  { id: 'mysql', driverType: 'mysql', name: 'MySQL', status: 'ready', builtIn: true },
  { id: 'oracle', driverType: 'oracle', name: 'Oracle (local ojdbc required)', status: 'configurable', builtIn: true },
  { id: 'sqlite', driverType: 'sqlite', name: 'SQLite', status: 'ready', builtIn: true },
  { id: 'mssql', driverType: 'mssql', name: 'SQL Server', status: 'ready', builtIn: true },
]

function compareDriverChoices(
  left: Pick<DriverDefinition, 'driverType' | 'name'>,
  right: Pick<DriverDefinition, 'driverType' | 'name'>,
) {
  const leftRank = PRIMARY_DRIVER_ORDER.get(left.driverType) ?? 99
  const rightRank = PRIMARY_DRIVER_ORDER.get(right.driverType) ?? 99
  return leftRank === rightRank ? left.name.localeCompare(right.name) : leftRank - rightRank
}
