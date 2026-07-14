import type * as Monaco from 'monaco-editor'
import { tableObjectKey, useMetadataStore } from '@/stores/metadataStore'
import { isSystemSchema } from '@/lib/systemObjects'
import type { DriverType } from '@/types/connection'
import type { TableInfo } from '@/types/metadata'

const SQL_KEYWORDS = [
  'SELECT',
  'DISTINCT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'ON',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'CREATE VIEW',
  'DROP VIEW',
  'WITH',
  'EXPLAIN',
  'RETURNING',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
  'AS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
]

type MonacoApi = typeof Monaco
type CompletionProvider = Monaco.languages.CompletionItemProvider
type CompletionItem = Monaco.languages.CompletionItem

interface RegisterSqlCompletionOptions {
  getConnectionId: () => string | null | undefined
  getSchema?: () => string | null | undefined
  getDriverType?: () => DriverType | null | undefined
  getShowSystemObjects?: () => boolean
}

export function registerSqlCompletionProvider(
  monaco: MonacoApi,
  { getConnectionId, getSchema, getDriverType, getShowSystemObjects }: RegisterSqlCompletionOptions,
) {
  return monaco.languages.registerCompletionItemProvider('pgsql', {
    triggerCharacters: ['.', '"', ' '],
    provideCompletionItems: async (model, position) => {
      const connectionId = getConnectionId()
      const preferredSchema = getSchema?.() ?? null
      const driverType = getDriverType?.() ?? 'postgres'
      const showSystemObjects = getShowSystemObjects?.() ?? false
      const range = completionRange(monaco, model, position)
      const context = completionContext(model, position)
      const suggestions: CompletionItem[] = [
        ...keywordSuggestions(monaco, range, driverType),
        ...(await metadataSuggestions(
          monaco,
          range,
          connectionId,
          context,
          preferredSchema,
          driverType,
          showSystemObjects,
        )),
      ]

      return { suggestions }
    },
  } satisfies CompletionProvider)
}

function keywordSuggestions(
  monaco: MonacoApi,
  range: Monaco.IRange,
  driverType: DriverType,
): CompletionItem[] {
  return SQL_KEYWORDS.map((keyword) => {
    const formattedKeyword = formatKeywordForDriver(keyword, driverType)
    return {
      label: formattedKeyword,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: formattedKeyword,
      range,
    }
  })
}

function formatKeywordForDriver(keyword: string, driverType: DriverType) {
  return driverType === 'postgres' || driverType === 'mysql'
    ? keyword.toLocaleLowerCase('en-US')
    : keyword
}

async function metadataSuggestions(
  monaco: MonacoApi,
  range: Monaco.IRange,
  connectionId: string | null | undefined,
  context: CompletionContext,
  preferredSchema: string | null,
  driverType: DriverType,
  showSystemObjects: boolean,
): Promise<CompletionItem[]> {
  if (!connectionId) {
    return Promise.resolve([])
  }

  const state = useMetadataStore.getState()

  if (context.memberOwner) {
    const cte = context.ctes.find(
      (item) =>
        item.name.toLowerCase() === unquoteIdentifier(context.memberOwner ?? '').toLowerCase(),
    )
    if (cte?.columns.length) {
      return Promise.resolve(
        cte.columns.map((column) => ({
          label: column,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: quoteIfNeeded(column),
          detail: cte.name,
          range,
        })),
      )
    }

    const alias = findAlias(context.memberOwner, context.aliases)
    if (alias) {
      return findColumnsForOwner(
        connectionId,
        context.memberOwner,
        context.aliases,
        preferredSchema,
        driverType,
        showSystemObjects,
      ).then((columns) =>
        columns.map((column) => ({
          label: column.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: quoteIfNeeded(column.name),
          detail: column.dataType,
          documentation: column.isPrimaryKey ? 'Primary key' : undefined,
          range,
        })),
      )
    }

    const schema = await schemaForOwner(
      connectionId,
      context.memberOwner,
      driverType,
      showSystemObjects,
    )
    if (schema) {
      return schemaObjectSuggestions(
        monaco,
        range,
        connectionId,
        schema,
        driverType,
        showSystemObjects,
      )
    }

    return findColumnsForOwner(
      connectionId,
      context.memberOwner,
      context.aliases,
      preferredSchema,
      driverType,
      showSystemObjects,
    ).then((columns) =>
      columns.map((column) => ({
        label: column.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: quoteIfNeeded(column.name),
        detail: column.dataType,
        documentation: column.isPrimaryKey ? 'Primary key' : undefined,
        range,
      })),
    )
  }

  const schemas = Object.entries(state.schemas)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([, values]) => values)
    .filter((schema) => showSystemObjects || !isSystemSchema(driverType, schema.name))

  const schemaSuggestions = uniqueBy(schemas, (schema) => schema.name).map((schema) => ({
    label: schema.name,
    kind: monaco.languages.CompletionItemKind.Module,
    insertText: quoteIfNeeded(schema.name),
    detail: 'schema',
    sortText:
      schema.name === preferredSchema ? `0_schema_${schema.name}` : `3_schema_${schema.name}`,
    range,
  }))

  const tableSuggestions = knownTables(
    connectionId,
    preferredSchema,
    driverType,
    showSystemObjects,
  ).map((item) => ({
    label: item.table.name,
    kind: tableKind(monaco, item.table),
    insertText: quoteIfNeeded(item.table.name),
    detail: `${tableTypeLabel(item.table)} - ${item.schema ? `${item.schema}.` : ''}${item.table.name}`,
    sortText:
      item.schema === preferredSchema ? `0_table_${item.table.name}` : `2_table_${item.table.name}`,
    range,
  }))

  const cteSuggestions = context.ctes.map((cte) => ({
    label: cte.name,
    kind: monaco.languages.CompletionItemKind.Class,
    insertText: quoteIfNeeded(cte.name),
    detail: 'CTE',
    range,
  }))

  const functionSuggestions = Object.entries(state.functions)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, functions]) => functions.map((name) => ({ name, schema: schemaFromKey(key) })))
    .filter(({ schema }) => showSystemObjects || !isSystemSchema(driverType, schema))
    .map(({ name, schema }) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: `${quoteIfNeeded(name)}()`,
      detail: `function - ${schema}`,
      sortText: schema === preferredSchema ? `0_function_${name}` : `2_function_${name}`,
      range,
    }))

  return Promise.resolve([
    ...schemaSuggestions,
    ...cteSuggestions,
    ...tableSuggestions,
    ...uniqueBy(functionSuggestions, (item) => String(item.label)),
  ])
}

async function findColumnsForOwner(
  connectionId: string,
  owner: string,
  aliases: SqlAlias[] = [],
  preferredSchema: string | null = null,
  driverType: DriverType,
  showSystemObjects: boolean,
) {
  const alias = findAlias(owner, aliases)
  const normalizedResolvedOwner = unquoteIdentifier(alias?.target ?? owner).toLowerCase()
  const tables = knownTables(connectionId, preferredSchema, driverType, showSystemObjects).filter(
    ({ schema, table }) =>
      table.name.toLowerCase() === normalizedResolvedOwner ||
      `${schema}.${table.name}`.toLowerCase() === normalizedResolvedOwner,
  )

  const state = useMetadataStore.getState()
  await Promise.all(
    tables.map(({ schema, table }) =>
      state.loadColumns(connectionId, schema, table.name).catch(() => []),
    ),
  )
  const nextState = useMetadataStore.getState()

  return uniqueBy(
    tables.flatMap(
      ({ schema, table }) => nextState.columns[tableObjectKey(connectionId, schema, table.name)] ?? [],
    ),
    (column) => column.name,
  )
}

function findAlias(owner: string, aliases: SqlAlias[]) {
  const normalizedOwner = unquoteIdentifier(owner).toLowerCase()
  return aliases.find((item) => item.alias.toLowerCase() === normalizedOwner)
}

async function schemaObjectSuggestions(
  monaco: MonacoApi,
  range: Monaco.IRange,
  connectionId: string,
  schema: string,
  driverType: DriverType,
  showSystemObjects: boolean,
): Promise<CompletionItem[]> {
  if (!showSystemObjects && isSystemSchema(driverType, schema)) {
    return []
  }

  const state = useMetadataStore.getState()
  await Promise.all([
    state.loadTables(connectionId, schema).catch(() => []),
    state.loadViews(connectionId, schema).catch(() => []),
    state.loadFunctions(connectionId, schema).catch(() => []),
    state.loadSchemaObjects(connectionId, schema, 'materializedView').catch(() => []),
  ])
  const nextState = useMetadataStore.getState()
  const tables = knownTables(connectionId, schema, driverType, showSystemObjects).filter(
    (item) => item.schema.toLowerCase() === schema.toLowerCase(),
  )
  const functions =
    nextState.functions[`${connectionId}::schema::${schema}`]?.map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: `${quoteIfNeeded(name)}()`,
      detail: `function - ${schema}`,
      sortText: `1_function_${name}`,
      range,
    })) ?? []

  return [
    ...tables.map((item) => ({
      label: item.table.name,
      kind: tableKind(monaco, item.table),
      insertText: quoteIfNeeded(item.table.name),
      detail: `${tableTypeLabel(item.table)} - ${schema}.${item.table.name}`,
      sortText: `0_${tableTypeLabel(item.table)}_${item.table.name}`,
      range,
    })),
    ...uniqueBy(functions, (item) => String(item.label)),
  ]
}

async function schemaForOwner(
  connectionId: string,
  owner: string,
  driverType: DriverType,
  showSystemObjects: boolean,
) {
  const normalized = unquoteIdentifier(owner).toLowerCase()
  const state = useMetadataStore.getState()
  const loadedSchemas = Object.entries(state.schemas)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([, values]) => values)
    .filter((schema) => showSystemObjects || !isSystemSchema(driverType, schema.name))
  const loadedMatch = loadedSchemas.find((schema) => schema.name.toLowerCase() === normalized)
  if (loadedMatch) return loadedMatch.name

  const path = state.catalogSchemaPaths[connectionId]
  const schemas = await state.loadSchemas(connectionId, path?.database ?? null).catch(() => [])
  return schemas
    .filter((schema) => showSystemObjects || !isSystemSchema(driverType, schema.name))
    .find((schema) => schema.name.toLowerCase() === normalized)?.name ?? null
}

function knownTables(
  connectionId: string,
  preferredSchema: string | null = null,
  driverType: DriverType,
  showSystemObjects: boolean,
) {
  const state = useMetadataStore.getState()
  const tableEntries = Object.entries(state.tables)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, tables]) => tables.map((table) => ({ schema: schemaFromKey(key), table })))
    .filter(({ schema }) => showSystemObjects || !isSystemSchema(driverType, schema))
  const viewEntries = Object.entries(state.views)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, views]) => views.map((table) => ({ schema: schemaFromKey(key), table })))
    .filter(({ schema }) => showSystemObjects || !isSystemSchema(driverType, schema))
  const materializedViewEntries = Object.entries(state.schemaObjects)
    .filter(([key]) => key.startsWith(`${connectionId}::`) && key.endsWith('::materializedView'))
    .flatMap(([key, objects]) =>
      objects.map((object) => ({
        schema: schemaFromObjectKindKey(key),
        table: {
          schema: object.schema,
          name: object.name,
          tableType: 'materializedView' as const,
          rowCount: null,
        },
      })),
    )
    .filter(({ schema }) => showSystemObjects || !isSystemSchema(driverType, schema))

  return uniqueBy(
    [...tableEntries, ...viewEntries, ...materializedViewEntries],
    ({ schema, table }) => `${schema}.${table.name}`,
  ).sort((a, b) => Number(b.schema === preferredSchema) - Number(a.schema === preferredSchema))
}

function tableKind(monaco: MonacoApi, table: TableInfo) {
  return table.tableType === 'view'
    ? monaco.languages.CompletionItemKind.Interface
    : monaco.languages.CompletionItemKind.Class
}

function tableTypeLabel(table: TableInfo) {
  if (table.tableType === 'view') return 'view'
  if (table.tableType === 'materializedView') return 'materialized view'
  return 'table'
}

interface CompletionContext {
  memberOwner?: string
  aliases: SqlAlias[]
  ctes: SqlCte[]
}

interface SqlAlias {
  alias: string
  target: string
}

interface SqlCte {
  name: string
  columns: string[]
}

function completionContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): CompletionContext {
  const prefix = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  })
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
  const memberMatch = linePrefix.match(/((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)\.\s*$/)
  return {
    memberOwner: memberMatch?.[1],
    aliases: extractAliases(prefix),
    ctes: extractCtes(prefix),
  }
}

function completionRange(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
) {
  const word = model.getWordUntilPosition(position)
  return new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
}

function schemaFromKey(key: string) {
  return key.split('::schema::')[1]?.split('::')[0] ?? ''
}

function schemaFromObjectKindKey(key: string) {
  const [, rest = ''] = key.split('::schema::')
  return rest.split('::objects::')[0] ?? ''
}

function quoteIfNeeded(identifier: string) {
  return /^[A-Za-z_][\w$]*$/.test(identifier) ? identifier : `"${identifier.replaceAll('"', '""')}"`
}

function unquoteIdentifier(identifier: string) {
  const trimmed = identifier.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"')
  }
  return trimmed.replaceAll('"', '')
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item).toLowerCase()
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function extractAliases(sql: string): SqlAlias[] {
  const aliases: SqlAlias[] = []
  const withoutComments = stripSqlComments(sql)
  const relationPattern =
    /\b(?:from|join|update|into)\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*)){0,2})(?:\s+(?:as\s+)?(?!(?:where|join|left|right|inner|outer|full|cross|on|using|group|order|having|limit|offset|set|values|returning)\b)("?[^"\s(),.]+"?|[A-Za-z_][\w$]*))?/gi

  for (const match of withoutComments.matchAll(relationPattern)) {
    const target = normalizeDottedIdentifier(match[1])
    const alias = match[2] ? unquoteIdentifier(match[2]) : ''
    const targetName = target.split('.').at(-1) ?? ''
    if (target && alias && alias.toLowerCase() !== targetName.toLowerCase()) {
      aliases.push({ alias, target })
    }
  }

  return uniqueBy(aliases, (item) => item.alias)
}

function extractCtes(sql: string): SqlCte[] {
  const withoutComments = stripSqlComments(sql)
  const withIndex = withoutComments.search(/\bwith\b/i)
  if (withIndex < 0) return []

  const ctes: SqlCte[] = []
  const ctePattern =
    /(?:\bwith\b|,)\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*(?:\(([^)]*)\))?\s+as\s*\(/gi

  for (const match of withoutComments.slice(withIndex).matchAll(ctePattern)) {
    const name = match[1] ?? match[2]
    if (name) {
      ctes.push({ name, columns: parseColumnList(match[3] ?? '') })
    }
  }

  return uniqueBy(ctes, (item) => item.name)
}

function parseColumnList(value: string) {
  return value
    .split(',')
    .map((item) => unquoteIdentifier(item.trim()))
    .filter(Boolean)
}

function normalizeDottedIdentifier(value: string) {
  return value
    .split('.')
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean)
    .join('.')
}

function stripSqlComments(sql: string) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
