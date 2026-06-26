import { FormEvent, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Database, Download, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeAppError } from '@/ipc/client'
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
}

export function ConnectionForm({
  connection,
  driverDefinitions = [],
  loading = false,
  onSaveOnly,
  onSaveAndConnect,
  onTest,
  onCancel,
}: ConnectionFormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ConnectionInput>({
    id: connection?.id,
    name: connection?.name ?? 'Local PostgreSQL',
    driverDefinitionId: connection?.driverDefinitionId ?? connection?.driverType ?? 'postgres',
    driverType: connection?.driverType ?? 'postgres',
    host: connection?.host ?? 'localhost',
    port: connection?.port ?? 5432,
    database: connection?.database ?? 'postgres',
    connectionUrl: connection?.connectionUrl ?? '',
    username: connection?.username ?? 'postgres',
    password: '',
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
  const readinessIssue = connectionReadinessIssue(form, t)

  const activeConnectionVariant = driverProfile.connectionVariants.some(
    (variant) => variant.id === connectionVariant,
  )
    ? connectionVariant
    : driverProfile.connectionVariants[0].id

  const update = (key: keyof ConnectionInput, value: string | number | string[] | null) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateSshTunnel = (key: string, value: string | number | boolean | null) => {
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
    const definition = driverDefinitions.find((driver) => driver.id === driverDefinitionId)
    const driverType = definition?.driverType ?? (driverDefinitionId as DriverType)
    const profile = profileForDriver(driverType, definition)
    const nextVariant = profile.connectionVariants[0].id
    setConnectionVariant(nextVariant)
    setForm((current) => ({
      ...current,
      driverDefinitionId: definition?.id ?? driverType,
      driverType,
      name: current.name || definition?.name || profile.defaultName,
      port: profile.defaultPort,
      database: current.database || profile.defaultDatabase,
      username: current.username || profile.defaultUsername,
      connectionUrl: profile.defaultUrl(current, nextVariant),
      driverClass: profile.driverClass ?? '',
      driverPaths: current.driverPaths?.length ? current.driverPaths : (definition?.driverArtifacts ?? []),
    }))
  }

  const normalizedForm = () => normalizeInput(form, activeConnectionVariant, driverProfile, selectedDriver)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    const validationError = validateRequiredFields(form, activeConnectionVariant, { requireExternalDriver: true }, t)
    if (validationError) {
      setMessage(validationError)
      return
    }
    await onSaveAndConnect(normalizedForm())
  }

  const saveOnly = async () => {
    setMessage(null)
    const validationError = validateRequiredFields(form, activeConnectionVariant, { requireExternalDriver: false }, t)
    if (validationError) {
      setMessage(validationError)
      return
    }
    await onSaveOnly(normalizedForm())
  }

  const test = async () => {
    setMessage(null)
    const validationError = validateRequiredFields(form, activeConnectionVariant, { requireExternalDriver: true }, t)
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
    <form className="grid min-h-[560px] grid-cols-[240px_1fr] overflow-hidden rounded-md border" onSubmit={submit}>
      <aside className="border-r bg-muted/35">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          {t('connectionForm.projectDataSources')}
        </div>
        <div className="m-2 flex h-9 w-[calc(100%-1rem)] items-center gap-2 rounded-md bg-primary/15 px-2 text-left text-sm text-primary ring-1 ring-primary/30">
          <Database className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{form.name || driverProfile.defaultName}</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="grid grid-cols-[72px_minmax(0,1fr)_64px_180px] items-center gap-2 border-b p-4">
          <Label htmlFor="connection-name" className="text-right text-sm">
            {t('connectionForm.name')}
          </Label>
          <Input
            id="connection-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
          />
          <Label htmlFor="connection-color" className="text-right text-sm">
            {t('connectionForm.environment')}
          </Label>
          <ColorTagInput
            value={form.colorTag ?? ''}
            onChange={(value) => update('colorTag', value)}
            t={t}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto grid max-w-4xl gap-3">
            <>
                <FormRow label={t('connectionForm.driver')}>
                  <div className="grid gap-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <select
                      id="driver-type"
                      className="ide-input"
                      value={selectedDriver?.id ?? form.driverType}
                      onChange={(event) => changeDriver(event.target.value)}
                    >
                      {selectableDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id} disabled={driver.status === 'planned'}>
                          {driver.name}
                          {!driver.builtIn ? ` (${t('connectionForm.custom')})` : ''}
                          {driver.status === 'planned' ? ` (${t('connectionForm.planned')})` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground">
                      {driverStatusLabel(driverStatus, t)}
                    </span>
                  </div>
                  {selectedDriver && <DriverDefinitionSummary driver={selectedDriver} t={t} />}
                  <DriverSupportSummary
                    driver={selectedDriver}
                    profile={driverProfile}
                    input={form}
                    readinessIssue={readinessIssue}
                    t={t}
                  />
                  </div>
                </FormRow>

                {driverProfile.externalDriver && (
                  <FormRow label="">
                    <div className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{t('connectionForm.oracleJdbcDriver')}</div>
                          <div className="mt-1">{selectedDriver?.notes ?? driverProfile.description}</div>
                        </div>
                        <span className="shrink-0 rounded-md border bg-background px-2 py-1">
                          {externalDriverStatus(form, t)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t pt-2">
                        <span>{t('connectionForm.oracleRequirement')}</span>
                        <Button
                          type="button"
                          size="xs"
                          variant="link"
                          className="h-auto shrink-0 px-0"
                          onClick={() => window.open(ORACLE_JDBC_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
                        >
                          <Download className="size-3" />
                          {t('connectionForm.openDownloadPage')}
                        </Button>
                      </div>
                    </div>
                  </FormRow>
                )}

                <FormRow label={t('connectionForm.connectionType')}>
                  <SegmentedControl
                    options={driverProfile.connectionVariants}
                    value={activeConnectionVariant}
                    onChange={setConnectionVariant}
                  />
                </FormRow>

                {activeConnectionVariant !== 'urlOnly' && activeConnectionVariant !== 'file' && (
                  <FormRow label={t('connectionForm.host')}>
                    <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                      <Input
                        id="connection-host"
                        value={form.host ?? ''}
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
                        onChange={(event) => update('port', Number(event.target.value))}
                        required
                      />
                    </div>
                  </FormRow>
                )}

                <FormRow label={t('connectionForm.authentication')}>
                  <select className="ide-input">
                    <option>{t('connectionForm.userPassword')}</option>
                  </select>
                </FormRow>

                <FormRow label={t('connectionForm.user')}>
                  <Input
                    id="connection-username"
                    value={form.username ?? ''}
                    onChange={(event) => update('username', event.target.value)}
                    required
                  />
                </FormRow>

                <FormRow label={t('connectionForm.password')}>
                  <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                    <Input
                      id="connection-password"
                      type="password"
                      value={form.password ?? ''}
                      placeholder={connection ? t('common.hidden') : ''}
                      onChange={(event) => update('password', event.target.value)}
                    />
                    <Label className="self-center text-right text-sm">{t('connectionForm.savePassword')}</Label>
                    <select className="ide-input" defaultValue="secure">
                      <option value="none">{t('connectionForm.doNotSave')}</option>
                      <option value="session">{t('connectionForm.sessionOnly')}</option>
                      <option value="secure">{t('connectionForm.secureStorage')}</option>
                    </select>
                  </div>
                </FormRow>

                {activeConnectionVariant !== 'urlOnly' && activeConnectionVariant !== 'file' && (
                  <FormRow label={databaseFieldLabel(activeConnectionVariant, t)}>
                    <Input
                      id="connection-database"
                      value={form.database ?? ''}
                      onChange={(event) => update('database', event.target.value)}
                      required
                    />
                  </FormRow>
                )}

                {driverProfile.usesUrl && (
                  <FormRow label="URL:">
                    <Input
                      id="connection-url"
                      value={
                        activeConnectionVariant === 'urlOnly'
                          ? (form.connectionUrl ?? '')
                          : driverProfile.defaultUrl(form, activeConnectionVariant)
                      }
                      placeholder={driverProfile.urlPlaceholder}
                      readOnly={activeConnectionVariant !== 'urlOnly'}
                      onChange={(event) => update('connectionUrl', event.target.value)}
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
                        onChange={(event) => update('driverClass', event.target.value)}
                      />
                    </FormRow>
                    <FormRow label={t('connectionForm.driverFiles')}>
                      <Input
                        id="driver-paths"
                        value={form.driverPaths?.join('\n') ?? ''}
                        placeholder="/path/to/ojdbc11.jar"
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
                  <Input
                    id="connection-group"
                    value={form.group ?? ''}
                    onChange={(event) => update('group', event.target.value)}
                  />
                </FormRow>

                <details className="rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t('connectionForm.advanced')}</summary>
                  <div className="mt-3 grid gap-3">
                    <FormRow label={t('connectionForm.sslMode')}>
                      <select
                        className="ide-input"
                        value={form.sslMode ?? ''}
                        onChange={(event) => update('sslMode', event.target.value || null)}
                      >
                        <option value="">{t('common.default')}</option>
                        <option value="disable">disable</option>
                        <option value="prefer">prefer</option>
                        <option value="require">require</option>
                        <option value="verify-ca">verify-ca</option>
                        <option value="verify-full">verify-full</option>
                      </select>
                    </FormRow>

                    <FormRow label={t('connectionForm.sshTunnel')}>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(form.sshTunnel?.enabled)}
                          onChange={(event) => updateSshTunnel('enabled', event.target.checked)}
                        />
                        <span>{t('connectionForm.enableSshTunnel')}</span>
                      </label>
                    </FormRow>

                    {form.sshTunnel?.enabled && (
                      <>
                        <FormRow label={t('connectionForm.sshHost')}>
                          <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                            <Input
                              value={form.sshTunnel.host}
                              onChange={(event) => updateSshTunnel('host', event.target.value)}
                              required
                            />
                            <Label className="self-center text-right text-sm">{t('connectionForm.port')}</Label>
                            <Input
                              type="number"
                              value={form.sshTunnel.port}
                              onChange={(event) => updateSshTunnel('port', Number(event.target.value))}
                              required
                            />
                          </div>
                        </FormRow>
                        <FormRow label={t('connectionForm.sshUser')}>
                          <Input
                            value={form.sshTunnel.username}
                            onChange={(event) => updateSshTunnel('username', event.target.value)}
                            required
                          />
                        </FormRow>
                        <FormRow label={t('connectionForm.sshAuth')}>
                          <select
                            className="ide-input"
                            value={form.sshTunnel.authMethod}
                            onChange={(event) => updateSshTunnel('authMethod', event.target.value)}
                          >
                            <option value="privateKey">Private key</option>
                            <option value="password">Password</option>
                          </select>
                        </FormRow>
                        {form.sshTunnel.authMethod === 'password' ? (
                          <FormRow label={t('connectionForm.sshPassword')}>
                            <Input
                              type="password"
                              value={form.sshTunnel.password ?? ''}
                              placeholder={connection?.sshTunnel ? t('common.hidden') : ''}
                              onChange={(event) => updateSshTunnel('password', event.target.value)}
                            />
                          </FormRow>
                        ) : (
                          <>
                            <FormRow label={t('connectionForm.privateKeyPath')}>
                              <Input
                                value={form.sshTunnel.privateKeyPath ?? ''}
                                placeholder="/Users/me/.ssh/id_ed25519"
                                onChange={(event) => updateSshTunnel('privateKeyPath', event.target.value)}
                                required
                              />
                            </FormRow>
                            <FormRow label={t('connectionForm.privateKeyPassphrase')}>
                              <Input
                                type="password"
                                value={form.sshTunnel.privateKeyPassphrase ?? ''}
                                placeholder={connection?.sshTunnel ? t('common.hidden') : ''}
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
                              onChange={(event) => updateSshTunnel('remoteHost', event.target.value)}
                            />
                            <Label className="self-center text-right text-sm">{t('connectionForm.port')}</Label>
                            <Input
                              type="number"
                              value={form.sshTunnel.remotePort ?? ''}
                              placeholder={String(form.port ?? '')}
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

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
      <Label className="text-right text-sm">{label}</Label>
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

function DriverDefinitionSummary({ driver, t }: { driver: DriverDefinition; t: TFunction }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={driverOriginBadgeClass(driver)}>{driverOriginLabel(driver, t)}</span>
      <span className="rounded-md border bg-background px-2 py-0.5">
        {driverBackendLabel(driver.backend)}
      </span>
      {driver.userDriverRequired && (
        <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800">
          {t('connectionForm.localDriverRequired')}
        </span>
      )}
      {!driver.builtIn && (
        <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800">
          {t('connectionForm.editable')}
        </span>
      )}
      {driver.builtIn && (
        <span className="rounded-md border bg-muted/45 px-2 py-0.5">
          {t('connectionForm.builtInReadOnly')}
        </span>
      )}
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

  return (
    <div className="rounded-md border bg-background/70 p-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">{t('connectionForm.supportStatus')}</span>
            <span className="rounded-md border bg-muted/45 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {driverBackendLabel(driver?.backend ?? profileBackend(profile))}
            </span>
            <span className={ready ? supportBadgeClass('ready') : supportBadgeClass('blocked')}>
              {ready ? t('connectionForm.connectable') : driverSupportStateLabel(profile.status, missing, t)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {driverCapabilityBadges(capabilities, t).map((item) => (
              <span key={item.label} className={item.enabled ? capabilityOnClass : capabilityOffClass}>
                {item.label}
              </span>
            ))}
          </div>
        </div>
        {ready ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        )}
      </div>
      {(profile.externalDriver || driver?.userDriverRequired) && (
        <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{t('connectionForm.externalDriverRequirement')}</span>
          {missing.length > 0 ? missing.join(t('common.listSeparator', { defaultValue: ', ' })) : t('connectionForm.externalDriverReady')}
        </div>
      )}
      {profile.description && (
        <div className="mt-1 text-[11px] text-muted-foreground">{profile.description}</div>
      )}
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

function driverOriginLabel(driver: DriverDefinition, t: TFunction) {
  if (!driver.builtIn) return t('drivers.customOrigin', { defaultValue: 'Custom' })
  if (driver.status === 'configurable') return t('drivers.presetOrigin', { defaultValue: 'Preset' })
  return t('drivers.builtInOrigin', { defaultValue: 'Built-in' })
}

function driverOriginBadgeClass(driver: DriverDefinition) {
  if (!driver.builtIn) {
    return 'rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800'
  }
  if (driver.status === 'configurable') {
    return 'rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-800'
  }
  return 'rounded-md border bg-muted/45 px-2 py-0.5 text-foreground'
}

function driverBackendLabel(backend: DriverDefinition['backend']) {
  if (backend === 'nativeRust') return 'Native Rust'
  if (backend === 'jdbc') return 'JDBC'
  return 'Planned'
}

function ColorTagInput({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (value: string) => void
  t: TFunction
}) {
  const colors = ['', 'dev', 'test', 'stage', 'prod']
  return (
    <div className="flex h-8 items-center gap-1 rounded-md border bg-card px-2">
      {colors.map((color) => (
        <button
          key={color || 'none'}
          type="button"
          className={[
            'size-4 rounded-full border',
            colorSwatchClass(color),
            value === color ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : '',
          ].join(' ')}
          title={environmentLabel(color, t)}
          onClick={() => onChange(color)}
        />
      ))}
      <span className="ml-1 min-w-12 text-xs text-muted-foreground">{environmentLabel(value, t)}</span>
    </div>
  )
}

function colorSwatchClass(color: string) {
  if (color === 'prod') return 'bg-red-500'
  if (color === 'stage') return 'bg-amber-500'
  if (color === 'test') return 'bg-sky-500'
  if (color === 'dev') return 'bg-emerald-500'
  return 'bg-transparent'
}

function environmentLabel(color: string, t: TFunction) {
  if (color === 'prod') return 'prod'
  if (color === 'stage') return 'stage'
  if (color === 'test') return 'test'
  if (color === 'dev') return 'dev'
  return t('common.none')
}

function normalizeEnvironmentTag(value: string | null | undefined) {
  const normalized = emptyToNull(value)
  return normalized === 'dev' ||
    normalized === 'test' ||
    normalized === 'stage' ||
    normalized === 'prod'
    ? normalized
    : null
}

function driverStatusLabel(status: DriverDefinition['status'] | DriverProfile['status'] | undefined, t: TFunction) {
  if (status === 'ready') return t('connectionForm.statusReady')
  if (status === 'configurable') return t('connectionForm.statusConfigurable')
  if (status === 'planned') return t('connectionForm.statusPlanned')
  return t('connectionForm.statusUnknown')
}

function externalDriverStatus(input: ConnectionInput, t: TFunction) {
  if (!input.driverClass?.trim()) return t('connectionForm.driverClassMissing')
  if (!input.driverPaths?.length) return t('connectionForm.jarMissing')
  return t('connectionForm.configured')
}

function normalizeInput(
  input: ConnectionInput,
  variant: ConnectionVariant,
  profile: DriverProfile,
  definition?: DriverDefinition,
): ConnectionInput {
  return {
    ...input,
    driverDefinitionId: input.driverDefinitionId ?? input.driverType,
    host: emptyToNull(input.host),
    database: emptyToNull(input.database),
    connectionUrl:
      profile.usesUrl && variant !== 'urlOnly'
        ? emptyToNull(profile.defaultUrl(input, variant))
        : emptyToNull(input.connectionUrl),
    username: emptyToNull(input.username),
    password: emptyToNull(input.password),
    driverClass: emptyToNull(input.driverClass),
    driverPaths: input.driverPaths?.length ? input.driverPaths : (definition?.driverArtifacts ?? []),
    group: emptyToNull(input.group),
    colorTag: normalizeEnvironmentTag(input.colorTag),
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
  validationMode: { requireExternalDriver: boolean },
  t: TFunction,
) {
  if (!input.name.trim()) {
    return t('connectionForm.validation.nameRequired')
  }

  if (validationMode.requireExternalDriver && requiresExternalDriverConfig(input.driverType)) {
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

  if (variant === 'urlOnly') {
    if (!input.connectionUrl?.trim()) {
      return t('connectionForm.validation.urlRequired')
    }
    return null
  }

  if (!input.host?.trim() && variant !== 'file') {
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

function connectionReadinessIssue(input: ConnectionInput, t: TFunction) {
  if (!requiresExternalDriverConfig(input.driverType)) {
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
  return driverType === 'postgres' || driverType === 'mysql' || driverType === 'mssql'
}

function requiresExternalDriverConfig(driverType: DriverType) {
  return driverType === 'oracle' || driverType === 'jdbc'
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

const HOST_PORT_VARIANTS: ConnectionVariantOption[] = [
  { id: 'hostPort', label: 'Host/Port' },
  { id: 'urlOnly', label: 'URL only' },
]

const DRIVER_PROFILES: Record<DriverType, DriverProfile> = {
  postgres: {
    defaultName: 'Local PostgreSQL',
    defaultPort: 5432,
    defaultDatabase: 'postgres',
    defaultUsername: 'postgres',
    status: 'ready',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  mysql: {
    defaultName: 'Local MySQL',
    defaultPort: 3306,
    defaultDatabase: 'mysql',
    defaultUsername: 'root',
    status: 'ready',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  oracle: {
    defaultName: 'Oracle',
    defaultPort: 1521,
    defaultDatabase: 'ORCLPDB1',
    defaultUsername: 'system',
    status: 'configurable',
    usesUrl: true,
    externalDriver: true,
    description: 'Oracle requires a user-provided local ojdbc.jar.',
    driverClass: 'oracle.jdbc.OracleDriver',
    urlPlaceholder: 'jdbc:oracle:thin:@//localhost:1521/ORCLPDB1',
    connectionVariants: [
      { id: 'oracleService', label: 'Service Name' },
      { id: 'oracleSid', label: 'SID' },
      { id: 'urlOnly', label: 'URL only' },
    ],
    defaultUrl: (input, variant) => {
      const host = input.host || 'localhost'
      const port = input.port || 1521
      const database = input.database || 'ORCLPDB1'
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
    defaultDatabase: 'master',
    defaultUsername: 'sa',
    status: 'ready',
    usesUrl: true,
    urlPlaceholder: 'server=tcp:host,1433;database=master;user=sa;password=secret;TrustServerCertificate=true',
    connectionVariants: HOST_PORT_VARIANTS,
    defaultUrl: () => '',
  },
  mongo: {
    defaultName: 'MongoDB',
    defaultPort: 27017,
    defaultDatabase: 'admin',
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
