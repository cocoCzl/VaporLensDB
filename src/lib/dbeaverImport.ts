import i18n from '@/i18n'
import { normalizeAppError } from '@/ipc/client'
import type { ConnectionInput, DriverType } from '@/types/connection'
import type { DriverBackend } from '@/types/driver'
import { extractUrlCredentials } from '@/lib/connectionUrlCredentials'

export interface DbeaverImportPreview {
  sourceName: string
  connections: DbeaverConnectionPreview[]
  driverTemplates: DbeaverDriverTemplatePreview[]
  skipped: DbeaverSkippedEntry[]
  passwordEntries: number
}

export type DbeaverImportItemStatus = 'pending' | 'importing' | 'succeeded' | 'failed'

export interface DbeaverImportItemState {
  status: DbeaverImportItemStatus
  errorMessage?: string
}

export type DbeaverImportSessionState = Record<string, DbeaverImportItemState>

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
  /** DBeaver folders are flattened into one VaporLensDB Data Source Group. */
  groupPath?: string | null
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
  reason: 'unsupportedDriver'
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
  groupPath?: string | null
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
  backend: DriverBackend
}> = [
  { match: /postgres|postgresql|pg/i, driverType: 'postgres', driverDefinitionId: 'postgres', backend: 'nativeRust', defaultPort: 5432 },
  { match: /mysql|maria/i, driverType: 'mysql', driverDefinitionId: 'mysql', backend: 'nativeRust', defaultPort: 3306 },
  { match: /oracle/i, driverType: 'oracle', driverDefinitionId: 'oracle', backend: 'jdbc', defaultPort: 1521 },
  { match: /sqlite/i, driverType: 'sqlite', driverDefinitionId: 'sqlite', backend: 'nativeRust' },
  { match: /sqlserver|mssql|microsoft/i, driverType: 'mssql', driverDefinitionId: 'mssql', backend: 'nativeRust', defaultPort: 1433 },
]

export async function previewDbeaverConfiguration(files: File[]) {
  const configFile = files.find((file) => isDbeaverConfigFile(file.name))
  if (!configFile) {
    const unsupported = files.some((file) => detectDbeaverFormat(file.name) === 'unsupported')
    throw new Error(i18n.t(unsupported ? 'dbeaver.unsupportedFormat' : 'dbeaver.chooseConfigFile'))
  }

  const source = await configFile.text()
  let rawConnections: RawDbeaverConnection[]
  switch (detectDbeaverFormat(configFile.name)) {
    case 'json': rawConnections = parseDbeaverJson(source); break
    case 'xml': rawConnections = parseDbeaverXml(source); break
    default: throw new Error(i18n.t('dbeaver.unsupportedFormat'))
  }
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
    group: preview.groupPath ?? null,
  }
}

export function createDbeaverImportSession(preview: DbeaverImportPreview): DbeaverImportSessionState {
  return Object.fromEntries(
    preview.connections.map((connection) => [connection.id, { status: 'pending' }]),
  )
}

export function getDbeaverImportableConnections(
  preview: DbeaverImportPreview,
  session: DbeaverImportSessionState,
) {
  return preview.connections.filter((connection) => {
    const status = session[connection.id]?.status ?? 'pending'
    return status === 'pending' || status === 'failed'
  })
}

export function summarizeDbeaverImportSession(
  preview: DbeaverImportPreview,
  session: DbeaverImportSessionState,
) {
  return preview.connections.reduce(
    (summary, connection) => {
      const status = session[connection.id]?.status ?? 'pending'
      if (status === 'succeeded') summary.imported += 1
      if (status === 'failed') summary.failed += 1
      if (status === 'pending') summary.pending += 1
      if (status === 'importing') summary.importing += 1
      return summary
    },
    { imported: 0, failed: 0, pending: 0, importing: 0 },
  )
}

export function dbeaverImportErrorMessage(error: unknown) {
  const appError = normalizeAppError(error)
  const message = redactDbeaverImportSecrets(appError.message)
  const detail = appError.detail ? redactDbeaverImportSecrets(appError.detail) : ''
  return detail && detail !== message ? `${message}\n${detail}` : message
}

function redactDbeaverImportSecrets(value: string) {
  return value
    .replace(/(\b(?:password|passwd|pwd|passphrase|token|secret|access_token)\s*[=:]\s*)([^\s,;&]+)/gi, '$1[redacted]')
    .replace(/(\b[^\s/:@]+:)[^\s/@]+@/g, '$1[redacted]@')
}

function parseDbeaverJson(source: string): RawDbeaverConnection[] {
  let parsed: {
    connections?: Record<string, unknown>
    folders?: Record<string, unknown>
  }
  try {
    parsed = JSON.parse(source)
  } catch {
    // SyntaxError messages can contain source fragments, including credentials.
    throw new Error(i18n.t('dbeaver.jsonParseFailed'))
  }
  const connections = parsed.connections ?? {}
  const folderPaths = dbeaverFolderPaths(parsed.folders ?? {})
  return Object.entries(connections).map(([id, value]) => {
    const item = value as Record<string, unknown>
    const configuration = (item.configuration as Record<string, unknown> | undefined) ?? {}
    const folderId = stringValue(item.folder) ?? stringValue(item.folderId) ?? stringValue(configuration.folder)
    const driver = stringValue(item.driver) ?? stringValue(item.provider) ?? ''
    const credentials = extractUrlCredentials(stringValue(configuration.url) ?? '')
    const url = credentials.connectionUrl || null
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
        credentials.username ??
        null,
      hasPasswordReference:
        Boolean(configuration.password) ||
        Boolean(configuration.auth) ||
        Boolean(configuration.credentials) || credentials.password !== undefined,
      groupPath: folderId ? folderPaths.get(folderId) ?? null : null,
    }
  })
}

function parseDbeaverXml(source: string): RawDbeaverConnection[] {
  const document = new DOMParser().parseFromString(source, 'application/xml')
  const parseError = document.querySelector('parsererror')
  if (parseError) {
    throw new Error(i18n.t('dbeaver.xmlParseFailed'))
  }

  const sources = document.querySelectorAll('data-source, datasource')
  return Array.from(sources.length ? sources : document.querySelectorAll('connection')).map((node, index) => {
    const configuration = node.querySelector('connection') ?? node
    const id = attr(node, 'id') ?? attr(node, 'uuid') ?? `xml-${index + 1}`
    const driver = attr(node, 'driver') ?? attr(node, 'provider') ?? attr(node, 'driver-id') ?? ''
    const credentials = extractUrlCredentials(attr(configuration, 'url') ?? attr(node, 'url') ?? textChild(node, 'url') ?? '')
    const url = credentials.connectionUrl || null
    const parsedUrl = url ? parseJdbcUrl(url, driver) : {}
    return {
      id,
      name: attr(node, 'name') ?? textChild(node, 'name') ?? id,
      sourceDriver: driver,
      url,
      host: attr(configuration, 'host') ?? attr(node, 'host') ?? textChild(node, 'host') ?? parsedUrl.host ?? null,
      port: numberValue(attr(configuration, 'port') ?? attr(node, 'port') ?? textChild(node, 'port')) ?? parsedUrl.port ?? null,
      database:
        attr(configuration, 'database') ?? attr(configuration, 'databaseName') ?? attr(node, 'database') ??
        attr(node, 'databaseName') ??
        textChild(node, 'database') ??
        parsedUrl.database ??
        null,
      username:
        attr(configuration, 'user') ?? attr(configuration, 'username') ?? attr(node, 'user') ??
        attr(node, 'username') ??
        textChild(node, 'user') ??
        textChild(node, 'username') ??
        credentials.username ??
        null,
      hasPasswordReference:
        Boolean(attr(node, 'password')) ||
        Boolean(textChild(node, 'password')) ||
        Boolean(node.querySelector('credentials')) || Boolean(attr(configuration, 'password')) || credentials.password !== undefined,
      groupPath: attr(node, 'folder') ?? attr(node, 'folder-id') ?? null,
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
        reason: 'unsupportedDriver',
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
      connectionUrl: mapping.backend === 'jdbc' ? raw.url ?? null
        : mapping.driverType === 'sqlite' ? raw.url?.replace(/^jdbc:sqlite:/i, '') ?? null : null,
      passwordStatus: raw.hasPasswordReference ? 'manualEntryRequired' : 'notPresent',
      sourceDriver: raw.sourceDriver || 'unknown',
      groupPath: raw.groupPath ?? null,
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

function dbeaverFolderPaths(folders: Record<string, unknown>) {
  const entries = new Map<string, { name: string; parentId: string | null }>()
  for (const [id, value] of Object.entries(folders)) {
    const folder = value as Record<string, unknown>
    const name = stringValue(folder.name) ?? stringValue(folder.label) ?? id
    entries.set(id, {
      name,
      parentId: stringValue(folder.parent) ?? stringValue(folder.parentId) ?? null,
    })
  }
  const paths = new Map<string, string>()
  for (const id of entries.keys()) {
    const names: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = id
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const folder = entries.get(cursor)
      if (!folder) break
      names.unshift(folder.name)
      cursor = folder.parentId
    }
    if (names.length) paths.set(id, names.join(' / '))
  }
  return paths
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
  const [hostPort, ...properties] = value.split(';')
  const params = properties.join(';')
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

export function detectDbeaverFormat(filename: string): 'json' | 'xml' | 'unsupported' {
  const normalizedName = filename.toLowerCase()
  if (normalizedName.endsWith('.json')) return 'json'
  if (normalizedName.endsWith('.xml')) return 'xml'
  return 'unsupported'
}

function isDbeaverConfigFile(name: string) {
  return /data-sources\.(json|xml)$/i.test(name) || /dbeaver.*\.(json|xml)$/i.test(name)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function attr(node: Element, name: string) {
  return node.getAttribute(name) || null
}

function textChild(node: Element, selector: string) {
  return node.querySelector(selector)?.textContent?.trim() || null
}
