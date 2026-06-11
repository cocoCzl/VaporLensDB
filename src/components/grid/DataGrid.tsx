/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual intentionally exposes non-memoizable instance methods. */
import { useMemo, useRef, useState } from 'react'
import { Check, Copy, Pencil, Rows3, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { PendingCellChange } from '@/lib/dataEditSql'
import type { QueryResult } from '@/types/query'

interface DataGridProps {
  result?: QueryResult
  editable?: boolean
  pendingChanges?: PendingCellChange[]
  failedChanges?: PendingCellChange[]
  onEditCell?: (rowIndex: number, columnIndex: number, value: string) => void
}

const ROW_HEIGHT = 28
const ROW_INDEX_WIDTH = 56
const COLUMN_MIN_WIDTH = 180

export function DataGrid({
  result,
  editable = false,
  pendingChanges = [],
  failedChanges = [],
  onEditCell,
}: DataGridProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selectedCell, setSelectedCell] = useState<{
    rowIndex: number
    columnIndex: number
  } | null>(null)
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number
    columnIndex: number
    value: string
  } | null>(null)
  const virtualizer = useVirtualizer({
    count: result?.rows.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const gridTemplateColumns = useMemo(() => {
    const columnCount = result?.columns.length ?? 0
    return `${ROW_INDEX_WIDTH}px repeat(${columnCount}, minmax(${COLUMN_MIN_WIDTH}px, 1fr))`
  }, [result?.columns.length])
  const minGridWidth = useMemo(() => {
    const columnCount = result?.columns.length ?? 0
    return ROW_INDEX_WIDTH + columnCount * COLUMN_MIN_WIDTH
  }, [result?.columns.length])

  if (!result) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        {t('result.empty')}
      </div>
    )
  }

  if (result.columns.length === 0) {
    if (result.elapsedMs === 0 && result.affectedRows === 0) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {t('result.receiving')}
        </div>
      )
    }

    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t('result.statementComplete', { count: result.affectedRows, elapsedMs: result.elapsedMs })}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-xs">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ minWidth: minGridWidth }}>
          {result.truncated && (
            <div className="sticky top-0 z-30 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
              {t('result.truncated', {
                count: result.rowCount,
                maxRows: result.maxRows ? t('result.maxRowsSuffix', { count: result.maxRows }) : '',
              })}
            </div>
          )}
          <div
            className="sticky top-0 z-20 grid bg-muted/85"
            style={{
              gridTemplateColumns,
              minWidth: minGridWidth,
              top: result.truncated ? 29 : 0,
            }}
          >
            <div className="border-b border-r px-2 py-1.5 text-right font-medium text-muted-foreground">
              #
            </div>
            {result.columns.map((column) => (
              <div key={column.name} className="min-w-0 border-b border-r px-2 py-1.5 font-medium">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{column.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {column.dataType}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div
            className="relative"
            style={{
              height: virtualizer.getTotalSize(),
              minWidth: minGridWidth,
            }}
          >
            {virtualRows.map((virtualRow) => {
              const row = result.rows[virtualRow.index] ?? []

              return (
                <div
                  key={virtualRow.key}
                  className="absolute left-0 grid w-full hover:bg-accent/35"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns,
                    minWidth: minGridWidth,
                  }}
                >
                  <div className="border-b border-r bg-muted/40 px-2 py-1 text-right text-muted-foreground">
                    {virtualRow.index + 1}
                  </div>
                  {result.columns.map((column, columnIndex) => {
                    const formatted = formatValue(row[columnIndex])
                    const selected =
                      selectedCell?.rowIndex === virtualRow.index &&
                      selectedCell.columnIndex === columnIndex
                    const pending = pendingChanges.find(
                      (change) =>
                        change.rowIndex === virtualRow.index && change.columnName === column.name,
                    )
                    const failed = failedChanges.find(
                      (change) =>
                        change.rowIndex === virtualRow.index && change.columnName === column.name,
                    )
                    const editing =
                      editingCell?.rowIndex === virtualRow.index &&
                      editingCell.columnIndex === columnIndex

                    return (
                      <div
                        key={`${virtualRow.index}-${column.name}`}
                        className={[
                          'group relative min-w-0 border-b border-r font-mono outline-none',
                          selected
                            ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/40'
                            : 'hover:bg-accent/50',
                          pending ? 'bg-amber-50 text-amber-950' : '',
                          failed ? 'bg-destructive/10 text-destructive' : '',
                        ].join(' ')}
                        title={failed?.error ?? (pending ? t('result.pendingChange') : formatted)}
                      >
                        {editing ? (
                          <InlineCellEditor
                            value={editingCell.value}
                            onChange={(value) => setEditingCell({ ...editingCell, value })}
                            onCancel={() => setEditingCell(null)}
                            onCommit={() => {
                              onEditCell?.(virtualRow.index, columnIndex, editingCell.value)
                              setEditingCell(null)
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="flex h-full w-full min-w-0 items-center gap-1 px-2 py-1 text-left"
                            onClick={() =>
                              setSelectedCell({ rowIndex: virtualRow.index, columnIndex })
                            }
                            onDoubleClick={() => {
                              if (editable && onEditCell) {
                                setEditingCell({
                                  rowIndex: virtualRow.index,
                                  columnIndex,
                                  value: pending ? formatValue(pending.newValue) : formatted,
                                })
                              }
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {pending ? formatValue(pending.newValue) : formatted}
                            </span>
                            {pending && <span className="shrink-0 text-[10px]">pending</span>}
                            {editable && (
                              <Pencil className="size-3 shrink-0 opacity-0 group-hover:opacity-60" />
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <CellInspector
        result={result}
        selectedCell={selectedCell}
        t={t}
      />
    </div>
  )
}

function InlineCellEditor({
  value,
  onChange,
  onCancel,
  onCommit,
}: {
  value: string
  onChange: (value: string) => void
  onCancel: () => void
  onCommit: () => void
}) {
  return (
    <div className="flex h-full min-w-0 items-center gap-1 bg-background px-1">
      <input
        className="h-6 min-w-0 flex-1 rounded border bg-background px-1 font-mono text-xs outline-none"
        value={value}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onCommit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={onCommit}>
        <Check className="size-3" />
      </button>
      <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={onCancel}>
        <X className="size-3" />
      </button>
    </div>
  )
}

function CellInspector({
  result,
  selectedCell,
  t,
}: {
  result: QueryResult
  selectedCell: { rowIndex: number; columnIndex: number } | null
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (!selectedCell) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        <Rows3 className="size-3.5" />
        {t('result.selectCellHint')}
      </div>
    )
  }

  const column = result.columns[selectedCell.columnIndex]
  const row = result.rows[selectedCell.rowIndex] ?? []
  const value = formatValue(row[selectedCell.columnIndex])
  const rowValue = JSON.stringify(Object.fromEntries(result.columns.map((item, index) => [item.name, row[index]])))

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-t px-2 py-1 text-xs">
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          {selectedCell.rowIndex + 1}.{column?.name ?? selectedCell.columnIndex + 1}
        </span>
        <span className="ml-2 font-mono text-muted-foreground">{value}</span>
      </div>
      <Button type="button" size="xs" variant="ghost" onClick={() => copyToClipboard(value)}>
        <Copy className="size-3.5" />
        {t('result.cell')}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => copyToClipboard(rowValue)}>
        <Rows3 className="size-3.5" />
        {t('result.row')}
      </Button>
    </div>
  )
}

function copyToClipboard(value: string) {
  navigator.clipboard?.writeText(value)
}

function formatValue(value: unknown) {
  if (value == null) {
    return 'NULL'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}
