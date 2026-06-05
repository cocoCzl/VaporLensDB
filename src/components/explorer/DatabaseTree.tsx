import { useEffect, useMemo, useState } from 'react'
import { ListFilter, RefreshCw, Search } from 'lucide-react'
import { normalizeAppError } from '@/ipc/client'
import { getObjectDdl, getTableDdl } from '@/ipc/metadata'
import { useQuery } from '@/hooks/useQuery'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useUiStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ContextMenu, type ContextMenuAction } from '@/components/explorer/ContextMenu'
import { TreeNode, type DatabaseTreeNodeData } from '@/components/explorer/TreeNode'
import type { DriverType } from '@/types/connection'
import type { DbObjectKind } from '@/types/metadata'

interface NodeRecord extends DatabaseTreeNodeData {
  parentId: string | null
  childrenLoaded?: boolean
  meta?: {
    database?: string
    schema?: string
    table?: string
    folder?:
      | 'databases'
      | 'schemas'
      | 'tables'
      | 'views'
      | 'functions'
      | 'materializedViews'
      | 'columns'
      | 'indexes'
      | 'foreignKeys'
      | 'procedures'
      | 'packages'
      | 'sequences'
      | 'triggers'
      | 'synonyms'
  }
}

type NodeMap = Record<string, NodeRecord>

const ROOT_ID = 'root'

export function DatabaseTree() {
  const { activeConnectionId, connections, statuses, setActiveConnection } = useConnectionStore()
  const addTab = useEditorStore((state) => state.addTab)
  const notifyError = useUiStore((state) => state.notifyError)
  const notify = useUiStore((state) => state.notify)
  const metadata = useMetadataStore()
  const inspectTable = useObjectInspectorStore((state) => state.inspectTable)
  const indexResults = useMetadataStore((state) => state.indexResults)
  const indexLoading = useMetadataStore((state) => state.indexLoading)
  const startIndexing = useMetadataStore((state) => state.startIndexing)
  const searchIndex = useMetadataStore((state) => state.searchIndex)
  const { runQuery } = useQuery()
  const [nodes, setNodes] = useState<NodeMap>({})
  const [childIds, setChildIds] = useState<Record<string, string[]>>({})
  const [filter, setFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string
    x: number
    y: number
  } | null>(null)

  const activeConnection = connections.find((connection) => connection.id === activeConnectionId)
  const isConnected =
    activeConnectionId != null && statuses[activeConnectionId]?.status === 'connected'
  const objectBrowsingSupported = activeConnection
    ? supportsObjectBrowsing(activeConnection.driverType)
    : false
  const showIndexResults = filter.trim().length >= 2

  useEffect(() => {
    queueMicrotask(() => {
      setNodes({})
      setChildIds({})
    })
  }, [activeConnectionId])

  const visibleNodes = useMemo(() => {
    const ordered = flattenTree(nodes, childIds, ROOT_ID)
    const normalizedFilter = filter.trim().toLowerCase()
    if (!normalizedFilter) {
      return ordered
    }
    return ordered.filter(
      (node) =>
        node.label.toLowerCase().includes(normalizedFilter) ||
        node.detail?.toLowerCase().includes(normalizedFilter),
    )
  }, [nodes, childIds, filter])

  async function loadRoot(force = false) {
    if (!activeConnectionId || !isConnected) {
      return
    }
    if (!objectBrowsingSupported) {
      setNodes({})
      setChildIds({})
      return
    }
    if (!force && childIds[ROOT_ID]?.length) {
      return
    }

    try {
      const databases = await metadata.loadDatabases(activeConnectionId, force)
      const visibleDatabases =
        activeConnection?.database != null
          ? databases.filter((database) => database.name === activeConnection.database)
          : databases
      const databaseFolderId = `${ROOT_ID}/databases`
      const nextNodes: NodeMap = {
        [databaseFolderId]: {
          id: databaseFolderId,
          parentId: ROOT_ID,
          label: 'Databases',
          kind: 'folder',
          depth: 0,
          expandable: true,
          expanded: true,
          meta: { folder: 'databases' },
        },
      }
      const nextChildIds = [databaseFolderId]

      const databaseChildIds: Record<string, string[]> = {}
      visibleDatabases.forEach((database) => {
        const id = databaseId(database.name)
        const schemasFolderId = `${id}/schemas`
        nextNodes[id] = {
          id,
          parentId: databaseFolderId,
          label: database.name,
          kind: 'database',
          depth: 1,
          expandable: true,
          expanded: true,
          meta: { database: database.name },
        }
        nextNodes[schemasFolderId] = {
          id: schemasFolderId,
          parentId: id,
          label: 'Schemas',
          kind: 'folder',
          depth: 2,
          expandable: true,
          expanded: false,
          meta: { database: database.name, folder: 'schemas' },
        }
        databaseChildIds[id] = [schemasFolderId]
      })

      setNodes((state) => replaceChildren(state, childIds[ROOT_ID] ?? [], nextNodes))
      setChildIds((state) => ({
        ...state,
        [ROOT_ID]: nextChildIds,
        [databaseFolderId]: visibleDatabases.map((database) => databaseId(database.name)),
        ...databaseChildIds,
      }))
    } catch (error) {
      notifyError(normalizeAppError(error), '加载数据库失败')
    } finally {
      // Root loading is represented by empty-state text for now.
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      loadRoot()
    })
    // The loader intentionally reacts only to active connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, isConnected, objectBrowsingSupported])

  useEffect(() => {
    const query = filter.trim()
    const timer = window.setTimeout(() => {
      if (query.length >= 2) {
        void searchIndex(query)
      } else {
        void searchIndex('')
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [filter, searchIndex])

  async function toggleNode(id: string, force = false) {
    const node = nodes[id]
    if (!node?.expandable || !activeConnectionId) {
      return
    }

    if (node.expanded && !force) {
      setNodes((state) => ({ ...state, [id]: { ...node, expanded: false } }))
      return
    }

    setNodes((state) => ({ ...state, [id]: { ...node, expanded: true, loading: true } }))

    try {
      const children = await loadChildren(
        metadata,
        activeConnectionId,
        activeConnection?.driverType ?? 'postgres',
        node,
        force,
      )
      setNodes((state) =>
        replaceChildren(
          state,
          childIds[id] ?? [],
          Object.fromEntries(children.map((child) => [child.id, child])),
        ),
      )
      setChildIds((state) => ({ ...state, [id]: children.map((child) => child.id) }))
    } catch (error) {
      notifyError(normalizeAppError(error), '加载元数据失败')
    } finally {
      setNodes((state) => ({
        ...state,
        [id]: { ...state[id], expanded: true, loading: false, childrenLoaded: true },
      }))
    }
  }

  function refreshNode(id: string) {
    if (id === ROOT_ID) {
      loadRoot(true)
      return
    }
    toggleNode(id, true)
  }

  function startMetadataIndex() {
    if (!activeConnectionId || !isConnected || !objectBrowsingSupported) {
      return
    }
    void startIndexing(activeConnectionId, true)
  }

  function openIndexResult(result: (typeof indexResults)[number]) {
    const entry = result.entry
    setActiveConnection(entry.connectionId)
    const connection = connections.find((candidate) => candidate.id === entry.connectionId)
    if (!connection) {
      return
    }

    const table = entry.table ?? (entry.kind === 'table' || entry.kind === 'view' ? entry.name : null)
    if (!table || !entry.schema) {
      notify({
        kind: 'info',
        title: '已切换连接',
        message: entry.path.join(' / '),
      })
      return
    }

    if (statuses[entry.connectionId]?.status !== 'connected') {
      notify({
        kind: 'warning',
        title: '连接未建立',
        message: '请先连接该数据源，再打开对象。',
      })
      return
    }

    const sql = previewSql(connection.driverType, entry.schema, table)
    const tabId = crypto.randomUUID()
    addTab({
      id: tabId,
      title: `${table} 数据`,
      sql,
      connectionId: entry.connectionId,
    })
    runQuery(tabId, entry.connectionId, sql)
  }

  async function openTableData(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !activeConnection || !isTableLikeNode(node)) {
      return
    }
    const sql = previewSql(activeConnection.driverType, node.meta.schema, node.meta.table)
    const tabId = crypto.randomUUID()
    let primaryKeyColumns: string[] = []
    try {
      const columns = await metadata.loadColumns(activeConnectionId, node.meta.schema, node.meta.table)
      primaryKeyColumns = columns
        .filter((column) => column.isPrimaryKey)
        .map((column) => column.name)
    } catch (error) {
      notifyError(normalizeAppError(error), '加载主键信息失败')
    }
    addTab({
      id: tabId,
      title: `${node.meta.table} 数据`,
      sql,
      connectionId: activeConnectionId,
      tableContext: {
        schema: node.meta.schema,
        table: node.meta.table,
        driverType: activeConnection.driverType,
        primaryKeyColumns,
      },
    })
    runQuery(tabId, activeConnectionId, sql)
  }

  async function openTableDdl(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !isTableLikeNode(node)) {
      return
    }

    try {
      const ddl = await getTableDdl(activeConnectionId, node.meta.schema, node.meta.table)
      addTab({
        id: crypto.randomUUID(),
        title: `${node.meta.table} DDL`,
        sql: ddl,
        connectionId: activeConnectionId,
      })
    } catch (error) {
      notifyError(normalizeAppError(error), '加载 DDL 失败')
    }
  }

  async function openGenericObjectDdl(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !isGenericObjectNode(node)) {
      return
    }

    try {
      const ddl = await getObjectDdl(
        activeConnectionId,
        node.meta.schema,
        node.label,
        node.kind,
      )
      addTab({
        id: crypto.randomUUID(),
        title: `${node.label} DDL`,
        sql: ddl,
        connectionId: activeConnectionId,
      })
    } catch (error) {
      notifyError(normalizeAppError(error), '加载对象定义失败')
    }
  }

  function openNode(nodeId: string) {
    const node = nodes[nodeId]
    if (isTableLikeNode(node)) {
      void openTableData(nodeId)
      return
    }
    if (isGenericObjectNode(node)) {
      void openGenericObjectDdl(nodeId)
    }
  }

  function openObjectInspector(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !isTableLikeNode(node)) {
      return
    }
    void inspectTable(
      activeConnectionId,
      node.meta.schema,
      node.meta.table,
      node.kind === 'view' ? 'view' : 'table',
    )
  }

  async function copyText(value: string, title: string) {
    try {
      await navigator.clipboard.writeText(value)
      notify({ kind: 'success', title })
    } catch (error) {
      notifyError(normalizeAppError(error), '复制失败')
    }
  }

  function contextActions(node: NodeRecord): ContextMenuAction[] {
    const tableLike = isTableLikeNode(node)

    if (tableLike) {
      return [
        {
          id: 'inspect',
          label: '打开对象结构',
          icon: 'ddl',
          onSelect: () => openObjectInspector(node.id),
        },
        {
          id: 'open-data',
          label: '打开前 1000 行',
          icon: 'data',
          onSelect: () => openTableData(node.id),
        },
        {
          id: 'view-ddl',
          label: '查看 DDL',
          icon: 'ddl',
          onSelect: () => openTableDdl(node.id),
        },
        {
          id: 'copy-name',
          label: '复制名称',
          icon: 'copy',
          onSelect: () => copyText(node.label, '已复制对象名'),
        },
        {
          id: 'refresh',
          label: '刷新',
          icon: 'refresh',
          onSelect: () => refreshNode(node.id),
        },
      ]
    }

    if (isGenericObjectNode(node)) {
      return [
        {
          id: 'view-ddl',
          label: '查看 DDL',
          icon: 'ddl',
          onSelect: () => openGenericObjectDdl(node.id),
        },
        {
          id: 'copy-name',
          label: '复制名称',
          icon: 'copy',
          onSelect: () => copyText(node.label, '已复制对象名'),
        },
      ]
    }

    if (node.expandable) {
      return [
        {
          id: 'refresh',
          label: '刷新',
          icon: 'refresh',
          onSelect: () => refreshNode(node.id),
        },
      ]
    }

    return []
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t ide-surface">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">对象浏览器</div>
          <div className="truncate text-xs text-muted-foreground">
            {activeConnection?.name ?? '未选择连接'}
          </div>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="刷新对象"
          disabled={!isConnected || !objectBrowsingSupported}
          onClick={() => refreshNode(ROOT_ID)}
        >
          <RefreshCw />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="索引当前连接对象"
          disabled={!isConnected || !objectBrowsingSupported || indexLoading}
          onClick={startMetadataIndex}
        >
          <ListFilter />
        </Button>
      </div>

      <div className="flex h-10 items-center gap-1 border-b px-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 rounded-md pl-7 text-xs"
            value={filter}
            disabled={!isConnected || !objectBrowsingSupported}
            placeholder="搜索对象"
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {showIndexResults ? (
          <MetadataSearchResults results={indexResults} onOpen={openIndexResult} />
        ) : !isConnected ? (
          <div className="grid h-24 place-items-center text-center text-xs text-muted-foreground">
            连接数据库后浏览对象
          </div>
        ) : !objectBrowsingSupported ? (
          <div className="grid h-24 place-items-center px-4 text-center text-xs text-muted-foreground">
            对象浏览暂未支持。当前连接仍可用于执行基础 SQL。
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="grid h-24 place-items-center text-center text-xs text-muted-foreground">
            暂无对象
          </div>
        ) : (
          <div className="grid gap-0.5">
            {visibleNodes.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                onToggle={toggleNode}
                onRefresh={refreshNode}
                onDoubleClick={openNode}
                onNodeContextMenu={(targetNode, position) => {
                  if (contextActions(nodes[targetNode.id]).length === 0) {
                    return
                  }
                  setContextMenu({ nodeId: targetNode.id, ...position })
                }}
              />
            ))}
          </div>
        )}
      </div>
      {contextMenu && nodes[contextMenu.nodeId] && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextActions(nodes[contextMenu.nodeId])}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  )
}

function MetadataSearchResults({
  results,
  onOpen,
}: {
  results: import('@/types/metadata').MetadataSearchResult[]
  onOpen: (result: import('@/types/metadata').MetadataSearchResult) => void
}) {
  if (results.length === 0) {
    return (
      <div className="grid h-24 place-items-center px-4 text-center text-xs text-muted-foreground">
        暂无索引结果。可点击对象浏览器右上角索引按钮刷新当前连接索引。
      </div>
    )
  }

  return (
    <div className="grid gap-0.5">
      {results.map((result) => (
        <button
          key={`${result.entry.connectionId}:${result.entry.kind}:${result.entry.path.join('.')}`}
          type="button"
          className="rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={() => onOpen(result)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{result.entry.name}</span>
            <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">
              {metadataKindLabel(result.entry.kind)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {result.entry.path.join(' / ')}
          </div>
        </button>
      ))}
    </div>
  )
}

function metadataKindLabel(kind: import('@/types/metadata').MetadataIndexKind) {
  if (kind === 'connection') return '连接'
  if (kind === 'database') return '库'
  if (kind === 'schema') return 'Schema'
  if (kind === 'table') return '表'
  if (kind === 'view') return '视图'
  if (kind === 'function') return '函数'
  return '列'
}

async function loadChildren(
  metadata: ReturnType<typeof useMetadataStore.getState>,
  connectionId: string,
  driverType: DriverType,
  node: NodeRecord,
  force = false,
): Promise<NodeRecord[]> {
  if (node.kind === 'database') {
    return [folderNode(node, 'schemas', 'Schemas', node.meta?.schema ?? '')]
  }

  if (node.kind === 'folder' && node.meta?.folder === 'schemas') {
    const schemas = await metadata.loadSchemas(connectionId, node.meta?.database, force)
    return schemas.map((schema) => ({
      id: schemaId(node.id, schema.name),
      parentId: node.id,
      label: schema.name,
      kind: 'schema',
      depth: node.depth + 1,
      expandable: true,
      meta: { database: node.meta?.database, schema: schema.name },
    }))
  }

  if (node.kind === 'schema') {
    const schema = node.meta?.schema ?? node.label
    const folders = [
      folderNode(node, 'tables', '表', schema),
      folderNode(node, 'views', '视图', schema),
    ]
    if (driverType === 'oracle') {
      folders.push(
        folderNode(node, 'materializedViews', '物化视图', schema),
        folderNode(node, 'indexes', '索引', schema),
        folderNode(node, 'procedures', '过程', schema),
        folderNode(node, 'functions', '函数', schema),
        folderNode(node, 'packages', '包', schema),
        folderNode(node, 'sequences', '序列', schema),
        folderNode(node, 'triggers', '触发器', schema),
        folderNode(node, 'synonyms', '同义词', schema),
      )
    } else {
      folders.push(folderNode(node, 'functions', '函数', schema))
    }
    return folders
  }

  if (node.kind === 'folder' && node.meta?.folder === 'tables') {
    const tables = await metadata.loadTables(connectionId, required(node.meta.schema), force)
    return tables.map((table) => tableNode(node, table.name, 'table'))
  }

  if (node.kind === 'folder' && node.meta?.folder === 'views') {
    const views = await metadata.loadViews(connectionId, required(node.meta.schema), force)
    return views.map((view) => tableNode(node, view.name, 'view'))
  }

  if (node.kind === 'folder' && node.meta?.folder === 'functions') {
    if (driverType === 'oracle') {
      return loadSchemaObjectNodes(metadata, connectionId, node, 'function', force)
    }
    const functions = await metadata.loadFunctions(connectionId, required(node.meta.schema), force)
    return functions.map((name) => genericObjectNode(node, name, 'function'))
  }

  const folderKind = node.meta?.table ? null : schemaFolderObjectKind(node.meta?.folder)
  if (node.kind === 'folder' && folderKind) {
    return loadSchemaObjectNodes(metadata, connectionId, node, folderKind, force)
  }

  if (node.kind === 'table' || node.kind === 'view' || node.kind === 'materializedView') {
    return [
      folderNode(node, 'columns', '列', required(node.meta?.schema), node.meta?.table),
      folderNode(node, 'indexes', '索引', required(node.meta?.schema), node.meta?.table),
      folderNode(node, 'foreignKeys', '外键', required(node.meta?.schema), node.meta?.table),
    ]
  }

  if (node.kind === 'folder' && node.meta?.folder === 'columns') {
    const columns = await metadata.loadColumns(
      connectionId,
      required(node.meta.schema),
      required(node.meta.table),
      force,
    )
    return columns.map((column) => ({
      id: `${node.id}/column/${column.name}`,
      parentId: node.id,
      label: column.name,
      kind: 'column',
      depth: node.depth + 1,
      detail: `${column.dataType}${column.isPrimaryKey ? ' PK' : ''}`,
    }))
  }

  if (node.kind === 'folder' && node.meta?.folder === 'indexes') {
    const indexes = await metadata.loadIndexes(
      connectionId,
      required(node.meta.schema),
      required(node.meta.table),
      force,
    )
    return indexes.map((index) => ({
      id: `${node.id}/index/${index.name}`,
      parentId: node.id,
      label: index.name,
      kind: 'index',
      depth: node.depth + 1,
      detail: index.unique ? 'unique' : undefined,
    }))
  }

  if (node.kind === 'folder' && node.meta?.folder === 'foreignKeys') {
    const foreignKeys = await metadata.loadForeignKeys(
      connectionId,
      required(node.meta.schema),
      required(node.meta.table),
      force,
    )
    return foreignKeys.map((foreignKey) => ({
      id: `${node.id}/fk/${foreignKey.name}`,
      parentId: node.id,
      label: foreignKey.name,
      kind: 'foreignKey',
      depth: node.depth + 1,
      detail: `${foreignKey.referencedTable}(${foreignKey.referencedColumns.join(', ')})`,
    }))
  }

  return []
}

function flattenTree(nodes: NodeMap, childIds: Record<string, string[]>, parentId: string) {
  const result: NodeRecord[] = []
  for (const id of childIds[parentId] ?? []) {
    const node = nodes[id]
    if (!node) {
      continue
    }
    result.push(node)
    if (node.expanded) {
      result.push(...flattenTree(nodes, childIds, node.id))
    }
  }
  return result
}

function replaceChildren(state: NodeMap, previousChildIds: string[], nextNodes: NodeMap) {
  const next = { ...state }
  for (const id of previousChildIds) {
    delete next[id]
  }
  return { ...next, ...nextNodes }
}

function folderNode(
  parent: NodeRecord,
  folder: NonNullable<NodeRecord['meta']>['folder'],
  label: string,
  schema: string,
  table?: string,
): NodeRecord {
  return {
    id: `${parent.id}/${folder}`,
    parentId: parent.id,
    label,
    kind: 'folder',
    depth: parent.depth + 1,
    expandable: true,
    meta: { ...parent.meta, schema, table, folder },
  }
}

function tableNode(parent: NodeRecord, name: string, kind: 'table' | 'view'): NodeRecord {
  return {
    id: `${parent.id}/${kind}/${name}`,
    parentId: parent.id,
    label: name,
    kind,
    depth: parent.depth + 1,
    expandable: true,
    meta: { ...parent.meta, table: name },
  }
}

async function loadSchemaObjectNodes(
  metadata: ReturnType<typeof useMetadataStore.getState>,
  connectionId: string,
  parent: NodeRecord,
  kind: DbObjectKind,
  force: boolean,
) {
  const objects = await metadata.loadSchemaObjects(connectionId, required(parent.meta?.schema), kind, force)
  return objects.map((object) => genericObjectNode(parent, object.name, object.kind, object.status ?? undefined))
}

function genericObjectNode(
  parent: NodeRecord,
  name: string,
  kind: DbObjectKind,
  status?: string,
): NodeRecord {
  return {
    id: `${parent.id}/${kind}/${name}`,
    parentId: parent.id,
    label: name,
    kind,
    depth: parent.depth + 1,
    expandable: kind === 'table' || kind === 'view' || kind === 'materializedView',
    detail: status && status !== 'VALID' ? status : undefined,
    meta: { ...parent.meta, table: name },
  }
}

function schemaFolderObjectKind(folder?: NonNullable<NodeRecord['meta']>['folder']): DbObjectKind | null {
  if (folder === 'materializedViews') return 'materializedView'
  if (folder === 'indexes') return 'index'
  if (folder === 'procedures') return 'procedure'
  if (folder === 'packages') return 'package'
  if (folder === 'sequences') return 'sequence'
  if (folder === 'triggers') return 'trigger'
  if (folder === 'synonyms') return 'synonym'
  return null
}

function databaseId(database: string) {
  return `database/${database}`
}

function schemaId(databaseNodeId: string, schema: string) {
  return `${databaseNodeId}/schema/${schema}`
}

function required(value?: string) {
  if (!value) {
    throw new Error('metadata path is incomplete')
  }
  return value
}

function supportsObjectBrowsing(driverType: DriverType) {
  return driverType === 'postgres' || driverType === 'mysql' || driverType === 'oracle'
}

function isTableLikeNode(node?: NodeRecord): node is NodeRecord & {
  kind: 'table' | 'view' | 'materializedView'
  meta: { schema: string; table: string }
} {
  return (
    Boolean(node) &&
    (node?.kind === 'table' || node?.kind === 'view' || node?.kind === 'materializedView') &&
    Boolean(node.meta?.schema) &&
    Boolean(node.meta?.table)
  )
}

function previewSql(driverType: DriverType, schema: string, table: string) {
  const from = qualifiedName(driverType, schema, table)
  if (driverType === 'oracle') {
    return `SELECT *\nFROM ${from}\nFETCH FIRST 1000 ROWS ONLY`
  }
  return `SELECT *\nFROM ${from}\nLIMIT 1000;`
}

function isGenericObjectNode(node?: NodeRecord): node is NodeRecord & {
  kind: Exclude<DbObjectKind, 'table' | 'view' | 'materializedView'>
  meta: { schema: string }
} {
  if (!node?.meta?.schema) {
    return false
  }
  return (
    ['index', 'procedure', 'function', 'package', 'sequence', 'trigger', 'synonym'].includes(
      node.kind,
    )
  )
}

function qualifiedName(driverType: DriverType, schema: string, table: string) {
  const quote = driverType === 'mysql' ? '`' : '"'
  return `${quoteIdentifier(schema, quote)}.${quoteIdentifier(table, quote)}`
}

function quoteIdentifier(value: string, quote: '"' | '`') {
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`
}
