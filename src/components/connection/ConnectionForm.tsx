import { FormEvent, useState, type ReactNode } from 'react'
import { Database, Download, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConnectionConfig, ConnectionInput, DriverType } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'

type ConnectionFormTab = 'general' | 'options' | 'sshSsl' | 'schemas' | 'advanced'

const CONNECTION_TABS: Array<{ id: ConnectionFormTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'options', label: '选项' },
  { id: 'sshSsl', label: 'SSH/SSL' },
  { id: 'schemas', label: '架构' },
  { id: 'advanced', label: '高级' },
]

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
  const [activeTab, setActiveTab] = useState<ConnectionFormTab>('general')
  const driverProfile = DRIVER_PROFILES[form.driverType]
  const selectableDrivers = driverDefinitions.length
    ? driverDefinitions.filter((driver) => driver.status !== 'planned')
    : FALLBACK_DRIVER_OPTIONS
  const selectedDriver = driverDefinitions.find((driver) => driver.id === form.driverType)
  const driverStatus = selectedDriver?.status ?? driverProfile.status

  const update = (key: keyof ConnectionInput, value: string | number | string[] | null) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const changeDriver = (driverType: DriverType) => {
    const profile = DRIVER_PROFILES[driverType]
    setForm((current) => ({
      ...current,
      driverType,
      name: current.name || profile.defaultName,
      port: profile.defaultPort,
      database: current.database || profile.defaultDatabase,
      username: current.username || profile.defaultUsername,
      connectionUrl: profile.defaultUrl(current),
      driverClass: profile.driverClass ?? current.driverClass,
      driverPaths: current.driverPaths ?? [],
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    await onSubmit(normalizeInput(form))
  }

  const test = async () => {
    setMessage(null)
    const validationError = validateRequiredFields(form)
    if (validationError) {
      setMessage(validationError)
      return
    }

    try {
      await onTest(normalizeInput(form))
      setMessage(driverProfile.externalDriver ? '本地驱动配置校验成功' : '连接测试成功')
    } catch {
      setMessage('连接测试失败')
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
            颜色:
          </Label>
          <ColorTagInput
            value={form.colorTag ?? ''}
            onChange={(value) => update('colorTag', value)}
          />
        </div>

        <div className="flex gap-2 border-b px-4">
          {CONNECTION_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={activeTab === item.id}
              className={[
                'h-11 border-b-2 px-3 text-sm font-medium',
                activeTab === item.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto grid max-w-4xl gap-3">
            {activeTab === 'general' ? (
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
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
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
                    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                      <span>{selectedDriver?.notes ?? driverProfile.description}</span>
                      <Button type="button" size="xs" variant="link" className="h-auto px-0">
                        <Download className="size-3" />
                        下载
                      </Button>
                    </div>
                  </FormRow>
                )}

                <FormRow label="连接类型:">
                  <SegmentedControl options={['default', 'Unix Socket', 'URL only']} />
                </FormRow>

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

                <FormRow label="数据库:">
                  <Input
                    id="connection-database"
                    value={form.database ?? ''}
                    onChange={(event) => update('database', event.target.value)}
                    required
                  />
                </FormRow>

                {driverProfile.usesUrl && (
                  <FormRow label="URL:">
                    <Input
                      id="connection-url"
                      value={form.connectionUrl ?? ''}
                      placeholder={driverProfile.urlPlaceholder}
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
              </>
            ) : (
              <ConnectionTabPanel
                tab={activeTab}
                form={form}
                update={update}
                driver={selectedDriver}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
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

function ConnectionTabPanel({
  tab,
  form,
  update,
  driver,
}: {
  tab: Exclude<ConnectionFormTab, 'general'>
  form: ConnectionInput
  update: (key: keyof ConnectionInput, value: string | number | string[] | null) => void
  driver?: DriverDefinition
}) {
  if (tab === 'options') {
    return (
      <>
        <SectionTitle title="查询和连接选项" detail="这些选项会逐步接入后端执行引擎。" />
        <FormRow label="默认 schema:">
          <Input placeholder="例如 public" />
        </FormRow>
        <FormRow label="连接超时:">
          <div className="grid grid-cols-[160px_auto] items-center gap-2">
            <Input type="number" defaultValue={30} />
            <span className="text-xs text-muted-foreground">秒</span>
          </div>
        </FormRow>
        <FormRow label="只读连接:">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-primary" />
            避免误执行写入语句
          </label>
        </FormRow>
        <FormRow label="自动提交:">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-primary" defaultChecked />
            查询后自动提交事务
          </label>
        </FormRow>
      </>
    )
  }

  if (tab === 'sshSsl') {
    return (
      <>
        <SectionTitle title="SSH / SSL" detail="当前已保存 SSL 模式；SSH 隧道服务将在后续阶段接入。" />
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
        <FormRow label="SSH 隧道:">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-primary" disabled />
            后续支持跳板机连接
          </label>
        </FormRow>
        <FormRow label="本地主机:">
          <Input disabled placeholder="127.0.0.1" />
        </FormRow>
        <FormRow label="远程端口:">
          <Input disabled placeholder="22" />
        </FormRow>
      </>
    )
  }

  if (tab === 'schemas') {
    return (
      <>
        <SectionTitle title="架构过滤" detail="保存后将用于对象浏览器的默认展示范围。" />
        <FormRow label="加载策略:">
          <select className="ide-input">
            <option>连接后按需加载</option>
            <option>连接后预加载当前数据库</option>
          </select>
        </FormRow>
        <FormRow label="包含:">
          <Input placeholder="public, app_*" />
        </FormRow>
        <FormRow label="排除:">
          <Input placeholder="information_schema, pg_catalog" />
        </FormRow>
        <FormRow label="">
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            当前驱动 {driver?.capabilities.canReadMetadata ? '支持' : '尚未支持'} 元数据读取。
          </div>
        </FormRow>
      </>
    )
  }

  return (
    <>
      <SectionTitle title="高级" detail="用于特殊驱动和诊断场景，普通连接无需修改。" />
      <FormRow label="连接 URL:">
        <Input
          value={form.connectionUrl ?? ''}
          placeholder="可覆盖自动生成的连接 URL"
          onChange={(event) => update('connectionUrl', event.target.value)}
        />
      </FormRow>
      <FormRow label="驱动类:">
        <Input
          value={form.driverClass ?? ''}
          placeholder="JDBC driver class"
          onChange={(event) => update('driverClass', event.target.value)}
        />
      </FormRow>
      <FormRow label="驱动文件:">
        <Input
          value={form.driverPaths?.join(', ') ?? ''}
          placeholder="/path/to/driver.jar"
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
  )
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-1 border-b pb-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function SegmentedControl({ options }: { options: string[] }) {
  return (
    <div className="inline-flex h-8 overflow-hidden rounded-md border">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          className={[
            'border-r px-4 text-sm last:border-r-0',
            index === 0 ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
          ].join(' ')}
        >
          {option}
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
  const colors = ['', 'dev', 'prod', 'stage']
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
          title={color || '无颜色'}
          onClick={() => onChange(color)}
        />
      ))}
      <Input
        id="connection-color"
        className="h-6 min-w-0 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        value={value}
        placeholder="无颜色"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function colorSwatchClass(color: string) {
  if (color === 'prod') return 'bg-red-500'
  if (color === 'stage') return 'bg-amber-500'
  if (color === 'dev') return 'bg-emerald-500'
  return 'bg-transparent'
}

function driverStatusLabel(status?: DriverDefinition['status'] | DriverProfile['status']) {
  if (status === 'ready') return '可用'
  if (status === 'configurable') return '需配置'
  if (status === 'planned') return '计划中'
  return '未知'
}

function normalizeInput(input: ConnectionInput): ConnectionInput {
  return {
    ...input,
    host: emptyToNull(input.host),
    database: emptyToNull(input.database),
    connectionUrl: emptyToNull(input.connectionUrl),
    username: emptyToNull(input.username),
    password: emptyToNull(input.password),
    driverClass: emptyToNull(input.driverClass),
    driverPaths: input.driverPaths ?? [],
    group: emptyToNull(input.group),
    colorTag: emptyToNull(input.colorTag),
  }
}

function emptyToNull(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : null
}

function validateRequiredFields(input: ConnectionInput) {
  if (!input.name.trim()) {
    return '连接名称必填'
  }

  if (!input.host?.trim() && !DRIVER_PROFILES[input.driverType].usesUrl) {
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
  defaultUrl: (input: ConnectionInput) => string
}

const DRIVER_PROFILES: Record<DriverType, DriverProfile> = {
  postgres: {
    defaultName: 'Local PostgreSQL',
    defaultPort: 5432,
    defaultDatabase: 'postgres',
    defaultUsername: 'postgres',
    status: 'ready',
    defaultUrl: () => '',
  },
  mysql: {
    defaultName: 'Local MySQL',
    defaultPort: 3306,
    defaultDatabase: 'mysql',
    defaultUsername: 'root',
    status: 'ready',
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
    description: 'Oracle 使用 JDBC 外部驱动模式，需要用户提供 ojdbc.jar；测试连接会通过 JDBC bridge 执行真实 ping。',
    driverClass: 'oracle.jdbc.OracleDriver',
    urlPlaceholder: 'jdbc:oracle:thin:@//localhost:1521/ORCLPDB1',
    defaultUrl: (input) =>
      input.connectionUrl ||
      `jdbc:oracle:thin:@//${input.host || 'localhost'}:${input.port || 1521}/${input.database || 'ORCLPDB1'}`,
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
    defaultUrl: (input) => input.connectionUrl || '',
  },
  mssql: {
    defaultName: 'SQL Server',
    defaultPort: 1433,
    defaultDatabase: 'master',
    defaultUsername: 'sa',
    status: 'planned',
    defaultUrl: () => '',
  },
  mongo: {
    defaultName: 'MongoDB',
    defaultPort: 27017,
    defaultDatabase: 'admin',
    defaultUsername: '',
    status: 'planned',
    defaultUrl: () => '',
  },
  redis: {
    defaultName: 'Redis',
    defaultPort: 6379,
    defaultDatabase: '',
    defaultUsername: '',
    status: 'planned',
    defaultUrl: () => '',
  },
}

const FALLBACK_DRIVER_OPTIONS: Array<Pick<DriverDefinition, 'id' | 'name' | 'status'>> = [
  { id: 'postgres', name: 'PostgreSQL', status: 'ready' },
  { id: 'mysql', name: 'MySQL / MariaDB', status: 'ready' },
  { id: 'oracle', name: 'Oracle', status: 'configurable' },
  { id: 'jdbc', name: '自定义 JDBC', status: 'configurable' },
  { id: 'odbc', name: '自定义 ODBC', status: 'configurable' },
]
