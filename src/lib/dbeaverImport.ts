import i18n from '@/i18n'
import type { ConnectionInput, DriverType } from '@/types/connection'

export interface DbeaverImportPreview {
  sourceName: string
  connections: DbeaverConnectionPreview[]
  driverTemplates: DbeaverDriverTemplatePreview[]
  skipped: DbeaverSkippedEntry[]
  passwordEntries: number
}

export interface DbeaverConnectionPreview {
  id: string
  name: string
  driverType: DriverType
  driverDefinitionId: string
  host?: string | null
  port?: number | null
  database?: string | null
  username?: string | null
  connectionUrl?: string | null
  passwordStatus: 'manualEntryRequired' | 'notPresent'
  sourceDriver: string
}

export interface DbeaverDriverTemplatePreview {
  sourceDriver: string
  mappedDriverDefinitionId?: string | null
  mappedDriverType?: DriverType | null
  status: 'supported' | 'unsupported'
}

export interface DbeaverSkippedEntry {
  name: string
  reason: string
  sourceDriver?: string | null
}

interface RawDbeaverConnection {
  id: string
  name: string
  sourceDriver: string
  url?: string | null
  host?: string | null
  port?: number | null
  database?: string | null
  username?: string | null
  hasPasswordReference: boolean
}

interface ParsedConnectionUrl {
  host?: string | null
  port?: number | null
  database?: string | null
}

const DRIVER_MAPPINGS: Array<{
  match: RegExp
  driverType: DriverType
  driverDefinitionId: string
  defaultPort?: number
}> = [
  { match: /postgres|postgresql|pg/i, driverType: 'postgres', driverDefinitionId: 'postgres', defaultPort: 5432 },
  { match: /mysql|maria/i, driverType: 'mysql', driverDefinitionId: 'mysql', defaultPort: 3306 },
  { match: /oracle/i, driverType: 'oracle', driverDefinitionId: 'oracle', defaultPort: 1521 },
  { match: /sqlite/i, driverType: 'sqlite', driverDefinitionId: 'sqlite' },
  { match: /sqlserver|mssql|microsoft/i, driverType: 'mssql', driverDefinitionId: 'mssql', defaultPort: 1433 },
]

export async function previewDbeaverConfiguration(files: File[]) {
  const configFile = files.find((file) => isDbeaverConfigFile(file.name))
  if (!configFile) {
    throw new Error(i18n.t('dbeaver.chooseConfigFile'))
  }

  const source = await configFile.text()
  const rawConnections = configFile.name.endsWith('.json')
    ? parseDbeaverJson(source)
    : parseDbeaverXml(source)
  const credentialsFile = files.find((file) => /credentials.*\.json$/i.test(file.name))
  const credentialText = credentialsFile ? await credentialsFile.text() : ''
  const credentialConnectionIds = collectCredentialConnectionIds(credentialText)

  return buildPreview(
    configFile.name,
    rawConnections.map((connection) => ({
      ...connection,
      hasPasswordReference:
        connection.hasPasswordReference || credentialConnectionIds.has(connection.id),
    })),
  )
}

export function dbeaverPreviewToConnectionInput(preview: DbeaverConnectionPreview): ConnectionInput {
  return {
    name: preview.name,
    driverDefinitionId: preview.driverDefinitionId,
    driverType: preview.driverType,
    host: preview.host ?? null,
    port: preview.port ?? null,
    database: preview.database ?? null,
    connectionUrl: preview.connectionUrl ?? null,
    username: preview.username ?? null,
    password: null,
    driverPaths: [],
  }
}

function parseDbeaverJson(source: string): RawDbeaverConnection[] {
  const parsed = JSON.parse(source) as {
    connections?: Record<string, unknown>
    folders?: Record<string, unknown>
  }
  const connections = parsed.connections ?? {}
  return Object.entries(connections).map(([id, value]) => {
    const item = value as Record<string, unknown>
    const configuration = (item.configuration as Record<string, unknown> | undefined) ?? {}
    const driver = stringValue(item.driver) ?? stringValue(item.provider) ?? ''
    const url = stringValue(configuration.url)
    const parsedUrl = url ? parseJdbcUrl(url, driver) : {}
    return {
      id,
      name: stringValue(item.name) ?? stringValue(configuration.name) ?? id,
      sourceDriver: driver,
      url,
      host: stringValue(configuration.host) ?? parsedUrl.host ?? null,
      port: numberValue(configuration.port) ?? parsedUrl.port ?? null,
      database:
        stringValue(configuration.database) ??
        stringValue(configuration.databaseName) ??
        parsedUrl.database ??
        null,
      username:
        stringValue(configuration.user) ??
        stringValue(configuration.username) ??
        stringValue(configuration.userName) ??
        null,
      hasPasswordReference:
        Boolean(configuration.password) ||
        Boolean(configuration.auth) ||
        Boolean(configuration.credentials),
    }
  })
}

function parseDbeaverXml(source: string): RawDbeaverConnection[] {
  const document = new DOMParser().parseFromString(source, 'application/xml')
  const parseError = document.querySelector('parsererror')
  if (parseError) {
    throw new Error(i18n.t('dbeaver.xmlParseFailed'))
  }

  return Array.from(document.querySelectorAll('data-source, datasource, connection')).map((node, index) => {
    const id = attr(node, 'id') ?? attr(node, 'uuid') ?? `xml-${index + 1}`
    const driver = attr(node, 'driver') ?? attr(node, 'provider') ?? attr(node, 'driver-id') ?? ''
    const url = attr(node, 'url') ?? textChild(node, 'url')
    const parsedUrl = url ? parseJdbcUrl(url, driver) : {}
    return {
      id,
      name: attr(node, 'name') ?? textChild(node, 'name') ?? id,
      sourceDriver: driver,
      url,
      host: attr(node, 'host') ?? textChild(node, 'host') ?? parsedUrl.host ?? null,
      port: numberValue(attr(node, 'port') ?? textChild(node, 'port')) ?? parsedUrl.port ?? null,
      database:
        attr(node, 'database') ??
        attr(node, 'databaseName') ??
        textChild(node, 'database') ??
        parsedUrl.database ??
        null,
      username:
        attr(node, 'user') ??
        attr(node, 'username') ??
        textChild(node, 'user') ??
        textChild(node, 'username') ??
        null,
      hasPasswordReference:
        Boolean(attr(node, 'password')) ||
        Boolean(textChild(node, 'password')) ||
        Boolean(node.querySelector('credentials')),
    }
  })
}

function buildPreview(sourceName: string, rawConnections: RawDbeaverConnection[]): DbeaverImportPreview {
  const connections: DbeaverConnectionPreview[] = []
  const skipped: DbeaverSkippedEntry[] = []
  const templateMap = new Map<string, DbeaverDriverTemplatePreview>()
  let passwordEntries = 0

  for (const raw of rawConnections) {
    const mapping = mapDriver(raw.sourceDriver || raw.url || raw.name)
    if (!templateMap.has(raw.sourceDriver || 'unknown')) {
      templateMap.set(raw.sourceDriver || 'unknown', {
        sourceDriver: raw.sourceDriver || 'unknown',
        mappedDriverDefinitionId: mapping?.driverDefinitionId ?? null,
        mappedDriverType: mapping?.driverType ?? null,
        status: mapping ? 'supported' : 'unsupported',
      })
    }

    if (!mapping) {
      skipped.push({
        name: raw.name,
        sourceDriver: raw.sourceDriver,
        reason: 'unsupported driver',
      })
      continue
    }

    if (raw.hasPasswordReference) {
      passwordEntries += 1
    }

    connections.push({
      id: raw.id,
      name: raw.name,
      driverType: mapping.driverType,
      driverDefinitionId: mapping.driverDefinitionId,
      host: raw.host ?? null,
      port: raw.port ?? mapping.defaultPort ?? null,
      database: raw.database ?? null,
      username: raw.username ?? null,
      connectionUrl: raw.url ?? null,
      passwordStatus: raw.hasPasswordReference ? 'manualEntryRequired' : 'notPresent',
      sourceDriver: raw.sourceDriver || 'unknown',
    })
  }

  return {
    sourceName,
    connections,
    driverTemplates: Array.from(templateMap.values()),
    skipped,
    passwordEntries,
  }
}

function mapDriver(value: string) {
  return DRIVER_MAPPINGS.find((mapping) => mapping.match.test(value))
}

function parseJdbcUrl(url: string, sourceDriver: string): ParsedConnectionUrl {
  if (/postgres/i.test(sourceDriver) || url.startsWith('jdbc:postgresql://')) {
    return parseHostDatabaseUrl(url.replace(/^jdbc:postgresql:\/\//, ''), 5432)
  }
  if (/mysql|maria/i.test(sourceDriver) || url.startsWith('jdbc:mysql://')) {
    return parseHostDatabaseUrl(url.replace(/^jdbc:mysql:\/\//, ''), 3306)
  }
  if (/sqlserver|mssql/i.test(sourceDriver) || url.startsWith('jdbc:sqlserver://')) {
    return parseSqlServerUrl(url.replace(/^jdbc:sqlserver:\/\//, ''))
  }
  if (/oracle/i.test(sourceDriver) || url.startsWith('jdbc:oracle:')) {
    const host = url.match(/HOST\s*=\s*([^)]+)/i)?.[1] ?? null
    const port = numberValue(url.match(/PORT\s*=\s*([^)]+)/i)?.[1]) ?? 1521
    const database = url.match(/SERVICE_NAME\s*=\s*([^)]+)/i)?.[1] ?? null
    return { host, port, database }
  }
  return {}
}

function parseHostDatabaseUrl(value: string, defaultPort: number) {
  const [hostPort, databasePart = ''] = value.split('/', 2)
  const [host, portText] = hostPort.split(':', 2)
  return {
    host: host || null,
    port: numberValue(portText) ?? defaultPort,
    database: databasePart.split('?')[0] || null,
  }
}

function parseSqlServerUrl(value: string) {
  const [hostPort, params = ''] = value.split(';', 2)
  const [host, portText] = hostPort.split(':', 2)
  const database = params.match(/database(?:Name)?=([^;]+)/i)?.[1] ?? null
  return {
    host: host || null,
    port: numberValue(portText) ?? 1433,
    database,
  }
}

function collectCredentialConnectionIds(source: string) {
  const ids = new Set<string>()
  if (!source.trim()) return ids
  try {
    const parsed = JSON.parse(source)
    collectKeys(parsed, ids)
  } catch {
    // Credentials may be encrypted or in a DBeaver-specific format; import keeps passwords manual.
  }
  return ids
}

function collectKeys(value: unknown, ids: Set<string>) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/^[0-9a-f-]{8,}$/i.test(key)) ids.add(key)
    collectKeys(child, ids)
  }
}

function isDbeaverConfigFile(name: string) {
  return /data-sources\.(json|xml)$/i.test(name) || /dbeaver.*\.(json|xml)$/i.test(name)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function attr(node: Element, name: string) {
  return node.getAttribute(name) || null
}

function textChild(node: Element, selector: string) {
  return node.querySelector(selector)?.textContent?.trim() || null
}
