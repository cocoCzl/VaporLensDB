import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { normalizeAppError } from '@/ipc/client'
import { getTableDdl } from '@/ipc/metadata'
import { useQuery } from '@/hooks/useQuery'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ContextMenu, type ContextMenuAction } from '@/components/explorer/ContextMenu'
import { TreeNode, type DatabaseTreeNodeData } from '@/components/explorer/TreeNode'
import type { DriverType } from '@/types/connection'

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
      | 'columns'
      | 'indexes'
      | 'foreignKeys'
  }
}

type NodeMap = Record<string, NodeRecord>

const ROOT_ID = 'root'

export function DatabaseTree() {
  const { activeConnectionId, connections, statuses } = useConnectionStore()
  const addTab = useEditorStore((state) => state.addTab)
  const notifyError = useUiStore((state) => state.notifyError)
  const notify = useUiStore((state) => state.notify)
  const metadata = useMetadataStore()
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

      visibleDatabases.forEach((database) => {
        nextNodes[databaseId(database.name)] = {
          id: databaseId(database.name),
          parentId: databaseFolderId,
          label: database.name,
          kind: 'database',
          depth: 1,
          expandable: true,
          expanded: false,
          meta: { database: database.name },
        }
      })

      setNodes((state) => replaceChildren(state, childIds[ROOT_ID] ?? [], nextNodes))
      setChildIds((state) => ({
        ...state,
        [ROOT_ID]: nextChildIds,
        [databaseFolderId]: visibleDatabases.map((database) => databaseId(database.name)),
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
      const children = await loadChildren(metadata, activeConnectionId, node, force)
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

  async function openTableData(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !activeConnection || !isTableLikeNode(node)) {
      return
    }
    const sql = `SELECT *\nFROM ${qualifiedName(activeConnection.driverType, node.meta.schema, node.meta.table)}\nLIMIT 1000;`
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
        {!isConnected ? (
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
                onDoubleClick={openTableData}
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

async function loadChildren(
  metadata: ReturnType<typeof useMetadataStore.getState>,
  connectionId: string,
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
    return [
      folderNode(node, 'tables', '表', schema),
      folderNode(node, 'views', '视图', schema),
      folderNode(node, 'functions', '函数', schema),
    ]
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
    const functions = await metadata.loadFunctions(connectionId, required(node.meta.schema), force)
    return functions.map((name) => ({
      id: `${node.id}/function/${name}`,
      parentId: node.id,
      label: name,
      kind: 'function',
      depth: node.depth + 1,
    }))
  }

  if (node.kind === 'table' || node.kind === 'view') {
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
  return driverType === 'postgres' || driverType === 'mysql'
}

function isTableLikeNode(node?: NodeRecord): node is NodeRecord & {
  kind: 'table' | 'view'
  meta: { schema: string; table: string }
} {
  return (
    Boolean(node) &&
    (node?.kind === 'table' || node?.kind === 'view') &&
    Boolean(node.meta?.schema) &&
    Boolean(node.meta?.table)
  )
}

function qualifiedName(driverType: DriverType, schema: string, table: string) {
  const quote = driverType === 'mysql' ? '`' : '"'
  return `${quoteIdentifier(schema, quote)}.${quoteIdentifier(table, quote)}`
}

function quoteIdentifier(value: string, quote: '"' | '`') {
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`
}
