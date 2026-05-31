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
}

export function registerSqlCompletionProvider(
  monaco: MonacoApi,
  { getConnectionId }: RegisterSqlCompletionOptions,
) {
  return monaco.languages.registerCompletionItemProvider('pgsql', {
    triggerCharacters: ['.', '"', ' '],
    provideCompletionItems: async (model, position) => {
      const connectionId = getConnectionId()
      const range = completionRange(monaco, model, position)
      const context = completionContext(model, position)
      const suggestions: CompletionItem[] = [
        ...keywordSuggestions(monaco, range),
        ...(await metadataSuggestions(monaco, range, connectionId, context)),
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
): Promise<CompletionItem[]> {
  if (!connectionId) {
    return Promise.resolve([])
  }

  const state = useMetadataStore.getState()

  if (context.memberOwner) {
    return findColumnsForOwner(connectionId, context.memberOwner).then((columns) =>
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
    range,
  }))

  const tableSuggestions = knownTables(connectionId).map((item) => ({
    label: item.table.name,
    kind: tableKind(monaco, item.table),
    insertText: quoteIfNeeded(item.table.name),
    detail: item.schema ? `${item.schema}.${item.table.name}` : item.table.name,
    range,
  }))

  const functionSuggestions = Object.entries(state.functions)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([, functions]) => functions)
    .map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: `${quoteIfNeeded(name)}()`,
      detail: 'function',
      range,
    }))

  return Promise.resolve([
    ...schemaSuggestions,
    ...tableSuggestions,
    ...uniqueBy(functionSuggestions, (item) => String(item.label)),
  ])
}

async function findColumnsForOwner(connectionId: string, owner: string) {
  const normalizedOwner = unquoteIdentifier(owner).toLowerCase()
  const tables = knownTables(connectionId).filter(
    ({ schema, table }) =>
      table.name.toLowerCase() === normalizedOwner ||
      `${schema}.${table.name}`.toLowerCase() === normalizedOwner,
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

function knownTables(connectionId: string) {
  const state = useMetadataStore.getState()
  const tableEntries = Object.entries(state.tables)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, tables]) => tables.map((table) => ({ schema: schemaFromKey(key), table })))
  const viewEntries = Object.entries(state.views)
    .filter(([key]) => key.startsWith(`${connectionId}::`))
    .flatMap(([key, views]) => views.map((table) => ({ schema: schemaFromKey(key), table })))

  return uniqueBy([...tableEntries, ...viewEntries], ({ schema, table }) => `${schema}.${table.name}`)
}

function tableKind(monaco: MonacoApi, table: TableInfo) {
  return table.tableType === 'view'
    ? monaco.languages.CompletionItemKind.Interface
    : monaco.languages.CompletionItemKind.Class
}

interface CompletionContext {
  memberOwner?: string
}

function completionContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): CompletionContext {
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
  const memberMatch = linePrefix.match(/((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?)\.\s*$/)
  return { memberOwner: memberMatch?.[1] }
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

function quoteIfNeeded(identifier: string) {
  return /^[A-Za-z_][\w$]*$/.test(identifier) ? identifier : `"${identifier.replaceAll('"', '""')}"`
}

function unquoteIdentifier(identifier: string) {
  return identifier.replaceAll('"', '')
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
