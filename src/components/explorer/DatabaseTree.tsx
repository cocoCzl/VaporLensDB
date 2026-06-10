import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ListFilter, RefreshCw, Search, Server } from 'lucide-react'
import { normalizeAppError } from '@/ipc/client'
import { useQuery } from '@/hooks/useQuery'
import { buildDataTabSql, qualifiedName, quoteIdentifier } from '@/lib/dataTabSql'
import { isSystemDatabase, isSystemSchema } from '@/lib/systemObjects'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useUiStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { ContextMenu, type ContextMenuAction } from '@/components/explorer/ContextMenu'
import { TreeNode, type DatabaseTreeNodeData } from '@/components/explorer/TreeNode'
import type { ConnectionConfig, ConnectionRuntimeStatus, DriverType } from '@/types/connection'
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
      | 'events'
      | 'showAllSchemas'
    action?: 'showAllSchemas'
  }
}

type NodeMap = Record<string, NodeRecord>
type ObjectCategoryFolder = NonNullable<NodeRecord['meta']>['folder']

interface ObjectCategoryDefinition {
  folder: ObjectCategoryFolder
  label: string
  kind: DbObjectKind | null
  drivers: DriverType[]
}

const ROOT_ID = 'root'
const GENERIC_OBJECT_KINDS: Array<Exclude<DbObjectKind, 'table' | 'view' | 'materializedView'>> = [
  'index',
  'procedure',
  'function',
  'package',
  'sequence',
  'trigger',
  'synonym',
  'event',
]
const OBJECT_CATEGORY_ORDER: ObjectCategoryDefinition[] = [
  {
    folder: 'tables',
    label: 'Tables',
    kind: 'table',
    drivers: ['postgres', 'mysql', 'oracle', 'sqlite'],
  },
  {
    folder: 'views',
    label: 'Views',
    kind: 'view',
    drivers: ['postgres', 'mysql', 'oracle', 'sqlite'],
  },
  {
    folder: 'materializedViews',
    label: 'Materialized Views',
    kind: 'materializedView',
    drivers: ['postgres', 'oracle'],
  },
  {
    folder: 'indexes',
    label: 'Indexes',
    kind: 'index',
    drivers: ['postgres', 'mysql', 'oracle', 'sqlite'],
  },
  {
    folder: 'procedures',
    label: 'Procedures',
    kind: 'procedure',
    drivers: ['postgres', 'mysql', 'oracle'],
  },
  {
    folder: 'functions',
    label: 'Functions',
    kind: 'function',
    drivers: ['postgres', 'mysql', 'oracle'],
  },
  {
    folder: 'packages',
    label: 'Packages',
    kind: 'package',
    drivers: ['oracle'],
  },
  {
    folder: 'sequences',
    label: 'Sequences',
    kind: 'sequence',
    drivers: ['postgres', 'oracle'],
  },
  {
    folder: 'triggers',
    label: 'Triggers',
    kind: 'trigger',
    drivers: ['postgres', 'mysql', 'oracle'],
  },
  {
    folder: 'synonyms',
    label: 'Synonyms',
    kind: 'synonym',
    drivers: ['oracle'],
  },
  {
    folder: 'events',
    label: 'Events',
    kind: 'event',
    drivers: ['mysql'],
  },
]

export function DatabaseTree() {
  const { activeConnectionId, connections, statuses, setActiveConnection } = useConnectionStore()
  const addTab = useEditorStore((state) => state.addTab)
  const notifyError = useUiStore((state) => state.notifyError)
  const notify = useUiStore((state) => state.notify)
  const showSystemObjects = useUiStore((state) => state.showSystemObjects)
  const dataPreviewDefaultRows = useUiStore((state) => state.dataPreviewDefaultRows)
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
  const [indexSearchActive, setIndexSearchActive] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string
    x: number
    y: number
  } | null>(null)

  const activeConnection = connections.find((connection) => connection.id === activeConnectionId)
  const activePath = activeConnectionId ? metadata.catalogSchemaPaths[activeConnectionId] : null
  const activeStatus = activeConnectionId ? statuses[activeConnectionId] : undefined
  const activeRuntimeStatus = activeStatus?.status ?? 'disconnected'
  const isConnected =
    activeConnectionId != null && activeRuntimeStatus === 'connected'
  const missingExternalDriver = activeConnection
    ? requiresExternalDriver(activeConnection) && (activeConnection.driverPaths?.length ?? 0) === 0
    : false
  const driverSupportsBrowsing = activeConnection
    ? supportsObjectBrowsing(activeConnection.driverType)
    : false
  const objectBrowsingSupported = driverSupportsBrowsing && !missingExternalDriver
  const canSearchCurrentConnection = isConnected && objectBrowsingSupported

  useEffect(() => {
    queueMicrotask(() => {
      setNodes({})
      setChildIds({})
      setIndexSearchActive(false)
      setSelectedNodeId(null)
    })
  }, [activeConnectionId])

  const loadedNodes = useMemo(() => flattenTree(nodes, childIds, ROOT_ID), [nodes, childIds])
  const visibleNodes = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()
    if (!normalizedFilter) {
      return loadedNodes
    }
    return loadedNodes.filter(
      (node) =>
        node.label.toLowerCase().includes(normalizedFilter) ||
        node.detail?.toLowerCase().includes(normalizedFilter),
    )
  }, [loadedNodes, filter])
  const hasLoadedTreeFilter = filter.trim().length > 0
  const showIndexResults =
    indexSearchActive && canSearchCurrentConnection && filter.trim().length >= 2

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
      const filteredDatabases = filterDatabases(
        activeConnection?.driverType ?? 'postgres',
        databases,
        showSystemObjects,
      )
      const selectedDatabase = selectCurrentDatabase(
        activeConnection,
        filteredDatabases,
        activePath?.database,
      )
      const visibleDatabases = selectedDatabase ? [selectedDatabase] : []
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
      const schemaChildIds: Record<string, string[]> = {}
      for (const database of visibleDatabases) {
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
          muted: activeConnection
            ? isSystemDatabase(activeConnection.driverType, database.name)
            : false,
          detail:
            activeConnection && isSystemDatabase(activeConnection.driverType, database.name)
              ? 'system'
              : undefined,
          tooltip: rawPath([database.name]),
          meta: { database: database.name },
        }

        if (activeConnection?.driverType === 'mysql') {
          const categories = schemaCategoryNodes(
            nextNodes[id],
            activeConnection.driverType,
            database.name,
          )
          for (const category of categories) {
            nextNodes[category.id] = category
          }
          databaseChildIds[id] = categories.map((category) => category.id)
          metadata.setCatalogSchemaPath({
            connectionId: activeConnectionId,
            database: database.name,
            schema: database.name,
            schemaListAvailable: false,
          })
          continue
        }

        const schemas = filterSchemas(
          activeConnection?.driverType ?? 'postgres',
          await metadata.loadSchemas(activeConnectionId, database.name, force),
          showSystemObjects,
        )
        const defaultSchema = selectDefaultSchema(activeConnection, schemas, activePath?.schema)
        nextNodes[schemasFolderId] = {
          id: schemasFolderId,
          parentId: id,
          label: 'Schemas',
          kind: 'folder',
          depth: 2,
          expandable: true,
          expanded: true,
          childrenLoaded: true,
          meta: { database: database.name, folder: 'schemas' },
        }
        databaseChildIds[id] = [schemasFolderId]

        const schemaFolderChildIds: string[] = []
        if (defaultSchema) {
          const schemaNodeId = schemaId(schemasFolderId, defaultSchema.name)
          nextNodes[schemaNodeId] = {
            id: schemaNodeId,
            parentId: schemasFolderId,
            label: defaultSchema.name,
            kind: 'schema',
            depth: 3,
            expandable: true,
            expanded: true,
            childrenLoaded: true,
            muted: activeConnection
              ? isSystemSchema(activeConnection.driverType, defaultSchema.name)
              : false,
            detail:
              activeConnection && isSystemSchema(activeConnection.driverType, defaultSchema.name)
                ? 'system'
                : undefined,
            tooltip: rawPath([database.name, defaultSchema.name]),
            meta: { database: database.name, schema: defaultSchema.name },
          }
          const categories = schemaCategoryNodes(
            nextNodes[schemaNodeId],
            activeConnection?.driverType ?? 'postgres',
            defaultSchema.name,
          )
          for (const category of categories) {
            nextNodes[category.id] = category
          }
          schemaFolderChildIds.push(schemaNodeId)
          schemaChildIds[schemaNodeId] = categories.map((category) => category.id)
        }

        const showAllSchemasNode = showAllSchemasActionNode(nextNodes[schemasFolderId])
        nextNodes[showAllSchemasNode.id] = showAllSchemasNode
        schemaFolderChildIds.push(showAllSchemasNode.id)
        schemaChildIds[schemasFolderId] = schemaFolderChildIds

        metadata.setCatalogSchemaPath({
          connectionId: activeConnectionId,
          database: database.name,
          schema: defaultSchema?.name ?? null,
          schemaListAvailable: true,
        })
      }

      setNodes(nextNodes)
      setChildIds({
        [ROOT_ID]: nextChildIds,
        [databaseFolderId]: visibleDatabases.map((database) => databaseId(database.name)),
        ...databaseChildIds,
        ...schemaChildIds,
      })
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
    // The loader intentionally reacts only to connection visibility boundaries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeConnectionId,
    isConnected,
    objectBrowsingSupported,
    showSystemObjects,
    activePath?.database,
    activePath?.schema,
  ])

  async function toggleNode(id: string, force = false) {
    const node = nodes[id]
    if (!node?.expandable || !activeConnectionId) {
      return
    }

    if (node.meta?.action === 'showAllSchemas') {
      await showAllSchemas(node)
      return
    }

    if (node.expanded && !force) {
      setNodes((state) => ({ ...state, [id]: { ...node, expanded: false } }))
      return
    }

    setNodes((state) => ({ ...state, [id]: { ...node, expanded: true, loading: true } }))

    if (node.childrenLoaded && !force) {
      setNodes((state) => ({ ...state, [id]: { ...state[id], expanded: true, loading: false } }))
      return
    }

    try {
      if (force) {
        clearNodeMetadataCache(node)
      }
      const children = await loadChildren(
        metadata,
        activeConnectionId,
        activeConnection?.driverType ?? 'postgres',
        node,
        showSystemObjects,
        force,
      )
      const nextChildren =
        children.length === 0 && isObjectCategoryNode(node) ? [emptyCategoryNode(node)] : children
      setNodes((state) =>
        replaceChildren(
          state,
          childIds[id] ?? [],
          Object.fromEntries(nextChildren.map((child) => [child.id, child])),
        ),
      )
      setChildIds((state) => ({ ...state, [id]: nextChildren.map((child) => child.id) }))
    } catch (error) {
      const appError = normalizeAppError(error)
      const errorNode = errorCategoryNode(node, appError.message)
      setNodes((state) =>
        replaceChildren(state, childIds[id] ?? [], { [errorNode.id]: errorNode }),
      )
      setChildIds((state) => ({ ...state, [id]: [errorNode.id] }))
      notifyError(appError, '加载元数据失败')
    } finally {
      setNodes((state) => ({
        ...state,
        [id]: { ...state[id], expanded: true, loading: false, childrenLoaded: true },
      }))
    }
  }

  function refreshNode(id: string) {
    if (id === ROOT_ID) {
      if (activeConnectionId) {
        metadata.clearConnection(activeConnectionId)
      }
      setNodes({})
      setChildIds({})
      loadRoot(true)
      return
    }
    toggleNode(id, true)
  }

  function clearNodeMetadataCache(node: NodeRecord) {
    if (!activeConnectionId) {
      return
    }
    if (node.kind === 'schema' && node.meta?.schema) {
      metadata.clearSchema(activeConnectionId, node.meta.schema)
      return
    }
    if (isObjectCategoryNode(node) && node.meta?.schema) {
      const kind = schemaFolderObjectKind(node.meta.folder)
      if (kind) {
        metadata.clearSchemaObjectKind(activeConnectionId, node.meta.schema, kind)
      }
    }
  }

  function startMetadataIndex() {
    if (!activeConnectionId || !isConnected || !objectBrowsingSupported) {
      return
    }
    void startIndexing(activeConnectionId, true)
  }

  async function searchAllMetadata() {
    const query = filter.trim()
    if (!activeConnectionId || query.length < 2 || !canSearchCurrentConnection) {
      return
    }
    setIndexSearchActive(true)
    await searchIndex(query, activeConnectionId)
  }

  async function showAllSchemas(node: NodeRecord) {
    if (!activeConnectionId || !activeConnection || !node.parentId) {
      return
    }
    const schemasFolderId = node.parentId
    const schemasFolder = nodes[schemasFolderId]
    if (!schemasFolder) {
      return
    }

    setNodes((state) => ({
      ...state,
      [schemasFolderId]: { ...schemasFolder, expanded: true, loading: true },
    }))

    try {
      const schemas = filterSchemas(
        activeConnection.driverType,
        await metadata.loadSchemas(activeConnectionId, schemasFolder.meta?.database, false),
        showSystemObjects,
      )
      const schemaNodes = schemas.map((schema) => {
        const id = schemaId(schemasFolderId, schema.name)
        return {
          ...nodes[id],
          id,
          parentId: schemasFolderId,
          label: schema.name,
          kind: 'schema' as const,
          depth: schemasFolder.depth + 1,
          expandable: true,
          expanded: nodes[id]?.expanded ?? false,
          childrenLoaded: nodes[id]?.childrenLoaded ?? false,
          muted: isSystemSchema(activeConnection.driverType, schema.name),
          detail: isSystemSchema(activeConnection.driverType, schema.name) ? 'system' : undefined,
          tooltip: rawPath([schemasFolder.meta?.database, schema.name]),
          meta: { database: schemasFolder.meta?.database, schema: schema.name },
        }
      })
      setNodes((state) =>
        replaceChildren(
          state,
          childIds[schemasFolderId] ?? [],
          Object.fromEntries(schemaNodes.map((schemaNode) => [schemaNode.id, schemaNode])),
        ),
      )
      setChildIds((state) => ({
        ...state,
        [schemasFolderId]: schemaNodes.map((schemaNode) => schemaNode.id),
      }))
    } catch (error) {
      notifyError(normalizeAppError(error), '加载 Schema 失败')
    } finally {
      setNodes((state) => ({
        ...state,
        [schemasFolderId]: {
          ...state[schemasFolderId],
          expanded: true,
          loading: false,
          childrenLoaded: true,
        },
      }))
    }
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

    const sql = buildDataTabSql({
      driverType: connection.driverType,
      schema: entry.schema,
      table,
      limit: dataPreviewDefaultRows,
      offset: 0,
      primaryKeyColumns: [],
    })
    const tabId = crypto.randomUUID()
    addTab({
      id: tabId,
      title: `${table} 数据`,
      kind: 'data',
      sql,
      connectionId: entry.connectionId,
      dataContext: {
        database: entry.database,
        schema: entry.schema,
        object: table,
        objectKind: entry.kind === 'view' ? 'view' : 'table',
        driverType: connection.driverType,
        limit: dataPreviewDefaultRows,
        offset: 0,
        primaryKeyColumns: [],
      },
    })
    runQuery(tabId, entry.connectionId, sql, { maxRows: dataPreviewDefaultRows })
  }

  async function openTableData(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !activeConnection || !isTableLikeNode(node)) {
      return
    }
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
    const sql = buildDataTabSql({
      driverType: activeConnection.driverType,
      schema: node.meta.schema,
      table: node.meta.table,
      limit: dataPreviewDefaultRows,
      offset: 0,
      primaryKeyColumns,
    })
    addTab({
      id: tabId,
      title: `${node.meta.table} 数据`,
      kind: 'data',
      sql,
      connectionId: activeConnectionId,
      dataContext: {
        database: node.meta.database,
        schema: node.meta.schema,
        object: node.meta.table,
        objectKind: node.kind,
        driverType: activeConnection.driverType,
        limit: dataPreviewDefaultRows,
        offset: 0,
        primaryKeyColumns,
      },
      tableContext: {
        schema: node.meta.schema,
        table: node.meta.table,
        driverType: activeConnection.driverType,
        primaryKeyColumns,
      },
    })
    runQuery(tabId, activeConnectionId, sql, { maxRows: dataPreviewDefaultRows })
  }

  function openTableDdl(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !isTableLikeNode(node)) {
      return
    }

    addTab({
      id: crypto.randomUUID(),
      title: `${node.meta.table} DDL`,
      kind: 'definition',
      sql: '',
      connectionId: activeConnectionId,
      definitionContext: {
        database: node.meta.database,
        schema: node.meta.schema,
        object: node.meta.table,
        objectKind: node.kind,
        definitionKind: 'DDL',
        operation: 'tableDdl',
      },
    })
  }

  function openGenericObjectDdl(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !isGenericObjectNode(node)) {
      return
    }

    const definitionKind = sourceLikeObjectKind(node.kind) ? 'Source' : 'DDL'
    addTab({
      id: crypto.randomUUID(),
      title: `${node.label} ${definitionKind}`,
      kind: 'definition',
      sql: '',
      connectionId: activeConnectionId,
      definitionContext: {
        database: node.meta.database,
        schema: node.meta.schema,
        object: node.label,
        objectKind: node.kind,
        definitionKind,
        operation: 'objectDdl',
      },
    })
  }

  function openNode(nodeId: string) {
    const node = nodes[nodeId]
    if (isTableLikeNode(node)) {
      void openTableData(nodeId)
      return
    }
    if (isGenericObjectNode(node)) {
      openGenericObjectDdl(nodeId)
      return
    }
    if (node?.expandable) {
      void toggleNode(nodeId)
    }
  }

  function openTableStructure(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !isTableLikeNode(node)) {
      return
    }
    addTab({
      id: crypto.randomUUID(),
      title: `${node.meta.table} 结构`,
      kind: 'structure',
      sql: '',
      connectionId: activeConnectionId,
      structureContext: {
        database: node.meta.database,
        schema: node.meta.schema,
        object: node.meta.table,
        objectKind: node.kind,
      },
      tableContext: {
        schema: node.meta.schema,
        table: node.meta.table,
        driverType: activeConnection?.driverType ?? 'postgres',
        primaryKeyColumns: [],
      },
    })
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

  function generateSelect(nodeId: string) {
    const node = nodes[nodeId]
    if (!activeConnectionId || !activeConnection || !isTableLikeNode(node)) {
      return
    }
    const sql = selectSql(activeConnection.driverType, node.meta.schema, node.meta.table)
    addTab({
      id: crypto.randomUUID(),
      title: `${node.meta.table} SELECT`,
      sql,
      connectionId: activeConnectionId,
    })
  }

  function setCurrentSchema(node: NodeRecord) {
    if (!activeConnectionId || node.kind !== 'schema' || !node.meta?.schema) {
      return
    }
    metadata.setCatalogSchemaPath({
      connectionId: activeConnectionId,
      database: node.meta.database ?? null,
      schema: node.meta.schema,
      schemaListAvailable: true,
    })
    notify({
      kind: 'success',
      title: '已设置当前 Schema',
      message: node.tooltip ?? node.label,
    })
  }

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId)
    const node = nodes[nodeId]
    if (!activeConnectionId || node?.kind !== 'schema' || !node.meta?.schema) {
      return
    }
    metadata.setCatalogSchemaPath({
      connectionId: activeConnectionId,
      database: node.meta.database ?? null,
      schema: node.meta.schema,
      schemaListAvailable: true,
    })
  }

  function refreshNodeOrParent(node: NodeRecord) {
    refreshNode(node.expandable ? node.id : node.parentId ?? node.id)
  }

  function moveSelection(delta: -1 | 1) {
    if (visibleNodes.length === 0) {
      return
    }
    const currentIndex = selectedNodeId
      ? visibleNodes.findIndex((node) => node.id === selectedNodeId)
      : -1
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : visibleNodes.length - 1
        : Math.min(visibleNodes.length - 1, Math.max(0, currentIndex + delta))
    setSelectedNodeId(visibleNodes[nextIndex].id)
  }

  function handleNodeKeyDown(node: DatabaseTreeNodeData, event: KeyboardEvent<HTMLDivElement>) {
    const target = nodes[node.id]
    if (!target) {
      return
    }
    setSelectedNodeId(node.id)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      openNode(node.id)
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      if (target?.expandable) {
        void toggleNode(target.id)
      }
      return
    }
    if (event.key === 'F5' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r')) {
      event.preventDefault()
      refreshNodeOrParent(target)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      const qualified =
        event.shiftKey && activeConnection
          ? qualifiedNodeName(activeConnection.driverType, target)
          : null
      void copyText(qualified ?? target.label, qualified ? '已复制全限定名' : '已复制名称')
    }
  }

  function contextActions(node: NodeRecord): ContextMenuAction[] {
    const tableLike = isTableLikeNode(node)
    const qualified = activeConnection ? qualifiedNodeName(activeConnection.driverType, node) : null

    if (tableLike) {
      return [
        {
          id: 'inspect',
          label: '打开对象结构',
          icon: 'ddl',
          onSelect: () => openTableStructure(node.id),
        },
        {
          id: 'open-data',
          label: `打开前 ${dataPreviewDefaultRows} 行`,
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
          id: 'generate-select',
          label: '生成 SELECT',
          icon: 'ddl',
          onSelect: () => generateSelect(node.id),
        },
        {
          id: 'copy-name',
          label: '复制名称',
          icon: 'copy',
          onSelect: () => copyText(node.label, '已复制对象名'),
        },
        {
          id: 'copy-qualified-name',
          label: '复制全限定名',
          icon: 'copyFull',
          onSelect: () => qualified && copyText(qualified, '已复制全限定名'),
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
          label: '查看 DDL/Source',
          icon: 'ddl',
          onSelect: () => openGenericObjectDdl(node.id),
        },
        {
          id: 'copy-name',
          label: '复制名称',
          icon: 'copy',
          onSelect: () => copyText(node.label, '已复制对象名'),
        },
        {
          id: 'copy-qualified-name',
          label: '复制全限定名',
          icon: 'copyFull',
          onSelect: () => qualified && copyText(qualified, '已复制全限定名'),
        },
        {
          id: 'refresh',
          label: '刷新',
          icon: 'refresh',
          onSelect: () => refreshNodeOrParent(node),
        },
      ]
    }

    if (node.expandable) {
      return [
        ...(node.kind === 'schema'
          ? [
              {
                id: 'set-current-schema',
                label: '设为当前 Schema',
                icon: 'ddl' as const,
                onSelect: () => setCurrentSchema(node),
              },
            ]
          : []),
        {
          id: 'copy-name',
          label: '复制名称',
          icon: 'copy',
          onSelect: () => copyText(node.label, '已复制名称'),
        },
        ...(qualified
          ? [
              {
                id: 'copy-qualified-name',
                label: '复制全限定名',
                icon: 'copyFull' as const,
                onSelect: () => copyText(qualified, '已复制全限定名'),
              },
            ]
          : []),
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
        <Server className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">对象浏览器</div>
          <div className="truncate text-xs text-muted-foreground">
            {activeConnection
              ? `${activeConnection.name} · ${connectionStatusSummary(activeRuntimeStatus, activeStatus?.message)}`
              : '未选择连接 · disconnected'}
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
            onChange={(event) => {
              setFilter(event.target.value)
              setIndexSearchActive(false)
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {showIndexResults ? (
          <MetadataSearchResults results={indexResults} onOpen={openIndexResult} />
        ) : !activeConnection ? (
          <ObjectTreeEmptyState
            title="连接后浏览对象"
            detail="从 Data Sources 选择并连接一个数据源。"
          />
        ) : missingExternalDriver ? (
          <ObjectTreeEmptyState
            title="缺少外部驱动"
            detail="Oracle/JDBC 对象浏览需要先配置本地 JDBC JAR。"
            action={
              <ConnectionDialog
                connection={activeConnection}
                trigger={
                  <Button type="button" size="xs" variant="secondary">
                    导入驱动
                  </Button>
                }
              />
            }
          />
        ) : activeRuntimeStatus === 'failed' ? (
          <ObjectTreeEmptyState
            title="连接失败"
            detail={activeStatus?.message ?? '请检查连接配置后重试。'}
            action={
              <ConnectionDialog
                connection={activeConnection}
                trigger={
                  <Button type="button" size="xs" variant="secondary">
                    编辑连接
                  </Button>
                }
              />
            }
          />
        ) : !isConnected ? (
          <ObjectTreeEmptyState
            title="连接后浏览对象"
            detail={`${connectionStatusSummary(activeRuntimeStatus)} · ${activeConnection.name}`}
          />
        ) : !objectBrowsingSupported ? (
          <ObjectTreeEmptyState
            title="对象浏览暂未支持"
            detail="当前连接仍可用于执行基础 SQL。"
          />
        ) : visibleNodes.length === 0 ? (
          <ObjectTreeEmptyState
            title={hasLoadedTreeFilter ? '已加载节点无匹配' : '暂无对象'}
            detail={
              hasLoadedTreeFilter
                ? '当前搜索只过滤已加载节点，不会自动扫描全库。'
                : '刷新当前连接以重新加载对象树。'
            }
            action={
              hasLoadedTreeFilter && filter.trim().length >= 2 ? (
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={!canSearchCurrentConnection || indexLoading}
                  onClick={searchAllMetadata}
                >
                  搜索全部 Schema/Object
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid gap-0.5" role="tree" aria-label="Object Tree">
              {visibleNodes.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  selected={selectedNodeId === node.id}
                  onToggle={toggleNode}
                  onSelect={selectNode}
                  onRefresh={refreshNode}
                  onDoubleClick={openNode}
                  onNodeKeyDown={handleNodeKeyDown}
                  onNodeContextMenu={(targetNode, position) => {
                    if (contextActions(nodes[targetNode.id]).length === 0) {
                      return
                    }
                    setContextMenu({ nodeId: targetNode.id, ...position })
                  }}
                />
              ))}
            </div>
            {hasLoadedTreeFilter && filter.trim().length >= 2 && (
              <div className="mt-2 border-t px-2 pt-2">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={!canSearchCurrentConnection || indexLoading}
                  onClick={searchAllMetadata}
                >
                  搜索全部 Schema/Object
                </Button>
              </div>
            )}
          </>
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

function ObjectTreeEmptyState({
  title,
  detail,
  action,
}: {
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-muted-foreground">
      <div className="grid max-w-full gap-2">
        <div className="font-medium text-foreground">{title}</div>
        {detail && <div className="max-h-12 overflow-hidden break-words">{detail}</div>}
        {action && <div className="flex justify-center">{action}</div>}
      </div>
    </div>
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

function showAllSchemasActionNode(parent: NodeRecord): NodeRecord {
  return {
    id: `${parent.id}/__show_all_schemas`,
    parentId: parent.id,
    label: 'Show all Schemas',
    kind: 'folder',
    depth: parent.depth + 1,
    expandable: true,
    detail: 'explicit',
    tooltip: rawPath([parent.meta?.database, 'Schemas']),
    meta: { ...parent.meta, folder: 'showAllSchemas', action: 'showAllSchemas' },
  }
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
  showSystemObjects: boolean,
  force = false,
): Promise<NodeRecord[]> {
  if (node.kind === 'database') {
    if (driverType === 'mysql') {
      return schemaCategoryNodes(node, driverType, required(node.meta?.database))
    }
    return [folderNode(node, 'schemas', 'Schemas', node.meta?.schema ?? '')]
  }

  if (node.kind === 'folder' && node.meta?.folder === 'schemas') {
    const schemas = filterSchemas(
      driverType,
      await metadata.loadSchemas(connectionId, node.meta?.database, force),
      showSystemObjects,
    )
    return schemas.map((schema) => ({
      id: schemaId(node.id, schema.name),
      parentId: node.id,
      label: schema.name,
      kind: 'schema',
      depth: node.depth + 1,
      expandable: true,
      muted: isSystemSchema(driverType, schema.name),
      detail: isSystemSchema(driverType, schema.name) ? 'system' : undefined,
      tooltip: rawPath([node.meta?.database, schema.name]),
      meta: { database: node.meta?.database, schema: schema.name },
    }))
  }

  if (node.kind === 'schema') {
    const schema = node.meta?.schema ?? node.label
    return schemaCategoryNodes(node, driverType, schema)
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
      tooltip: rawPath([node.meta?.database, node.meta?.schema, node.meta?.table, column.name]),
    }))
  }

  if (node.kind === 'folder' && node.meta?.folder === 'indexes' && node.meta.table) {
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
      tooltip: rawPath([node.meta?.database, index.schema, index.table, index.name]),
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
      tooltip: rawPath([node.meta?.database, foreignKey.schema, foreignKey.table, foreignKey.name]),
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
    tooltip: rawPath([parent.meta?.database, schema, table, label]),
    meta: { ...parent.meta, schema, table, folder },
  }
}

function schemaCategoryNodes(
  parent: NodeRecord,
  driverType: DriverType,
  schema: string,
): NodeRecord[] {
  return objectCategoryFolders(driverType).map(({ folder, label }) =>
    folderNode(parent, folder, label, schema),
  )
}

function objectCategoryFolders(driverType: DriverType): Array<{
  folder: NonNullable<NodeRecord['meta']>['folder']
  label: string
}> {
  return OBJECT_CATEGORY_ORDER.filter((category) =>
    category.drivers.includes(driverType),
  ).map(({ folder, label }) => ({ folder, label }))
}

function isObjectCategoryNode(node: NodeRecord) {
  return node.kind === 'folder' && schemaFolderObjectKind(node.meta?.folder) != null && !node.meta?.table
}

function emptyCategoryNode(parent: NodeRecord): NodeRecord {
  return {
    id: `${parent.id}/__empty`,
    parentId: parent.id,
    label: `No ${parent.label}`,
    kind: 'folder',
    depth: parent.depth + 1,
  }
}

function errorCategoryNode(parent: NodeRecord, message: string): NodeRecord {
  return {
    id: `${parent.id}/__error`,
    parentId: parent.id,
    label: 'Load failed',
    kind: 'folder',
    depth: parent.depth + 1,
    detail: message,
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
    tooltip: rawPath([parent.meta?.database, parent.meta?.schema, name]),
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
    tooltip: rawPath([parent.meta?.database, parent.meta?.schema, name]),
    meta: { ...parent.meta, table: name },
  }
}

function schemaFolderObjectKind(folder?: NonNullable<NodeRecord['meta']>['folder']): DbObjectKind | null {
  return OBJECT_CATEGORY_ORDER.find((category) => category.folder === folder)?.kind ?? null
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

function selectCurrentDatabase(
  connection: ConnectionConfig | undefined,
  databases: Array<{ name: string }>,
  preferredDatabase?: string | null,
) {
  if (databases.length === 0) return null
  const preferred = preferredDatabase?.trim()
  if (preferred) {
    return (
      databases.find((database) => database.name === preferred) ??
      databases.find((database) => database.name.toLowerCase() === preferred.toLowerCase()) ??
      { name: preferred }
    )
  }
  const configured = connection?.database?.trim()
  if (configured) {
    return (
      databases.find((database) => database.name === configured) ??
      databases.find((database) => database.name.toLowerCase() === configured.toLowerCase()) ??
      { name: configured }
    )
  }
  return databases[0]
}

function filterDatabases<T extends { name: string }>(
  driverType: DriverType,
  databases: T[],
  showSystemObjects: boolean,
) {
  return showSystemObjects
    ? databases
    : databases.filter((database) => !isSystemDatabase(driverType, database.name))
}

function filterSchemas<T extends { name: string }>(
  driverType: DriverType,
  schemas: T[],
  showSystemObjects: boolean,
) {
  return showSystemObjects
    ? schemas
    : schemas.filter((schema) => !isSystemSchema(driverType, schema.name))
}

function selectDefaultSchema(
  connection: ConnectionConfig | undefined,
  schemas: Array<{ name: string }>,
  preferredSchema?: string | null,
) {
  if (schemas.length === 0) return null
  const preferred = preferredSchema?.trim()
  if (preferred) {
    const match =
      schemas.find((schema) => schema.name === preferred) ??
      schemas.find((schema) => schema.name.toLowerCase() === preferred.toLowerCase())
    if (match) return match
  }
  const username = connection?.username?.trim()
  const candidates = [
    connection?.driverType === 'postgres' ? 'public' : null,
    connection?.driverType === 'oracle' ? username?.toUpperCase() : username,
    username,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const match =
      schemas.find((schema) => schema.name === candidate) ??
      schemas.find((schema) => schema.name.toLowerCase() === candidate.toLowerCase())
    if (match) return match
  }

  return schemas.length === 1 ? schemas[0] : null
}

function supportsObjectBrowsing(driverType: DriverType) {
  return driverType === 'postgres' || driverType === 'mysql' || driverType === 'oracle' || driverType === 'sqlite'
}

function requiresExternalDriver(connection: ConnectionConfig) {
  return connection.driverType === 'oracle' || connection.driverType === 'jdbc'
}

function connectionStatusSummary(
  status: ConnectionRuntimeStatus,
  message?: string | null,
) {
  if (status === 'connected') return 'connected'
  if (status === 'connecting') return 'connecting'
  if (status === 'failed') {
    return message ? `failed: ${message}` : 'failed'
  }
  return 'disconnected'
}

function isTableLikeNode(node?: NodeRecord): node is NodeRecord & {
  kind: 'table' | 'view' | 'materializedView'
  meta: { database?: string | null; schema: string; table: string }
} {
  return (
    Boolean(node) &&
    (node?.kind === 'table' || node?.kind === 'view' || node?.kind === 'materializedView') &&
    Boolean(node.meta?.schema) &&
    Boolean(node.meta?.table)
  )
}

function selectSql(driverType: DriverType, schema: string, table: string) {
  return `SELECT *\nFROM ${qualifiedName(driverType, schema, table)};`
}

function isGenericObjectNode(node?: NodeRecord): node is NodeRecord & {
  kind: Exclude<DbObjectKind, 'table' | 'view' | 'materializedView'>
  meta: { schema: string }
} {
  if (!node?.meta?.schema) {
    return false
  }
  return GENERIC_OBJECT_KINDS.includes(
    node.kind as Exclude<DbObjectKind, 'table' | 'view' | 'materializedView'>,
  )
}

function sourceLikeObjectKind(kind: DbObjectKind) {
  return kind === 'procedure' || kind === 'function' || kind === 'package' || kind === 'trigger'
}

function qualifiedNodeName(driverType: DriverType, node: NodeRecord) {
  const quote = driverType === 'mysql' ? '`' : '"'
  if (isTableLikeNode(node) || isGenericObjectNode(node)) {
    return `${quoteIdentifier(node.meta.schema, quote)}.${quoteIdentifier(node.meta.table ?? node.label, quote)}`
  }
  if (node.kind === 'schema' && node.meta?.schema) {
    return quoteIdentifier(node.meta.schema, quote)
  }
  if (node.kind === 'database' && node.meta?.database) {
    return quoteIdentifier(node.meta.database, quote)
  }
  return null
}

function rawPath(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join(' / ')
}
