import { FormEvent, useState } from 'react'
import { Database, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ConnectionConfig, ConnectionInput, DriverType } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'

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
    group: connection?.group ?? '',
    colorTag: connection?.colorTag ?? '',
  })
  const [message, setMessage] = useState<string | null>(null)
  const driverProfile = DRIVER_PROFILES[form.driverType]
  const selectableDrivers = driverDefinitions.length
    ? driverDefinitions.filter((driver) => driver.status !== 'planned')
    : FALLBACK_DRIVER_OPTIONS
  const selectedDriver = driverDefinitions.find((driver) => driver.id === form.driverType)

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
    <form className="grid gap-3" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor="connection-name">连接名称</Label>
        <Input
          id="connection-name"
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="driver-type">数据库类型</Label>
        <select
          id="driver-type"
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          value={form.driverType}
          onChange={(event) => changeDriver(event.target.value as DriverType)}
        >
          {selectableDrivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </select>
      </div>

      {driverProfile.externalDriver && (
        <div className="rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
          {selectedDriver?.notes ?? driverProfile.description}
        </div>
      )}

      <div className="grid grid-cols-[1fr_96px] gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="connection-host">主机</Label>
          <Input
            id="connection-host"
            value={form.host ?? ''}
            onChange={(event) => update('host', event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="connection-port">端口</Label>
          <Input
            id="connection-port"
            type="number"
            value={form.port ?? 5432}
            onChange={(event) => update('port', Number(event.target.value))}
            required
          />
        </div>
      </div>

      {driverProfile.usesUrl && (
        <div className="grid gap-1.5">
          <Label htmlFor="connection-url">连接 URL</Label>
          <Input
            id="connection-url"
            value={form.connectionUrl ?? ''}
            placeholder={driverProfile.urlPlaceholder}
            onChange={(event) => update('connectionUrl', event.target.value)}
          />
        </div>
      )}

      {driverProfile.externalDriver && (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="driver-class">驱动类</Label>
            <Input
              id="driver-class"
              value={form.driverClass ?? ''}
              placeholder={driverProfile.driverClass}
              onChange={(event) => update('driverClass', event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="driver-paths">驱动文件路径</Label>
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
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="connection-database">数据库</Label>
        <Input
          id="connection-database"
          value={form.database ?? ''}
          onChange={(event) => update('database', event.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="connection-username">用户名</Label>
          <Input
            id="connection-username"
            value={form.username ?? ''}
            onChange={(event) => update('username', event.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="connection-password">密码</Label>
          <Input
            id="connection-password"
            type="password"
            value={form.password ?? ''}
            placeholder={connection ? '留空则保持原密码' : ''}
            onChange={(event) => update('password', event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="connection-group">分组</Label>
          <Input
            id="connection-group"
            value={form.group ?? ''}
            onChange={(event) => update('group', event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="connection-color">颜色标签</Label>
          <Input
            id="connection-color"
            value={form.colorTag ?? ''}
            placeholder="prod / dev"
            onChange={(event) => update('colorTag', event.target.value)}
          />
        </div>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      <div className="flex justify-between gap-2 pt-1">
        <Button type="button" variant="outline" onClick={test} disabled={loading}>
          <PlugZap />
          测试
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" disabled={loading}>
            <Database />
            保存
          </Button>
        </div>
      </div>
    </form>
  )
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
    defaultUrl: () => '',
  },
  mysql: {
    defaultName: 'Local MySQL',
    defaultPort: 3306,
    defaultDatabase: 'mysql',
    defaultUsername: 'root',
    defaultUrl: () => '',
  },
  oracle: {
    defaultName: 'Oracle',
    defaultPort: 1521,
    defaultDatabase: 'ORCLPDB1',
    defaultUsername: 'system',
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
    usesUrl: true,
    urlPlaceholder: '/path/to/database.sqlite',
    defaultUrl: (input) => input.connectionUrl || '',
  },
  mssql: {
    defaultName: 'SQL Server',
    defaultPort: 1433,
    defaultDatabase: 'master',
    defaultUsername: 'sa',
    defaultUrl: () => '',
  },
  mongo: {
    defaultName: 'MongoDB',
    defaultPort: 27017,
    defaultDatabase: 'admin',
    defaultUsername: '',
    defaultUrl: () => '',
  },
  redis: {
    defaultName: 'Redis',
    defaultPort: 6379,
    defaultDatabase: '',
    defaultUsername: '',
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
