import type * as Monaco from 'monaco-editor'
import { beforeEach, expect, it, vi } from 'vitest'
import { registerSqlCompletionProvider } from './AutoComplete'

const metadata = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/stores/metadataStore', () => ({
  useMetadataStore: { getState: () => metadata.state },
  tableObjectKey: (connection: string, schema: string, table: string) => `${connection}:${schema}:${table}`,
}))

let provider: Monaco.languages.CompletionItemProvider
const monaco = {
  Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  languages: {
    CompletionItemKind: { Keyword: 1, Field: 2, Module: 3, Class: 4, Interface: 5, Function: 6 },
    registerCompletionItemProvider: (_language: string, value: Monaco.languages.CompletionItemProvider) => { provider = value; return { dispose() {} } },
  },
} as unknown as typeof Monaco

beforeEach(() => {
  metadata.state = {
    schemas: { 'c::database::db::schemas': [{ name: 'alpha' }, { name: 'beta' }] },
    tables: {
      'c::schema::alpha': [{ name: 'customers', tableType: 'table' }],
      'c::schema::beta': [{ name: 'customers', tableType: 'table' }],
    }, views: {}, schemaObjects: {}, functions: {}, catalogSchemaPaths: {},
    columns: { 'c:alpha:customers': [{ name: 'display_name', dataType: 'text' }], 'c:beta:customers': [{ name: 'other_context', dataType: 'text' }] },
    loadColumns: vi.fn().mockResolvedValue([]), loadTables: vi.fn().mockResolvedValue([]),
    loadViews: vi.fn().mockResolvedValue([]), loadFunctions: vi.fn().mockResolvedValue([]),
    loadSchemaObjects: vi.fn().mockResolvedValue([]), loadSchemas: vi.fn().mockResolvedValue([]),
  }
  registerSqlCompletionProvider(monaco, { getConnectionId: () => 'c', getSchema: () => 'alpha', getDriverType: () => 'postgres' })
})

async function suggestions(sql: string) {
  const position = { lineNumber: 1, column: sql.length + 1 } as Monaco.Position
  const word = sql.match(/[\w$]*$/)![0]
  const model = {
    getValueInRange: () => sql, getLineContent: () => sql,
    getWordUntilPosition: () => ({ word, startColumn: position.column - word.length, endColumn: position.column }),
  } as unknown as Monaco.editor.ITextModel
  return (await provider.provideCompletionItems(model, position, {} as Monaco.languages.CompletionContext, {} as Monaco.CancellationToken))!.suggestions
}

it('keeps a schema-qualified alias when completion starts after a partial field name', async () => {
  const items = await suggestions('SELECT * FROM beta.customers c WHERE c.o')
  expect(items.map(item => item.label)).toEqual(['other_context'])
  expect(metadata.state.loadColumns).toHaveBeenCalledExactlyOnceWith('c', 'beta', 'customers')
})

it('restricts partial schema members to that schema and excludes SQL keywords', async () => {
  const items = await suggestions('SELECT * FROM beta.c')
  expect(items.map(item => item.detail)).toEqual(['table - beta.customers'])
})

it('loads a qualified alias directly even before its schema tree was expanded', async () => {
  metadata.state.tables = {}
  const items = await suggestions('SELECT * FROM beta.customers c WHERE c.o')
  expect(items.map(item => item.label)).toEqual(['other_context'])
  expect(metadata.state.loadColumns).toHaveBeenCalledExactlyOnceWith('c', 'beta', 'customers')
})

it('uses the selected schema for an unqualified alias instead of merging same-name tables', async () => {
  const items = await suggestions('SELECT * FROM customers c WHERE c.d')
  expect(items.map(item => item.label)).toEqual(['display_name'])
  expect(metadata.state.loadColumns).toHaveBeenCalledExactlyOnceWith('c', 'alpha', 'customers')
})
