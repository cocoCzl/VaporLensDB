import { FormEvent, useState, type ReactNode } from 'react'
import { Database, Download, PlugZap } from 'lucide-react'
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
  onSubmit: (input: ConnectionInput) => Promise<void>
  onTest: (input: ConnectionInput) => Promise<void>
  onCancel: () => void
}

export function ConnectionForm({
  connection,
  driverDefinitions = [],
  loading = false,
  onSubmit,
  onTest,
  onCancel,
}: ConnectionFormProps) {
  const [form, setForm] = useState<ConnectionInput>({
    id: connection?.id,
    name: connection?.name ?? 'Local PostgreSQL',
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
  })
  const [message, setMessage] = useState<string | null>(null)
  const [connectionVariant, setConnectionVariant] = useState<ConnectionVariant>(
    defaultConnectionVariant(connection?.driverType ?? 'postgres'),
  )
  const driverProfile = DRIVER_PROFILES[form.driverType]
  const selectableDrivers = driverDefinitions.length
    ? driverDefinitions.filter((driver) => PRIMARY_DRIVER_IDS.includes(driver.id))
    : FALLBACK_DRIVER_OPTIONS
  const selectedDriver = driverDefinitions.find((driver) => driver.id === form.driverType)
  const driverStatus = selectedDriver?.status ?? driverProfile.status

  const update = (key: keyof ConnectionInput, value: string | number | string[] | null) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const changeDriver = (driverType: DriverType) => {
    const profile = DRIVER_PROFILES[driverType]
    const nextVariant = defaultConnectionVariant(driverType)
    setConnectionVariant(nextVariant)
    setForm((current) => ({
      ...current,
      driverType,
      name: current.name || profile.defaultName,
      port: profile.defaultPort,
      database: current.database || profile.defaultDatabase,
      username: current.username || profile.defaultUsername,
      connectionUrl: profile.defaultUrl(current, nextVariant),
      driverClass: profile.driverClass ?? current.driverClass,
      driverPaths: current.driverPaths ?? [],
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    await onSubmit(normalizeInput(form, connectionVariant))
  }

  const test = async () => {
    setMessage(null)
    const validationError = validateRequiredFields(form, connectionVariant)
    if (validationError) {
      setMessage(validationError)
      return
    }

    try {
      await onTest(normalizeInput(form, connectionVariant))
      setMessage(driverProfile.externalDriver ? '本地驱动配置校验成功' : '连接测试成功')
    } catch (error) {
      const appError = normalizeAppError(error)
      setMessage(appError.detail ? `${appError.message}\n${appError.detail}` : appError.message)
    }
  }

  return (
    <form className="grid min-h-[560px] grid-cols-[240px_1fr] overflow-hidden rounded-md border" onSubmit={submit}>
      <aside className="border-r bg-muted/35">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          项目数据源
        </div>
        <button
          type="button"
          className="m-2 flex h-9 w-[calc(100%-1rem)] items-center gap-2 rounded-md bg-primary/15 px-2 text-left text-sm text-primary ring-1 ring-primary/30"
        >
          <Database className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{form.name || driverProfile.defaultName}</span>
        </button>
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          问题 <span className="rounded-full bg-muted px-1.5 py-0.5">0</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="grid grid-cols-[72px_minmax(0,1fr)_64px_180px] items-center gap-2 border-b p-4">
          <Label htmlFor="connection-name" className="text-right text-sm">
            名称:
          </Label>
          <Input
            id="connection-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            required
          />
          <Label htmlFor="connection-color" className="text-right text-sm">
            环境:
          </Label>
          <ColorTagInput
            value={form.colorTag ?? ''}
            onChange={(value) => update('colorTag', value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto grid max-w-4xl gap-3">
            <>
                <FormRow label="驱动程序:">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <select
                      id="driver-type"
                      className="ide-input"
                      value={form.driverType}
                      onChange={(event) => changeDriver(event.target.value as DriverType)}
                    >
                      {selectableDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id} disabled={driver.status === 'planned'}>
                          {driver.name}
                          {driver.status === 'planned' ? '（即将支持）' : ''}
                        </option>
                      ))}
                    </select>
                    <span className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground">
                      {driverStatusLabel(driverStatus)}
                    </span>
                  </div>
                </FormRow>

                {driverProfile.externalDriver && (
                  <FormRow label="">
                    <div className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">Oracle JDBC 驱动</div>
                          <div className="mt-1">{selectedDriver?.notes ?? driverProfile.description}</div>
                        </div>
                        <span className="shrink-0 rounded-md border bg-background px-2 py-1">
                          {externalDriverStatus(form)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t pt-2">
                        <span>v1 仅承诺连接测试和基础 SQL 查询；对象浏览、DDL、补全和取消查询暂未完整支持。</span>
                        <Button
                          type="button"
                          size="xs"
                          variant="link"
                          className="h-auto shrink-0 px-0"
                          onClick={() => window.open(ORACLE_JDBC_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
                        >
                          <Download className="size-3" />
                          打开下载页
                        </Button>
                      </div>
                    </div>
                  </FormRow>
                )}

                <FormRow label="连接类型:">
                  <SegmentedControl
                    options={driverProfile.connectionVariants}
                    value={connectionVariant}
                    onChange={setConnectionVariant}
                  />
                </FormRow>

                {connectionVariant !== 'urlOnly' && connectionVariant !== 'file' && (
                  <FormRow label="主机:">
                    <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                      <Input
                        id="connection-host"
                        value={form.host ?? ''}
                        onChange={(event) => update('host', event.target.value)}
                        required
                      />
                      <Label htmlFor="connection-port" className="self-center text-right text-sm">
                        端口:
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

                <FormRow label="身份验证:">
                  <select className="ide-input">
                    <option>用户与密码</option>
                  </select>
                </FormRow>

                <FormRow label="用户:">
                  <Input
                    id="connection-username"
                    value={form.username ?? ''}
                    onChange={(event) => update('username', event.target.value)}
                    required
                  />
                </FormRow>

                <FormRow label="密码:">
                  <div className="grid grid-cols-[minmax(0,1fr)_64px_128px] gap-2">
                    <Input
                      id="connection-password"
                      type="password"
                      value={form.password ?? ''}
                      placeholder={connection ? '<已隐藏>' : ''}
                      onChange={(event) => update('password', event.target.value)}
                    />
                    <Label className="self-center text-right text-sm">保存:</Label>
                    <select className="ide-input">
                      <option>永久</option>
                      <option>本次会话</option>
                    </select>
                  </div>
                </FormRow>

                {connectionVariant !== 'urlOnly' && connectionVariant !== 'file' && (
                  <FormRow label={databaseFieldLabel(connectionVariant)}>
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
                        connectionVariant === 'urlOnly'
                          ? (form.connectionUrl ?? '')
                          : driverProfile.defaultUrl(form, connectionVariant)
                      }
                      placeholder={driverProfile.urlPlaceholder}
                      readOnly={connectionVariant !== 'urlOnly'}
                      onChange={(event) => update('connectionUrl', event.target.value)}
                    />
                  </FormRow>
                )}

                {driverProfile.externalDriver && (
                  <>
                    <FormRow label="驱动类:">
                      <Input
                        id="driver-class"
                        value={form.driverClass ?? ''}
                        placeholder={driverProfile.driverClass}
                        onChange={(event) => update('driverClass', event.target.value)}
                      />
                    </FormRow>
                    <FormRow label="驱动文件:">
                      <Input
                        id="driver-paths"
                        value={form.driverPaths?.join('\n') ?? ''}
                        placeholder="/Users/me/drivers/ojdbc11.jar"
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

                <FormRow label="分组:">
                  <Input
                    id="connection-group"
                    value={form.group ?? ''}
                    onChange={(event) => update('group', event.target.value)}
                  />
                </FormRow>

                <details className="rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-sm font-medium">高级连接设置</summary>
                  <div className="mt-3 grid gap-3">
                    <FormRow label="SSL 模式:">
                      <select
                        className="ide-input"
                        value={form.sslMode ?? ''}
                        onChange={(event) => update('sslMode', event.target.value || null)}
                      >
                        <option value="">默认</option>
                        <option value="disable">disable</option>
                        <option value="prefer">prefer</option>
                        <option value="require">require</option>
                        <option value="verify-ca">verify-ca</option>
                        <option value="verify-full">verify-full</option>
                      </select>
                    </FormRow>
                  </div>
                </details>
              </>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <div className="min-w-0 whitespace-pre-line text-xs text-muted-foreground">
            {message ?? ' '}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={test} disabled={loading}>
              <PlugZap />
              测试连接
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              <Database />
              确定
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

function ColorTagInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
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
          title={environmentLabel(color)}
          onClick={() => onChange(color)}
        />
      ))}
      <span className="ml-1 min-w-12 text-xs text-muted-foreground">{environmentLabel(value)}</span>
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

function environmentLabel(color: string) {
  if (color === 'prod') return 'prod'
  if (color === 'stage') return 'stage'
  if (color === 'test') return 'test'
  if (color === 'dev') return 'dev'
  return '无'
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

function driverStatusLabel(status?: DriverDefinition['status'] | DriverProfile['status']) {
  if (status === 'ready') return '可用'
  if (status === 'configurable') return '需配置'
  if (status === 'planned') return '计划中'
  return '未知'
}

function externalDriverStatus(input: ConnectionInput) {
  if (!input.driverClass?.trim()) return '未配置驱动类'
  if (!input.driverPaths?.length) return '未配置 JAR'
  return '已填写配置'
}

function normalizeInput(input: ConnectionInput, variant: ConnectionVariant): ConnectionInput {
  const profile = DRIVER_PROFILES[input.driverType]
  return {
    ...input,
    host: emptyToNull(input.host),
    database: emptyToNull(input.database),
    connectionUrl:
      profile.usesUrl && variant !== 'urlOnly'
        ? profile.defaultUrl(input, variant)
        : emptyToNull(input.connectionUrl),
    username: emptyToNull(input.username),
    password: emptyToNull(input.password),
    driverClass: emptyToNull(input.driverClass),
    driverPaths: input.driverPaths ?? [],
    group: emptyToNull(input.group),
    colorTag: normalizeEnvironmentTag(input.colorTag),
  }
}

function emptyToNull(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : null
}

function validateRequiredFields(input: ConnectionInput, variant: ConnectionVariant) {
  if (!input.name.trim()) {
    return '连接名称必填'
  }

  if (requiresExternalDriverConfig(input.driverType)) {
    if (!input.driverClass?.trim()) {
      return 'Oracle JDBC 驱动类必填，默认应为 oracle.jdbc.OracleDriver'
    }
    if (!input.driverPaths?.length) {
      return 'Oracle 需要至少填写一个本地 ojdbc JAR 路径'
    }
  }

  if (variant === 'urlOnly') {
    if (!input.connectionUrl?.trim()) {
      return 'URL 必填'
    }
    return null
  }

  if (!input.host?.trim() && variant !== 'file') {
    return '主机必填'
  }

  if (!input.database?.trim() && requiresDatabase(input.driverType)) {
    return '数据库必填，PostgreSQL 本地默认可填 postgres'
  }

  if (!input.username?.trim() && requiresUsername(input.driverType)) {
    return '用户名必填'
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
    description: 'Oracle 为实验性 JDBC 支持，需要用户提供 ojdbc.jar；测试连接会通过 JDBC bridge 执行真实 ping。',
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
    description: '自定义 JDBC 会通过 JDBC bridge 动态加载驱动类、JDBC URL 和 jar 路径。',
    urlPlaceholder: 'jdbc:vendor://host:port/database',
    connectionVariants: [{ id: 'urlOnly', label: 'URL only' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  odbc: {
    defaultName: 'Custom ODBC',
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'configurable',
    usesUrl: true,
    externalDriver: true,
    description: '自定义 ODBC 会保存连接字符串，用于后续 ODBC bridge 调用系统驱动。',
    urlPlaceholder: 'Driver={Driver Name};Server=host;Port=port;Database=db;',
    connectionVariants: [{ id: 'urlOnly', label: 'URL only' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  sqlite: {
    defaultName: 'SQLite',
    defaultPort: 0,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'planned',
    usesUrl: true,
    urlPlaceholder: '/path/to/database.sqlite',
    connectionVariants: [{ id: 'file', label: 'File' }],
    defaultUrl: (input) => input.connectionUrl || '',
  },
  mssql: {
    defaultName: 'SQL Server',
    defaultPort: 1433,
    defaultDatabase: 'master',
    defaultUsername: 'sa',
    status: 'planned',
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

function databaseFieldLabel(variant: ConnectionVariant) {
  if (variant === 'oracleSid') return 'SID:'
  if (variant === 'oracleService') return '服务名:'
  return '数据库:'
}

const PRIMARY_DRIVER_IDS: DriverType[] = ['postgres', 'mysql', 'oracle', 'sqlite', 'mssql']

const FALLBACK_DRIVER_OPTIONS: Array<Pick<DriverDefinition, 'id' | 'name' | 'status'>> = [
  { id: 'postgres', name: 'PostgreSQL', status: 'ready' },
  { id: 'mysql', name: 'MySQL', status: 'ready' },
  { id: 'oracle', name: 'Oracle（实验性，需要 JDBC 驱动）', status: 'configurable' },
  { id: 'sqlite', name: 'SQLite', status: 'planned' },
  { id: 'mssql', name: 'SQL Server', status: 'planned' },
]
