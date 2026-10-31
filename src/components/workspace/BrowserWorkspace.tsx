import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Database, Eye, FileCode2, FolderOpen, FunctionSquare, KeyRound, Layers3, ListTree, Loader2, Package, Plug, Search, SquareCode, Table2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { DatabaseVendorIcon } from '@/components/common/DatabaseVendorIcon'
import { connectionEndpoint, connectionStatusLabel } from '@/components/sidebar/connectionPresentation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { connectionProductType, productDisplayName } from '@/lib/productPresentation'
import { connectionSqlDialect } from '@/lib/databaseDialect'
import { isSystemDatabase, isSystemSchema } from '@/lib/systemObjects'
import { normalizeAppError } from '@/ipc/client'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore, type BrowserContext } from '@/stores/editorStore'
import { schemaKey, schemaObjectKey, schemaObjectKindKey, useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import { useDriverStore } from '@/stores/driverStore'
import { openBrowserWorkspace } from './openBrowserWorkspace'
import type { DbObjectKind } from '@/types/metadata'

interface BrowserRow { name: string; kind: 'database' | 'schema' | DbObjectKind; schema?: string | null }
const OBJECT_ICONS = { database: Database, schema: FolderOpen, table: Table2, view: Eye, materializedView: Layers3,
  index: KeyRound, procedure: SquareCode, function: FunctionSquare, package: Package, sequence: ListTree,
  trigger: Zap, synonym: SquareCode, event: CalendarClock }

export function BrowserWorkspace({ connectionId, context }: { connectionId: string | null; context: BrowserContext }) {
  const { t } = useTranslation()
  const connection = useConnectionStore(state => state.connections.find(item => item.id === connectionId))
  const capabilities = useConnectionStore(state => connectionId ? state.capabilities[connectionId] : undefined)
  const status = useConnectionStore(state => connectionId ? state.statuses[connectionId]?.status ?? 'disconnected' : 'disconnected')
  const busy = useConnectionStore(state => Boolean(connectionId && state.busyConnectionIds[connectionId]))
  const epoch = useConnectionStore(state => connectionId ? state.lifecycleEpochs[connectionId] : undefined)
  const showSystemObjects = useUiStore(state => state.showSystemObjects)
  const metadata = useMetadataStore(useShallow(state => ({ databases: state.databases, schemas: state.schemas, tables: state.tables, views: state.views, schemaObjects: state.schemaObjects, catalogSchemaPaths: state.catalogSchemaPaths })))
  const metadataCapability = useDriverStore(state => state.drivers.find(driver => driver.id === connection?.driverDefinitionId)?.capabilities.canReadMetadata)
  const backend = useDriverStore(state => state.drivers.find(driver => driver.id === connection?.driverDefinitionId)?.backend)
  const [query, setQuery] = useState('')
  const [request, setRequest] = useState({ loading: false, error: '' })
  const product = connection ? connectionProductType(connection) : null
  const schema = context.schema ?? (product === 'mysql' ? context.database : null)
  const supported = metadataCapability ?? (product !== 'mongo' && product !== 'redis')
  const currentDatabase = connection?.database || (connectionId ? metadata.catalogSchemaPaths[connectionId]?.database : null)
  const allowedCatalog = product !== 'postgres' || context.kind === 'connection' || context.database === currentDatabase
  const connected = status === 'connected'

  // Selection can read metadata from an existing session, but never opens one.
  // Cached data remains renderable without calling any loader while disconnected.
  useEffect(() => {
    if (!connectionId || !connected || busy || !supported || !allowedCatalog) return
    let current = true
    const state = useMetadataStore.getState()
    const load = schema
      ? context.objectKind && context.objectKind !== 'table' && context.objectKind !== 'view'
        ? state.loadSchemaObjects(connectionId, schema, context.objectKind)
        : Promise.all([
          context.objectKind === 'view' ? Promise.resolve([]) : state.loadTables(connectionId, schema),
          context.objectKind === 'table' ? Promise.resolve([]) : state.loadViews(connectionId, schema),
        ])
      : context.kind === 'database'
        ? state.loadSchemas(connectionId, context.database)
        : state.loadDatabases(connectionId)
    queueMicrotask(() => { if (current) setRequest({ loading: true, error: '' }) })
    void load.then(() => { if (current) setRequest({ loading: false, error: '' }) }, error => {
      if (current) setRequest({ loading: false, error: normalizeAppError(error).message })
    })
    return () => { current = false }
  }, [connectionId, context.kind, context.database, context.objectKind, schema, connected, busy, supported, allowedCatalog, epoch])

  const rows = useMemo<BrowserRow[]>(() => {
    if (!connectionId || !connection) return []
    if (schema) {
      const key = schemaObjectKey(connectionId, schema)
      if (context.objectKind && !['table', 'view'].includes(context.objectKind)) {
        return (metadata.schemaObjects[schemaObjectKindKey(connectionId, schema, context.objectKind)] ?? []).map(object => ({ ...object, schema }))
      }
      const tables: BrowserRow[] = context.objectKind === 'view' ? [] : (metadata.tables[key] ?? [])
        .filter(table => showSystemObjects || table.tableType !== 'systemTable')
        .map(table => ({ name: table.name, kind: table.tableType === 'view' ? 'view' : table.tableType === 'materializedView' ? 'materializedView' : 'table', schema }))
      const views: BrowserRow[] = context.objectKind === 'table' ? [] : (metadata.views[key] ?? [])
        .map(view => ({ name: view.name, kind: view.tableType === 'materializedView' ? 'materializedView' : 'view', schema }))
      return [...new Map([...tables, ...views].map(row => [`${row.kind}:${row.name}`, row])).values()]
    }
    if (context.kind === 'database') return (metadata.schemas[schemaKey(connectionId, context.database)] ?? [])
      .filter(item => showSystemObjects || !isSystemSchema(connection.driverType, item.name))
      .map(item => ({ name: item.name, kind: 'schema' }))
    return (metadata.databases[connectionId] ?? [])
      .filter(item => (showSystemObjects || !isSystemDatabase(connection.driverType, item.name)) && (product !== 'postgres' || item.name === currentDatabase))
      .map(item => ({ name: item.name, kind: 'database' }))
  }, [metadata, connectionId, connection, schema, context.kind, context.database, context.objectKind, showSystemObjects, product, currentDatabase])
  const filteredRows = rows.filter(row => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  if (!connection) return <section className="min-w-0 flex-1 p-5 text-sm text-muted-foreground">{t('browser.connectionUnavailable')}</section>
  const title = context.kind === 'connection' ? connection.name : context.schema ?? context.database ?? connection.name
  const statusText = busy ? t('connection.connecting') : connected ? t('browser.browsing') : connectionStatusLabel(status, t)

  function newQuery() {
    useEditorStore.getState().addTab({ id: crypto.randomUUID(), kind: 'sql', title: `SQL · ${title}`, sql: '', connectionId,
      database: context.database, schema })
  }

  function openRow(row: BrowserRow) {
    if (!connectionId || !connection) return
    useConnectionStore.getState().setActiveConnection(connectionId)
    if (row.kind === 'database' || row.kind === 'schema') {
      openBrowserWorkspace(connectionId, row.name, { kind: row.kind, database: row.kind === 'database' ? row.name : context.database, schema: row.kind === 'schema' ? row.name : null })
    } else if (row.kind === 'table' || row.kind === 'view' || row.kind === 'materializedView') {
      const editor = useEditorStore.getState()
      const existing = editor.tabs.find(tab => tab.kind === 'objectSummary' && tab.connectionId === connectionId && tab.objectSummaryContext?.schema === schema && tab.objectSummaryContext?.object === row.name)
      if (existing) editor.setActiveTab(existing.id)
      else editor.addTab({ id: crypto.randomUUID(), kind: 'objectSummary', title: t('explorer.summaryTabTitle', { name: row.name }), sql: '', connectionId,
        objectSummaryContext: { database: context.database, schema: schema ?? '', object: row.name, objectKind: row.kind, driverType: connectionSqlDialect(connection) } })
    } else {
      useEditorStore.getState().addTab({ id: crypto.randomUUID(), kind: 'definition', title: row.name, sql: '', connectionId,
        definitionContext: { database: context.database, schema: schema ?? '', object: row.name, objectKind: row.kind, definitionKind: 'DDL', operation: 'objectDdl' } })
    }
  }

  return (
    <section className="ide-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={t('browser.workspace')}>
      <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 border-b bg-surface px-4 py-3">
        <DatabaseVendorIcon driverType={connection.productId ?? connection.driverType} className="size-6 shrink-0" />
        <div className="min-w-0 flex-1 basis-40">
          <div className="mb-0.5 truncate text-[11px] text-muted-foreground" title={[connection.name, context.database, context.schema].filter(Boolean).join(' / ')}>
            {context.kind === 'connection' ? productDisplayName(connection) : [connection.name, context.database, context.schema].filter(Boolean).join(' / ')}
          </div>
          <h1 className="truncate text-base font-semibold" title={title}>{title}</h1>
        </div>
        <Button size="sm" variant="outline" onClick={newQuery}><FileCode2 />{t('home.newQuery')}</Button>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" role="status">
          <span className="inline-flex shrink-0 items-center gap-1.5">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <span className={`size-1.5 rounded-full ${connected ? 'bg-success' : 'bg-muted-foreground'}`} />}{statusText}</span>
          <span className="min-w-0 max-w-full truncate" title={connectionEndpoint(connection)}>{connectionEndpoint(connection)}</span>
          {!connected && <Button size="xs" variant="secondary" disabled={busy} onClick={() => { void useConnectionStore.getState().connectConnection(connection.id).catch(() => {}) }}><Plug />{t('connection.connect')}</Button>}
        </div>
        {context.kind === 'connection' && <dl className="mb-5 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 border-b pb-4 text-xs">
          <dt className="text-muted-foreground">{t('connectionForm.driver').replace(':', '')}</dt><dd className="truncate">{productDisplayName(connection)} · {backend === 'jdbc' || connection.driverType === 'jdbc' ? 'JDBC' : 'Native'}</dd>
          <dt className="text-muted-foreground">{t('metadata.database')}</dt><dd className="truncate" title={connection.database ?? ''}>{connection.database || '—'}</dd>
          <dt className="text-muted-foreground">{t('browser.session')}</dt><dd>{connected ? t('browser.liveSession') : t('browser.noSession')}</dd>
        </dl>}
        {!allowedCatalog && <p className="mb-3 text-xs text-muted-foreground">{t('editor.databaseSelectHint')}</p>}
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 text-xs font-semibold">{t(context.kind === 'connection' ? 'browser.databases' : schema ? 'browser.objects' : 'browser.schemas')} <span className="ml-1 font-normal text-muted-foreground">{filteredRows.length}</span></h2>
          <div className="relative w-48 max-w-full"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" /><Input className="h-7 pl-7 text-xs" aria-label={t('browser.filterObjects')} placeholder={t('browser.filterObjects')} value={query} onChange={event => setQuery(event.target.value)} /></div>
        </div>
        {context.objectKind && !['table', 'view'].includes(context.objectKind) && capabilities?.supportsSchemaObjects === false && <p className="mb-3 text-xs text-muted-foreground" role="status">{t(context.objectKind === 'function' ? 'workbench.functionsUnsupported' : 'workbench.metadataUnsupported')}</p>}
        {request.error ? <p className="break-words border border-danger/20 bg-danger/5 p-3 text-xs text-danger" role="alert">{request.error}</p> : filteredRows.length > 0 ? <div className="overflow-hidden rounded border border-border/70">
          <div className="grid grid-cols-[minmax(0,1fr)_96px] border-b bg-surface-secondary px-3 py-2 text-[11px] text-muted-foreground"><span>{t('browser.name')}</span><span>{t('browser.kind')}</span></div>
          {filteredRows.map(row => {
            const Icon = OBJECT_ICONS[row.kind]
            return <button key={`${row.kind}:${row.name}`} type="button" className="grid min-h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_96px] items-center border-b border-border/40 px-3 py-1.5 text-left text-xs last:border-0 hover:bg-accent-hover focus-visible:outline-offset-[-2px]" title={row.name} onClick={() => openRow(row)}>
              <span className="flex min-w-0 items-center gap-2"><Icon className="size-3.5 shrink-0 text-primary/80" /><span className="truncate">{row.name}</span></span><span className="truncate text-[11px] text-muted-foreground">{t(`commandPalette.objectKinds.${row.kind}`)}</span>
            </button>
          })}
        </div> : <div className="rounded border border-dashed px-4 py-5 text-xs text-muted-foreground" role="status">{request.loading ? t('common.loading') : !connected ? t('browser.connectToBrowse') : !supported ? t('explorer.unsupportedTitle') : query ? t('connection.noMatches') : t('browser.noObjects')}</div>}
      </div>
    </section>
  )
}
