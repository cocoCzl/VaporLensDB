import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { normalizeAppError } from '@/ipc/client'
import { useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import { RelationEdge } from '@/components/diagram/RelationEdge'
import { TableNode, type TableNodeData } from '@/components/diagram/TableNode'
import type { ColumnInfo, ForeignKeyInfo } from '@/types/metadata'

export interface ERDiagramProps {
  connectionId: string | null
  database?: string | null
  schema: string
  tables?: string[] | null
}

interface DiagramTable {
  name: string
  columns: ColumnInfo[]
  foreignKeys: ForeignKeyInfo[]
  error?: string | null
}

interface DiagramMetadataLoader {
  loadColumns: (connectionId: string, schema: string, table: string, force?: boolean) => Promise<ColumnInfo[]>
  loadForeignKeys: (connectionId: string, schema: string, table: string, force?: boolean) => Promise<ForeignKeyInfo[]>
}

const nodeTypes = { table: TableNode }
const edgeTypes = { relation: RelationEdge }
const MAX_SCHEMA_TABLES = 40

async function loadDiagramTables(
  connectionId: string,
  schema: string,
  tableNames: string[],
  force: boolean,
  metadata: DiagramMetadataLoader,
) {
  return Promise.all(
    tableNames.map(async (table) => {
      try {
        const [columns, foreignKeys] = await Promise.all([
          metadata.loadColumns(connectionId, schema, table, force),
          metadata.loadForeignKeys(connectionId, schema, table, force),
        ])
        return { name: table, columns, foreignKeys }
      } catch (loadError) {
        const appError = normalizeAppError(loadError)
        return { name: table, columns: [], foreignKeys: [], error: appError.message }
      }
    }),
  )
}

function directRelatedTableNames(seedTables: DiagramTable[], schema: string, seedNames: string[]) {
  const existing = new Set(seedNames)
  const related = new Set<string>()
  for (const table of seedTables) {
    for (const foreignKey of table.foreignKeys) {
      if (
        foreignKey.referencedTable &&
        !existing.has(foreignKey.referencedTable) &&
        (!foreignKey.referencedSchema || foreignKey.referencedSchema === schema)
      ) {
        related.add(foreignKey.referencedTable)
      }
    }
  }
  return Array.from(related)
}

export function ERDiagram({ connectionId, database, schema, tables }: ERDiagramProps) {
  const { t } = useTranslation()
  const metadata = useMetadataStore(useShallow((state) => ({
    loadTables: state.loadTables,
    loadColumns: state.loadColumns,
    loadForeignKeys: state.loadForeignKeys,
  })))
  const notifyError = useUiStore((state) => state.notifyError)
  const [diagramTables, setDiagramTables] = useState<DiagramTable[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  async function loadDiagram(force = false) {
    if (!connectionId) {
      setDiagramTables([])
      setError(t('diagram.connectFirst'))
      return
    }

    setLoading(true)
    setError(null)
    try {
      const seedTableNames =
        tables && tables.length > 0
          ? tables
          : (await metadata.loadTables(connectionId, schema, force)).map((table) => table.name)
      const seedNames = seedTableNames.slice(0, MAX_SCHEMA_TABLES)
      setTruncated(seedTableNames.length > seedNames.length)
      const loadedSeeds = await loadDiagramTables(connectionId, schema, seedNames, force, metadata)
      const relatedNames =
        tables && tables.length > 0
          ? directRelatedTableNames(loadedSeeds, schema, seedNames).slice(0, MAX_SCHEMA_TABLES - seedNames.length)
          : []
      const limitedNames = [...seedNames, ...relatedNames]
      if (limitedNames.length === 0) {
        setDiagramTables([])
        return
      }

      const related = relatedNames.length > 0
        ? await loadDiagramTables(connectionId, schema, relatedNames, force, metadata)
        : []
      setDiagramTables([...loadedSeeds, ...related])
    } catch (loadError) {
      const appError = normalizeAppError(loadError)
      setError(appError.message)
      notifyError(appError, t('diagram.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadDiagram(false)
    })
    // The table list is fixed for the tab lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, schema])

  const { nodes, edges, relationCount } = useMemo(
    () => buildDiagram(schema, diagramTables),
    [schema, diagramTables],
  )
  const tableErrorCount = diagramTables.filter((table) => table.error).length
  const canExport = nodes.length > 0

  function exportSvg() {
    if (!canExport) {
      notifyError(
        { code: 'ER_DIAGRAM_EXPORT_UNAVAILABLE', message: t('diagram.exportUnavailable') },
        t('diagram.exportFailed'),
      )
      return
    }

    try {
      const svg = buildDiagramSvg({
        schema,
        database,
        nodes,
        edges,
        truncated,
        tableErrorCount,
      })
      downloadTextFile(`${safeFileName(`${schema}-er-diagram`)}.svg`, svg, 'image/svg+xml')
    } catch (exportError) {
      notifyError(normalizeAppError(exportError), t('diagram.exportFailed'))
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b ide-toolbar px-3 py-1.5 text-xs">
        <div className="min-w-0">
          <div className="truncate font-medium">ER Diagram</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {database ? `${database} / ` : ''}
            {schema} · {diagramTables.length} tables · {relationCount} relationships
            {truncated ? ` · first ${MAX_SCHEMA_TABLES} tables` : ''}
            {tableErrorCount > 0 ? ` · ${tableErrorCount} tables missing metadata` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {truncated && (
            <span className="text-[11px] text-amber-600">
              Large diagram limit: first {MAX_SCHEMA_TABLES} tables
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canExport}
            onClick={exportSvg}
          >
            <Download className="size-3.5" />
            {t('diagram.exportSvg')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => loadDiagram(true)}>
            <RefreshCw />
            {loading ? t('workbench.refreshing') : t('diagram.refreshDiagram')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {error ? (
          <DiagramState title="ER diagram unavailable" detail={error} />
        ) : loading && diagramTables.length === 0 ? (
          <DiagramState title="Loading ER diagram" detail={t('diagram.loadingDetail')} />
        ) : diagramTables.length === 0 ? (
          <DiagramState title="No tables" detail={t('diagram.noTablesDetail')} />
        ) : nodes.length === 0 ? (
          <DiagramState title="Missing metadata" detail={t('diagram.missingMetadataDetail')} />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={0.2}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={2} />
          </ReactFlow>
        )}
      </div>
    </section>
  )
}

function buildDiagram(schema: string, tables: DiagramTable[]) {
  const tableSet = new Set(tables.map((table) => table.name))
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  const edges: Edge[] = []

  for (const table of tables) {
    for (const foreignKey of table.foreignKeys) {
      if (!tableSet.has(foreignKey.referencedTable)) {
        continue
      }
      outgoing.set(table.name, (outgoing.get(table.name) ?? 0) + 1)
      incoming.set(foreignKey.referencedTable, (incoming.get(foreignKey.referencedTable) ?? 0) + 1)
      edges.push({
        id: `${table.name}-${foreignKey.name}-${foreignKey.referencedTable}`,
        type: 'relation',
        source: table.name,
        target: foreignKey.referencedTable,
        data: {
          label: `${foreignKey.columns.join(', ')} -> ${foreignKey.referencedColumns.join(', ')}`,
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      })
    }
  }

  const nodes: Array<Node<TableNodeData>> = tables
    .filter((table) => table.columns.length > 0)
    .map((table, index) => ({
      id: table.name,
      type: 'table',
      position: gridPosition(index),
      data: {
        schema,
        table: table.name,
        columns: table.columns,
        incomingCount: incoming.get(table.name) ?? 0,
        outgoingCount: outgoing.get(table.name) ?? 0,
      },
    }))

  return { nodes, edges, relationCount: edges.length }
}

function gridPosition(index: number) {
  const columns = 3
  return {
    x: (index % columns) * 360,
    y: Math.floor(index / columns) * 360,
  }
}

function buildDiagramSvg({
  schema,
  database,
  nodes,
  edges,
  truncated,
  tableErrorCount,
}: {
  schema: string
  database?: string | null
  nodes: Array<Node<TableNodeData>>
  edges: Edge[]
  truncated: boolean
  tableErrorCount: number
}) {
  const nodeWidth = 280
  const headerHeight = 76
  const rowHeight = 24
  const padding = 40
  const titleHeight = 74
  const warningHeight = truncated || tableErrorCount > 0 ? 30 : 0
  const maxColumns = 18
  const nodeHeights = new Map(
    nodes.map((node) => [
      node.id,
      headerHeight + Math.min(node.data.columns.length, maxColumns) * rowHeight + (node.data.columns.length > maxColumns ? 28 : 0),
    ]),
  )
  const maxX = Math.max(...nodes.map((node) => node.position.x + nodeWidth), 0)
  const maxY = Math.max(
    ...nodes.map((node) => node.position.y + (nodeHeights.get(node.id) ?? headerHeight)),
    0,
  )
  const width = Math.max(960, maxX + padding * 2)
  const height = Math.max(640, maxY + padding * 2 + titleHeight + warningHeight)
  const offsetY = padding + titleHeight + warningHeight

  const edgeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeSvg = edges
    .map((edge) => {
      const source = edgeById.get(edge.source)
      const target = edgeById.get(edge.target)
      if (!source || !target) return ''
      const sourceHeight = nodeHeights.get(source.id) ?? headerHeight
      const targetHeight = nodeHeights.get(target.id) ?? headerHeight
      const x1 = source.position.x + nodeWidth + padding
      const y1 = source.position.y + sourceHeight / 2 + offsetY
      const x2 = target.position.x + padding
      const y2 = target.position.y + targetHeight / 2 + offsetY
      const midX = (x1 + x2) / 2
      const label = typeof edge.data?.label === 'string' ? edge.data.label : ''
      return `
        <path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="#4f6bed" stroke-width="1.6" marker-end="url(#arrow)" />
        ${label ? `<text x="${midX}" y="${(y1 + y2) / 2 - 6}" class="edge-label">${escapeXml(label)}</text>` : ''}
      `
    })
    .join('\n')

  const nodeSvg = nodes
    .map((node) => {
      const data = node.data
      const x = node.position.x + padding
      const y = node.position.y + offsetY
      const visibleColumns = data.columns.slice(0, maxColumns)
      const hiddenColumns = Math.max(0, data.columns.length - visibleColumns.length)
      const nodeHeight = nodeHeights.get(node.id) ?? headerHeight
      return `
        <g transform="translate(${x}, ${y})">
          <rect width="${nodeWidth}" height="${nodeHeight}" rx="7" class="node-shell" />
          <rect width="${nodeWidth}" height="${headerHeight}" rx="7" class="node-header" />
          <text x="14" y="22" class="node-schema">${escapeXml(data.schema)}</text>
          <text x="14" y="45" class="node-title">${escapeXml(data.table)}</text>
          <text x="14" y="64" class="node-meta">${data.columns.length} columns · ${data.outgoingCount} FK out · ${data.incomingCount} FK in</text>
          ${visibleColumns
            .map((column, index) => {
              const rowY = headerHeight + index * rowHeight
              return `
                <line x1="0" y1="${rowY}" x2="${nodeWidth}" y2="${rowY}" class="node-divider" />
                <text x="14" y="${rowY + 16}" class="${column.isPrimaryKey ? 'column-pk' : 'column-name'}">${column.isPrimaryKey ? 'PK ' : ''}${escapeXml(column.name)}</text>
                <text x="${nodeWidth - 14}" y="${rowY + 16}" text-anchor="end" class="column-type">${escapeXml(column.dataType)}</text>
              `
            })
            .join('\n')}
          ${
            hiddenColumns > 0
              ? `<text x="14" y="${nodeHeight - 10}" class="node-meta">+${hiddenColumns} more columns</text>`
              : ''
          }
        </g>
      `
    })
    .join('\n')

  const warning = [
    truncated ? `Large diagram limited to first ${MAX_SCHEMA_TABLES} tables.` : '',
    tableErrorCount > 0 ? `${tableErrorCount} tables had missing metadata.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#4f6bed" />
    </marker>
    <style>
      .canvas { fill: #f8fafc; }
      .title { fill: #172033; font: 700 20px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .subtitle, .node-meta, .column-type, .node-schema, .edge-label { fill: #667085; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .warning { fill: #b45309; font: 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .node-shell { fill: #ffffff; stroke: #cfd7e3; stroke-width: 1; }
      .node-header { fill: #eef3f8; stroke: #cfd7e3; stroke-width: 1; }
      .node-title { fill: #111827; font: 700 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .node-divider { stroke: #e5e7eb; stroke-width: 1; }
      .column-name { fill: #1f2937; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .column-pk { fill: #b45309; font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .edge-label { paint-order: stroke; stroke: #f8fafc; stroke-width: 4px; stroke-linejoin: round; }
    </style>
  </defs>
  <rect class="canvas" width="100%" height="100%" />
  <text x="${padding}" y="32" class="title">ER Diagram</text>
  <text x="${padding}" y="54" class="subtitle">${escapeXml([database, schema].filter(Boolean).join(' / '))} · ${nodes.length} tables · ${edges.length} relationships</text>
  ${warning ? `<text x="${padding}" y="80" class="warning">${escapeXml(warning)}</text>` : ''}
  ${edgeSvg}
  ${nodeSvg}
</svg>`
}

function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'er-diagram'
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function DiagramState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid h-full place-items-center bg-card text-center text-xs text-muted-foreground">
      <div>
        <div className="mb-1 font-medium text-foreground">{title}</div>
        <div>{detail}</div>
      </div>
    </div>
  )
}
