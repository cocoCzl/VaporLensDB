import type * as Monaco from 'monaco-editor'
import { tableObjectKey, useMetadataStore } from '@/stores/metadataStore'
import type { TableInfo } from '@/types/metadata'

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'WITH',
  'EXPLAIN',
  'RETURNING',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
]

type MonacoApi = typeof Monaco
type CompletionProvider = Monaco.languages.CompletionItemProvider
type CompletionItem = Monaco.languages.CompletionItem

interface RegisterSqlCompletionOptions {
  getConnectionId: () => string | null | undefined
  getSchema?: () => string | null | undefined
}

export function registerSqlCompletionProvider(
  monaco: MonacoApi,
  { getConnectionId, getSchema }: RegisterSqlCompletionOptions,
) {
  return monaco.languages.registerCompletionItemProvider('pgsql', {
    triggerCharacters: ['.', '"', ' '],
    provideCompletionItems: async (model, position) => {
      const connectionId = getConnectionId()
      const preferredSchema = getSchema?.() ?? null
      const range = completionRange(monaco, model, position)
      const context = completionContext(model, position)
      const suggestions: CompletionItem[] = [
        ...keywordSuggestions(monaco, range),
        ...(await metadataSuggestions(monaco, range, connectionId, context, preferredSchema)),
      ]

      return { suggestions }
    },
  } satisfies CompletionProvider)
}

function keywordSuggestions(monaco: MonacoApi, range: Monaco.IRange): CompletionItem[] {
  return SQL_KEYWORDS.map((keyword) => ({
    label: keyword,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: keyword,
    range,
  }))
}

function metadataSuggestions(
  monaco: MonacoApi,
  range: Monaco.IRange,
  connectionId: string | null | undefined,
  context: CompletionContext,
  preferredSchema: string | null,
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

    return findColumnsForOwner(
      connectionId,
      context.memberOwner,
      context.aliases,
      preferredSchema,
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

  const schemaSuggestions = uniqueBy(schemas, (schema) => schema.name).map((schema) => ({
    label: schema.name,
    kind: monaco.languages.CompletionItemKind.Module,
    insertText: quoteIfNeeded(schema.name),
    detail: 'schema',
    sortText:
      schema.name === preferredSchema ? `0_schema_${schema.name}` : `3_schema_${schema.name}`,
    range,
  }))

  const tableSuggestions = knownTables(connectionId, preferredSchema).map((item) => ({
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
) {
  const normalizedOwner = unquoteIdentifier(owner).toLowerCase()
  const alias = aliases.find((item) => item.alias.toLowerCase() === normalizedOwner)
  const normalizedResolvedOwner = unquoteIdentifier(alias?.target ?? owner).toLowerCase()
  const tables = knownTables(connectionId, preferredSchema).filter(
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

function knownTables(connectionId: string, preferredSchema: string | null = null) {
  const state = useMetadataStore.getState()
  const tableEntries = Object.entries(state.tables)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, tables]) => tables.map((table) => ({ schema: schemaFromKey(key), table })))
  const viewEntries = Object.entries(state.views)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, views]) => views.map((table) => ({ schema: schemaFromKey(key), table })))
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
