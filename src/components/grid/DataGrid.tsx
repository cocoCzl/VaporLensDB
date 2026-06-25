/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual intentionally exposes non-memoizable instance methods. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Copy, Maximize2, Rows3 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { QueryResult } from '@/types/query'

interface DataGridProps {
  result?: QueryResult
}

const ROW_HEIGHT = 28
const ROW_INDEX_WIDTH = 56
const COLUMN_MIN_WIDTH = 180
const COLUMN_MAX_WIDTH = 640

export function DataGrid({
  result,
}: DataGridProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<GridSelection | null>(null)
  const [includeHeaders, setIncludeHeaders] = useState(false)
  const [viewerValue, setViewerValue] = useState<{ title: string; value: string } | null>(null)
  const storageKey = useMemo(() => result ? columnWidthStorageKey(result) : null, [result])
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    storageKey ? readColumnWidths(storageKey) : {},
  )
  useEffect(() => {
    setColumnWidths(storageKey ? readColumnWidths(storageKey) : {})
  }, [storageKey])
  const virtualizer = useVirtualizer({
    count: result?.rows.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const gridTemplateColumns = useMemo(() => {
    const columns = result?.columns ?? []
    const widths = columns.map((column) => `${columnWidths[column.name] ?? COLUMN_MIN_WIDTH}px`)
    return `${ROW_INDEX_WIDTH}px ${widths.join(' ')}`
  }, [columnWidths, result?.columns])
  const minGridWidth = useMemo(() => {
    const columns = result?.columns ?? []
    return ROW_INDEX_WIDTH + columns.reduce((sum, column) => sum + (columnWidths[column.name] ?? COLUMN_MIN_WIDTH), 0)
  }, [columnWidths, result?.columns])

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
            {result.columns.map((column, columnIndex) => (
              <div key={column.name} className="group relative min-w-0 border-b border-r px-2 py-1.5 font-medium">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{column.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {column.dataType}
                  </span>
                </div>
                <ColumnResizeHandle
                  columnName={column.name}
                  currentWidth={columnWidths[column.name] ?? COLUMN_MIN_WIDTH}
                  storageKey={storageKey}
                  onResize={(width) =>
                    setColumnWidths((current) => {
                      const next = { ...current, [column.name]: width }
                      if (storageKey) writeColumnWidths(storageKey, next)
                      return next
                    })
                  }
                />
                <button
                  type="button"
                  className="absolute inset-0 -z-10"
                  aria-label={`select column ${columnIndex + 1}`}
                />
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
                    const selected = selectionContains(selection, virtualRow.index, columnIndex)
                    const inspectable = shouldOfferViewer(formatted)
                    return (
                      <div
                        key={`${virtualRow.index}-${column.name}`}
                        className={[
                          'group relative min-w-0 border-b border-r font-mono outline-none',
                          selected
                            ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/40'
                            : 'hover:bg-accent/50',
                        ].join(' ')}
                        title={formatted}
                      >
                        <button
                          type="button"
                          className="flex h-full w-full min-w-0 items-center gap-1 px-2 py-1 text-left"
                          onClick={(event) =>
                            setSelection((current) =>
                              nextCellSelection(current, virtualRow.index, columnIndex, event.shiftKey),
                            )
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">{formatted}</span>
                          {inspectable && (
                            <span
                              role="button"
                              tabIndex={0}
                              className="grid size-5 shrink-0 place-items-center rounded opacity-0 hover:bg-background/80 group-hover:opacity-100"
                              title="Open value viewer"
                              onClick={(event) => {
                                event.stopPropagation()
                                setViewerValue({
                                  title: `${column.name} · row ${virtualRow.index + 1}`,
                                  value: formatted,
                                })
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setViewerValue({
                                    title: `${column.name} · row ${virtualRow.index + 1}`,
                                    value: formatted,
                                  })
                                }
                              }}
                            >
                              <Maximize2 className="size-3" />
                            </span>
                          )}
                        </button>
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
        selection={selection}
        includeHeaders={includeHeaders}
        onIncludeHeadersChange={setIncludeHeaders}
        t={t}
      />
      <ValueViewer value={viewerValue} onOpenChange={(open) => !open && setViewerValue(null)} />
    </div>
  )
}

function CellInspector({
  result,
  selection,
  includeHeaders,
  onIncludeHeadersChange,
  t,
}: {
  result: QueryResult
  selection: GridSelection | null
  includeHeaders: boolean
  onIncludeHeadersChange: (includeHeaders: boolean) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (!selection) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        <Rows3 className="size-3.5" />
        {t('result.selectCellHint')}
      </div>
    )
  }

  const range = normalizeSelection(selection, result)
  const firstColumn = result.columns[range.startColumn]
  const firstRow = result.rows[range.startRow] ?? []
  const value = formatValue(firstRow[range.startColumn])
  const rowValue = JSON.stringify(Object.fromEntries(result.columns.map((item, index) => [item.name, firstRow[index]])))
  const rangeLabel =
    range.startRow === range.endRow && range.startColumn === range.endColumn
      ? `${range.startRow + 1}.${firstColumn?.name ?? range.startColumn + 1}`
      : `${range.startRow + 1}:${range.endRow + 1} · ${range.startColumn + 1}:${range.endColumn + 1}`

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-t px-2 py-1 text-xs">
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium">{rangeLabel}</span>
        <span className="ml-2 font-mono text-muted-foreground">{value}</span>
      </div>
      <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={includeHeaders}
          onChange={(event) => onIncludeHeadersChange(event.target.checked)}
        />
        Headers
      </label>
      <Button type="button" size="xs" variant="ghost" onClick={() => copyToClipboard(value)}>
        <Copy className="size-3.5" />
        {t('result.cell')}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => copyToClipboard(rowValue)}>
        <Rows3 className="size-3.5" />
        {t('result.row')}
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => copyToClipboard(formatRange(result, range, includeHeaders, 'text'))}
      >
        Text
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => copyToClipboard(formatRange(result, range, includeHeaders, 'csv'))}
      >
        CSV
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => copyToClipboard(formatRange(result, range, includeHeaders, 'json'))}
      >
        JSON
      </Button>
    </div>
  )
}

interface GridSelection {
  anchorRow: number
  anchorColumn: number
  focusRow: number
  focusColumn: number
}

interface NormalizedSelection {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

function ColumnResizeHandle({
  columnName,
  currentWidth,
  storageKey,
  onResize,
}: {
  columnName: string
  currentWidth: number
  storageKey: string | null
  onResize: (width: number) => void
}) {
  return (
    <span
      role="separator"
      aria-label={`resize ${columnName}`}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize opacity-0 hover:bg-primary/50 group-hover:opacity-100"
      onMouseDown={(event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = currentWidth
        function move(moveEvent: MouseEvent) {
          onResize(clampWidth(startWidth + moveEvent.clientX - startX))
        }
        function up() {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
          if (storageKey) {
            document.body.style.cursor = ''
          }
        }
        document.body.style.cursor = 'col-resize'
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
      }}
    />
  )
}

function ValueViewer({
  value,
  onOpenChange,
}: {
  value: { title: string; value: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [formatted, setFormatted] = useState(false)
  const raw = value?.value ?? ''
  const display = formatted ? formatJsonIfPossible(raw) : raw
  const lowerQuery = query.trim().toLowerCase()
  const matchCount = lowerQuery ? display.toLowerCase().split(lowerQuery).length - 1 : 0

  return (
    <Dialog open={Boolean(value)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0" showCloseButton>
        <DialogHeader className="border-b p-4">
          <DialogTitle>{value?.title ?? 'Value'}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <input
            className="ide-input h-8 min-w-0 flex-1 text-xs"
            placeholder="Search value"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">{matchCount} matches</span>
          <Button type="button" size="xs" variant="ghost" onClick={() => navigator.clipboard?.writeText(raw)}>
            <Copy className="size-3.5" />
            Copy
          </Button>
          <Button
            type="button"
            size="xs"
            variant={formatted ? 'secondary' : 'ghost'}
            disabled={!isJsonLike(raw)}
            onClick={() => setFormatted((current) => !current)}
          >
            <Braces className="size-3.5" />
            JSON
          </Button>
        </div>
        <pre className="max-h-[60vh] min-h-80 overflow-auto whitespace-pre-wrap bg-card p-4 font-mono text-xs leading-5">
          {display}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

function copyToClipboard(value: string) {
  navigator.clipboard?.writeText(value)
}

function nextCellSelection(
  current: GridSelection | null,
  rowIndex: number,
  columnIndex: number,
  extend: boolean,
): GridSelection {
  if (extend && current) {
    return { ...current, focusRow: rowIndex, focusColumn: columnIndex }
  }
  return { anchorRow: rowIndex, anchorColumn: columnIndex, focusRow: rowIndex, focusColumn: columnIndex }
}

function normalizeSelection(selection: GridSelection, result: QueryResult): NormalizedSelection {
  return {
    startRow: clampNumber(Math.min(selection.anchorRow, selection.focusRow), 0, result.rows.length - 1),
    endRow: clampNumber(Math.max(selection.anchorRow, selection.focusRow), 0, result.rows.length - 1),
    startColumn: clampNumber(Math.min(selection.anchorColumn, selection.focusColumn), 0, result.columns.length - 1),
    endColumn: clampNumber(Math.max(selection.anchorColumn, selection.focusColumn), 0, result.columns.length - 1),
  }
}

function selectionContains(selection: GridSelection | null, rowIndex: number, columnIndex: number) {
  if (!selection) return false
  const startRow = Math.min(selection.anchorRow, selection.focusRow)
  const endRow = Math.max(selection.anchorRow, selection.focusRow)
  const startColumn = Math.min(selection.anchorColumn, selection.focusColumn)
  const endColumn = Math.max(selection.anchorColumn, selection.focusColumn)
  return rowIndex >= startRow && rowIndex <= endRow && columnIndex >= startColumn && columnIndex <= endColumn
}

function formatRange(
  result: QueryResult,
  range: NormalizedSelection,
  includeHeaders: boolean,
  format: 'text' | 'csv' | 'json',
) {
  const columns = result.columns.slice(range.startColumn, range.endColumn + 1)
  const rows = result.rows
    .slice(range.startRow, range.endRow + 1)
    .map((row) => row.slice(range.startColumn, range.endColumn + 1))

  if (format === 'json') {
    return JSON.stringify(
      rows.map((row) => Object.fromEntries(columns.map((column, index) => [column.name, row[index]]))),
      null,
      2,
    )
  }

  const delimiter = format === 'csv' ? ',' : '\t'
  const escape = format === 'csv' ? csvEscape : textEscape
  const lines = rows.map((row) => row.map((value) => escape(formatValue(value))).join(delimiter))
  if (includeHeaders) {
    lines.unshift(columns.map((column) => escape(column.name)).join(delimiter))
  }
  return lines.join('\n')
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function textEscape(value: string) {
  return value.replace(/\t/g, ' ').replace(/\n/g, ' ')
}

function shouldOfferViewer(value: string) {
  return value.length > 120 || isJsonLike(value)
}

function isJsonLike(value: string) {
  const trimmed = value.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function formatJsonIfPossible(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function columnWidthStorageKey(result: QueryResult) {
  return `vaporlensdb.grid.widths.${result.columns.map((column) => column.name).join('|')}`
}

function readColumnWidths(key: string) {
  if (typeof window === 'undefined') return {}
  try {
    const value = window.localStorage.getItem(key)
    if (!value) return {}
    const parsed = JSON.parse(value) as Record<string, number>
    return Object.fromEntries(
      Object.entries(parsed).map(([column, width]) => [column, clampWidth(width)]),
    )
  } catch {
    return {}
  }
}

function writeColumnWidths(key: string, widths: Record<string, number>) {
  window.localStorage.setItem(key, JSON.stringify(widths))
}

function clampWidth(width: number) {
  return clampNumber(width, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH)
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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
