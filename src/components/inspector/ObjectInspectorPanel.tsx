import { AlertCircle, Copy, FileText, KeyRound, RefreshCw, Table2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import type { ColumnInfo, ForeignKeyInfo, IndexInfo } from '@/types/metadata'

const STRUCTURE_EDITING_ENABLED = false

export function ObjectInspectorPanel() {
  const selected = useObjectInspectorStore((state) => state.selected)
  const inspectTable = useObjectInspectorStore((state) => state.inspectTable)
  const clear = useObjectInspectorStore((state) => state.clear)

  if (!selected) {
    return null
  }

  const title = `${selected.schema}.${selected.table}`
  const kindLabel =
    selected.kind === 'materializedView'
      ? 'Materialized View'
      : selected.kind === 'view'
        ? 'View'
        : 'Table'

  return (
    <aside
      className="flex h-full w-[460px] min-w-[360px] max-w-[52vw] flex-col border-l bg-background"
      aria-label="Object Inspector workspace"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Table2 className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Object Inspector</div>
            <div className="text-[11px] text-muted-foreground">
              {kindLabel} · {title}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {STRUCTURE_EDITING_ENABLED && (
            <Button type="button" size="xs" variant="secondary">
              编辑结构
            </Button>
          )}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            title="刷新对象结构"
            disabled={selected.loading}
            onClick={() =>
              inspectTable(selected.connectionId, selected.schema, selected.table, selected.kind)
            }
          >
            <RefreshCw className={selected.loading ? 'animate-spin' : ''} />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" title="关闭" onClick={clear}>
            <X />
          </Button>
        </div>
      </div>

      {selected.error && (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{selected.error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <InspectorSection title="Columns" count={selected.columns.length}>
          <ColumnsTable columns={selected.columns} loading={selected.loading} />
        </InspectorSection>
        <InspectorSection title="Indexes" count={selected.indexes.length}>
          <IndexesTable indexes={selected.indexes} loading={selected.loading} />
        </InspectorSection>
        <InspectorSection title="Foreign Keys" count={selected.foreignKeys.length}>
          <ForeignKeysTable foreignKeys={selected.foreignKeys} loading={selected.loading} />
        </InspectorSection>
        <InspectorSection title="DDL">
          <DdlBlock ddl={selected.ddl} loading={selected.loading} />
        </InspectorSection>
      </div>
    </aside>
  )
}

function InspectorSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="border-b">
      <div className="flex h-9 items-center justify-between px-3 text-xs">
        <span className="font-semibold">{title}</span>
        {count != null && <span className="text-muted-foreground">{count}</span>}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </section>
  )
}

function ColumnsTable({ columns, loading }: { columns: ColumnInfo[]; loading: boolean }) {
  if (loading && columns.length === 0) return <EmptyState label="正在加载列" />
  if (columns.length === 0) return <EmptyState label="暂无列信息" />

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[minmax(120px,1fr)_120px_70px_52px] bg-muted/60 text-[11px] font-medium text-muted-foreground">
        <div className="border-r px-2 py-1.5">Name</div>
        <div className="border-r px-2 py-1.5">Type</div>
        <div className="border-r px-2 py-1.5">Null</div>
        <div className="px-2 py-1.5">Key</div>
      </div>
      {columns.map((column) => (
        <div
          key={`${column.name}:${column.ordinalPosition}`}
          className="grid grid-cols-[minmax(120px,1fr)_120px_70px_52px] border-t text-xs"
        >
          <div className="min-w-0 truncate border-r px-2 py-1.5 font-mono">{column.name}</div>
          <div className="min-w-0 truncate border-r px-2 py-1.5 text-muted-foreground">
            {column.dataType}
          </div>
          <div className="border-r px-2 py-1.5 text-muted-foreground">
            {column.nullable ? 'YES' : 'NO'}
          </div>
          <div className="px-2 py-1.5">
            {column.isPrimaryKey && <KeyRound className="size-3.5 text-amber-600" />}
          </div>
        </div>
      ))}
    </div>
  )
}

function IndexesTable({ indexes, loading }: { indexes: IndexInfo[]; loading: boolean }) {
  if (loading && indexes.length === 0) return <EmptyState label="正在加载索引" />
  if (indexes.length === 0) return <EmptyState label="暂无索引" />

  return (
    <div className="grid gap-1">
      {indexes.map((index) => (
        <div key={index.name} className="rounded-md border px-2 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono">{index.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {index.unique ? 'unique' : 'index'}
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {index.columns.join(', ') || '未返回列'}
          </div>
        </div>
      ))}
    </div>
  )
}

function ForeignKeysTable({
  foreignKeys,
  loading,
}: {
  foreignKeys: ForeignKeyInfo[]
  loading: boolean
}) {
  if (loading && foreignKeys.length === 0) return <EmptyState label="正在加载外键" />
  if (foreignKeys.length === 0) return <EmptyState label="暂无外键" />

  return (
    <div className="grid gap-1">
      {foreignKeys.map((fk) => (
        <div key={fk.name} className="rounded-md border px-2 py-1.5 text-xs">
          <div className="truncate font-mono">{fk.name}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {fk.columns.join(', ')} {'->'} {fk.referencedTable}(
            {fk.referencedColumns.join(', ')})
          </div>
        </div>
      ))}
    </div>
  )
}

function DdlBlock({ ddl, loading }: { ddl: string | null; loading: boolean }) {
  if (loading && !ddl) return <EmptyState label="正在加载 DDL" />
  if (!ddl) return <EmptyState label="暂无 DDL" />

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex h-8 items-center justify-between border-b bg-muted/40 px-2 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <FileText className="size-3.5" />
          Definition
        </span>
        <Button type="button" size="xs" variant="ghost" onClick={() => navigator.clipboard?.writeText(ddl)}>
          <Copy className="size-3" />
          复制
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto p-2 text-[11px] leading-5">{ddl}</pre>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{label}</div>
}
