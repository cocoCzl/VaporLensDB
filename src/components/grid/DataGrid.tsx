/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual intentionally exposes non-memoizable instance methods. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Check, Copy, Maximize2, Rows3, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { isTauri } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { writeText as writeNativeClipboardText } from '@tauri-apps/plugin-clipboard-manager'
import { Button } from '@/components/ui/button'
import { ContextMenu, type ContextMenuAction } from '@/components/explorer/ContextMenu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ColumnMeta, QueryResult } from '@/types/query'

interface DataGridProps {
  result?: QueryResult
}

const ROW_HEIGHT = 30
const ROW_INDEX_WIDTH = 44
const COLUMN_MIN_WIDTH = 72
const COLUMN_MAX_WIDTH = 640

export function DataGrid({
  result,
}: DataGridProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeCellRef = useRef<HTMLButtonElement>(null)
  const [selection, setSelection] = useState<GridSelection | null>(null)
  const [cellContextMenu, setCellContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [includeHeaders, setIncludeHeaders] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
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
    const widths = columns.map((column) => `${columnWidths[column.name] ?? defaultColumnWidth(column)}px`)
    return `${ROW_INDEX_WIDTH}px ${widths.join(' ')}`
  }, [columnWidths, result?.columns])
  const minGridWidth = useMemo(() => {
    const columns = result?.columns ?? []
    return ROW_INDEX_WIDTH + columns.reduce((sum, column) => sum + (columnWidths[column.name] ?? defaultColumnWidth(column)), 0)
  }, [columnWidths, result?.columns])

  useEffect(() => {
    activeCellRef.current?.focus({ preventScroll: true })
  }, [selection])

  if (!result) {
    return (
      <div className="ide-empty-state">
        <div>{t('result.empty')}</div>
      </div>
    )
  }

  if (result.columns.length === 0) {
    if (result.streaming) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {t('result.receiving')}
        </div>
      )
    }

    return (
      <div className="flex h-full items-center justify-center gap-1.5 text-xs text-success-foreground">
        <Check className="size-3.5 text-success" aria-hidden="true" />
        {statementCompletionLabel(result, t)}
      </div>
    )
  }

  return (
    <div
      className="data-grid-shell flex h-full min-h-0 min-w-0 overflow-hidden bg-surface text-xs tabular-nums"
      onKeyDownCapture={(event) => {
        if (event.key.toLowerCase() !== 'c' || (!event.metaKey && !event.ctrlKey)) return
        if (!selection || document.activeElement !== activeCellRef.current) return
        event.preventDefault()
        copyToClipboard(activeCellValue(result, selection))
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="relative" style={{ minWidth: minGridWidth }}>
          {result.truncated && (
            <div className="sticky top-0 z-30 border-b border-warning/35 bg-warning-bg px-3 py-1.5 text-warning-foreground">
              {t('result.truncated', {
                // The backend reports the total rows it streamed, while a large
                // result may retain only the bounded visual window in memory.
                count: result.displayTruncated ? result.rows.length : result.rowCount,
                maxRows: result.maxRows ? t('result.maxRowsSuffix', { count: result.maxRows }) : '',
              })}
            </div>
          )}
          <div
            className="data-grid-header sticky top-0 z-20 grid h-11 bg-grid-header text-[11px]"
            style={{
              gridTemplateColumns,
              minWidth: minGridWidth,
              top: result.truncated ? 29 : 0,
            }}
          >
            <div className="data-grid-index flex items-center justify-end border-b border-r border-grid-border/55 px-2.5 font-medium text-muted-foreground">
              #
            </div>
            {result.columns.map((column) => (
              <div key={column.name} className="data-grid-column group relative min-w-0 border-b border-r border-grid-border/55 px-3">
                <div
                  className="flex h-full min-w-0 flex-col justify-center gap-px pr-1"
                  title={columnTooltip(column, t('result.nullable'), t('result.notNullable'))}
                >
                  <span className="min-w-0 truncate text-[12px] font-semibold tracking-[-0.01em] text-foreground">{column.name}</span>
                  <span className="min-w-0 truncate font-mono text-[10px] font-medium uppercase tracking-[0.02em] text-muted-foreground">
                    {displayDataType(column.dataType)}
                  </span>
                </div>
                <ColumnResizeHandle
                  columnName={column.name}
                  currentWidth={columnWidths[column.name] ?? defaultColumnWidth(column)}
                  storageKey={storageKey}
                  onResize={(width) =>
                    setColumnWidths((current) => {
                      const next = { ...current, [column.name]: width }
                      if (storageKey) writeColumnWidths(storageKey, next)
                      return next
                    })
                  }
                />
              </div>
            ))}
          </div>

          {result.rows.length === 0 ? (
            <div className="grid h-24 place-items-center text-muted-foreground">{t('result.noRows')}</div>
          ) : (
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
                    className="data-grid-row group/row absolute left-0 grid w-full hover:bg-grid-hover"
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns,
                      minWidth: minGridWidth,
                    }}
                  >
                    <div className="data-grid-index flex items-center justify-end border-b border-r border-grid-border/55 px-2.5 text-right font-mono text-[10px] text-muted-foreground">
                      {virtualRow.index + 1}
                    </div>
                    {result.columns.map((column, columnIndex) => {
                      const rawValue = formatValue(row[columnIndex])
                      const presentation = presentCellValue(row[columnIndex], column)
                      const selected = selectionContains(selection, virtualRow.index, columnIndex)
                      const focusCell = isFocusCell(selection, virtualRow.index, columnIndex)
                      const inspectable = rawValue !== 'NULL' && (shouldOfferViewer(rawValue) || isInspectableColumn(column))
                      const alignment = cellAlignment(column)
                      return (
                        <div
                          key={`${virtualRow.index}-${column.name}`}
                          className={[
                            'data-grid-cell group relative min-w-0 border-b border-r border-grid-border/55 font-mono outline-none',
                            selected ? 'bg-grid-selected text-foreground' : '',
                            focusCell ? 'ring-1 ring-inset ring-primary/65' : '',
                          ].join(' ')}
                          title={rawValue}
                          data-grid-cell-state={focusCell ? 'focus' : selected ? 'selected' : 'normal'}
                        >
                          <div className="flex h-full min-w-0 items-center">
                            <button
                              ref={focusCell ? activeCellRef : null}
                              type="button"
                              className={`flex h-full min-w-0 flex-1 items-center gap-1 px-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/65 ${alignment}`}
                              onClick={(event) => {
                                setSelection((current) => nextCellSelection(current, virtualRow.index, columnIndex, event.shiftKey))
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                setSelection((current) => nextCellSelection(current, virtualRow.index, columnIndex, event.shiftKey))
                                setCellContextMenu({ x: event.clientX, y: event.clientY })
                              }}
                            >
                              <span
                                className={[
                                  'min-w-0 flex-1 truncate',
                                  presentation.kind === 'null' ? 'font-sans text-[11px] italic text-muted-foreground' : '',
                                  presentation.kind === 'binary' ? 'font-sans text-[10px] text-muted-foreground' : '',
                                  presentation.kind === 'boolean' ? 'font-sans text-[11px] font-medium' : '',
                                  presentation.kind === 'empty' ? 'font-sans text-muted-foreground' : '',
                                  isDateLikeColumn(column) ? 'tabular-nums' : '',
                                ].join(' ')}
                                aria-label={presentation.ariaLabel}
                              >
                                {presentation.display}
                              </span>
                            </button>
                            {inspectable && (
                              <button
                                type="button"
                                aria-label="Open value viewer"
                                className="grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-background/80 group-hover:opacity-100 focus-visible:opacity-100"
                                title="Open value viewer"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setViewerValue({
                                    title: `${column.name} · row ${virtualRow.index + 1}`,
                                    value: rawValue,
                                  })
                                }}
                              >
                                <Maximize2 className="size-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </div>
        <CellInspector
          result={result}
          selection={selection}
          includeHeaders={includeHeaders}
          inspectorOpen={inspectorOpen}
          onIncludeHeadersChange={setIncludeHeaders}
          onInspectorOpenChange={setInspectorOpen}
          t={t}
        />
      </div>
      {inspectorOpen && (
        <RowInspector
          result={result}
          selection={selection}
          onClose={() => setInspectorOpen(false)}
          onOpenValue={setViewerValue}
          t={t}
        />
      )}
      <ValueViewer value={viewerValue} onOpenChange={(open) => !open && setViewerValue(null)} />
      {cellContextMenu && selection && (
        <ContextMenu
          x={cellContextMenu.x}
          y={cellContextMenu.y}
          actions={cellContextActions(result, selection, t, {
            copy: copyToClipboard,
            openInspector: () => setInspectorOpen(true),
          })}
          onClose={() => {
            setCellContextMenu(null)
            requestAnimationFrame(() => activeCellRef.current?.focus({ preventScroll: true }))
          }}
        />
      )}
    </div>
  )
}

/**
 * Result-set metadata comes from the driver's query response, so opening this
 * view never needs a second SQL request or assumes a single source table.
 */
function statementCompletionLabel(result: QueryResult, t: ReturnType<typeof useTranslation>['t']) {
  if (result.statementKind === 'dml') return t('result.dmlSuccess', { count: result.affectedRows, elapsedMs: result.elapsedMs })
  if (result.statementKind === 'ddl') return t('result.ddlSuccess', { elapsedMs: result.elapsedMs })
  if (result.statementKind === 'commit') return t('result.commitSuccess', { elapsedMs: result.elapsedMs })
  if (result.statementKind === 'rollback') return t('result.rollbackSuccess', { elapsedMs: result.elapsedMs })
  return t('result.statementSuccess', { elapsedMs: result.elapsedMs })
}

export function ResultMetadataGrid({ result }: DataGridProps) {
  const { t } = useTranslation()

  if (!result || result.columns.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-card text-xs text-muted-foreground">
        {t('result.metadataEmpty')}
      </div>
    )
  }

  return (
    <div className="data-grid-shell flex h-full min-h-0 flex-col bg-card text-xs">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left" data-testid="result-metadata-grid">
          <thead className="sticky top-0 z-10 bg-grid-header text-[11px] text-muted-foreground">
            <tr className="data-grid-header h-11">
              <th scope="col" className="w-11 border-b border-r border-grid-border/55 px-3 text-right font-medium">#</th>
              <th scope="col" className="border-b border-r border-grid-border/55 px-3 font-semibold">{t('result.metadataName')}</th>
              <th scope="col" className="border-b border-r border-grid-border/55 px-3 font-semibold">{t('result.metadataLabel')}</th>
              <th scope="col" className="border-b border-grid-border/55 px-3 font-semibold">{t('result.metadataType')}</th>
            </tr>
          </thead>
          <tbody>
            {result.columns.map((column, index) => (
              <tr key={`${index}-${column.name}`} className="data-grid-row h-[30px] hover:bg-grid-hover">
                <td className="border-b border-r border-grid-border/55 px-3 py-1.5 text-right font-mono text-[10px] text-muted-foreground">{index + 1}</td>
                <td className="max-w-0 border-b border-r border-grid-border/55 px-3 py-1.5 font-mono font-medium" title={column.name}>
                  <span className="block truncate">{column.name}</span>
                </td>
                <td className="max-w-0 border-b border-r border-grid-border/55 px-3 py-1.5 text-muted-foreground" title={column.name}>
                  <span className="block truncate">{column.name}</span>
                </td>
                <td className="border-b border-grid-border/55 px-3 py-1.5" title={column.dataType}>
                  <span className="font-mono text-[10px] font-medium text-muted-foreground">{displayDataType(column.dataType)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-grid-footer flex h-8 shrink-0 items-center border-t border-grid-border/60 px-3 text-[11px] text-muted-foreground">
        {t('result.metadataHint', { count: result.columns.length })}
      </div>
    </div>
  )
}

function CellInspector({
  result,
  selection,
  includeHeaders,
  inspectorOpen,
  onIncludeHeadersChange,
  onInspectorOpenChange,
  t,
}: {
  result: QueryResult
  selection: GridSelection | null
  includeHeaders: boolean
  inspectorOpen: boolean
  onIncludeHeadersChange: (includeHeaders: boolean) => void
  onInspectorOpenChange: (open: boolean) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  if (!selection) {
    return (
      <div className="data-grid-footer flex h-8 shrink-0 items-center gap-2 border-t border-grid-border/60 px-3 text-[11px] text-muted-foreground">
        <Rows3 className="size-3" />
        <span className="min-w-0 flex-1 truncate">{t('result.selectCellHint')}</span>
        <Button type="button" size="xs" variant="ghost" className="h-6 shrink-0 px-1.5 text-[11px]" disabled>
          <Rows3 className="size-3" />
          {t('result.rowDetails')}
        </Button>
      </div>
    )
  }

  const range = normalizeSelection(selection, result)
  const firstColumn = result.columns[range.startColumn]
  const firstRow = result.rows[range.startRow] ?? []
  const value = formatValue(firstRow[range.startColumn])
  const valueLength = value === 'NULL' ? 0 : value.length
  const rowValue = rowClipboardValue(result, range.startRow)
  const rangeLabel =
    range.startRow === range.endRow && range.startColumn === range.endColumn
      ? `${range.startRow + 1}.${firstColumn?.name ?? range.startColumn + 1}`
      : `${range.startRow + 1}:${range.endRow + 1} · ${range.startColumn + 1}:${range.endColumn + 1}`

  return (
    <div className="data-grid-footer grid h-8 w-full min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 overflow-hidden border-t border-grid-border/60 px-2.5 text-[11px]">
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium">{rangeLabel}</span>
        <span className="ml-2 text-muted-foreground">{displayDataType(firstColumn?.dataType ?? '')}</span>
        <span className="ml-1.5 text-muted-foreground">· {t('result.characterCount', { count: valueLength })}</span>
        <span className="ml-2 font-mono text-muted-foreground">{value}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeHeaders}
            aria-label={t('result.copyHeaders')}
            onChange={(event) => onIncludeHeadersChange(event.target.checked)}
          />
          {t('result.copyHeaders')}
        </label>
        <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => copyToClipboard(value)}>
          <Copy className="size-3" />
          {t('result.cell')}
        </Button>
        <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => copyToClipboard(rowValue)}>
          <Rows3 className="size-3" />
          {t('result.copyRow')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant={inspectorOpen ? 'secondary' : 'ghost'}
          className="h-6 px-1.5 text-[11px]"
          aria-pressed={inspectorOpen}
          onClick={() => onInspectorOpenChange(!inspectorOpen)}
        >
          <Rows3 className="size-3" />
          {t('result.rowDetails')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => copyToClipboard(formatRange(result, range, includeHeaders, 'text'))}
        >
          Text
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => copyToClipboard(formatRange(result, range, includeHeaders, 'csv'))}
        >
          CSV
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => copyToClipboard(formatRange(result, range, includeHeaders, 'json'))}
        >
          JSON
        </Button>
      </div>
    </div>
  )
}

function RowInspector({
  result,
  selection,
  onClose,
  onOpenValue,
  t,
}: {
  result: QueryResult
  selection: GridSelection | null
  onClose: () => void
  onOpenValue: (value: { title: string; value: string }) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  const activeRow = selection ? clampNumber(selection.focusRow, 0, Math.max(0, result.rows.length - 1)) : null
  const activeColumn = selection ? clampNumber(selection.focusColumn, 0, Math.max(0, result.columns.length - 1)) : null
  const row = activeRow === null ? null : result.rows[activeRow] ?? null
  const rowNumber = activeRow === null ? null : activeRow + 1

  return (
    <aside className="row-inspector shrink-0" aria-label={t('result.rowDetails')}>
      <header className="row-inspector-header">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-[-0.012em]">{t('result.rowDetails')}</h2>
          {rowNumber !== null ? <p className="mt-0.5 text-[11px] text-muted-foreground">{t('result.rowDetailsSummary', { row: rowNumber, count: result.columns.length })}</p> : null}
        </div>
        <Button type="button" size="icon-xs" variant="ghost" className="shrink-0" aria-label={t('result.closeRowDetails')} title={t('result.closeRowDetails')} onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      {row ? (
        <div className="row-inspector-fields">
          {result.columns.map((column, columnIndex) => {
            const raw = formatValue(row[columnIndex])
            const presentation = presentCellValue(row[columnIndex], column)
            const expandedValue = inspectorValuePreview(raw, column)
            const canOpenViewer = raw !== 'NULL' && (shouldOfferViewer(raw) || isInspectableColumn(column) || isLongTextColumn(column))
            const active = activeColumn === columnIndex
            return (
              <section key={`${columnIndex}-${column.name}`} className={`row-inspector-field group ${active ? 'row-inspector-field--active' : ''}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold tracking-[-0.008em]" title={column.name}>{column.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.02em] text-muted-foreground">{displayDataType(column.dataType)}</div>
                  </div>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="row-inspector-copy shrink-0"
                    aria-label={t('result.copyFieldValue', { field: column.name })}
                    title={t('common.copy')}
                    onClick={() => copyToClipboard(raw)}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
                <div className={[
                  'row-inspector-value mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55]',
                  presentation.kind === 'null' ? 'italic text-muted-foreground' : '',
                  presentation.kind === 'binary' ? 'font-sans text-[10px] text-muted-foreground' : '',
                  isNumericColumn(column) || isDateLikeColumn(column) ? 'tabular-nums' : '',
                ].join(' ')}>
                  {presentation.kind === 'binary' ? presentation.display : expandedValue}
                </div>
                {canOpenViewer && (
                  <button
                    type="button"
                    className="mt-1.5 text-[11px] font-medium text-primary/85 transition-colors hover:text-primary focus-visible:rounded-sm"
                    onClick={() => onOpenValue({ title: `${column.name} · ${t('result.rowNumber', { row: rowNumber ?? 1 })}`, value: raw })}
                  >
                    {t('result.openFullValue')}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-7 text-center text-xs text-muted-foreground">
          {t('result.selectRowHint')}
        </div>
      )}
    </aside>
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
      aria-orientation="vertical"
      tabIndex={0}
      title={`Drag to resize ${columnName}`}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize opacity-0 hover:bg-primary/50 group-hover:opacity-100 focus-visible:w-1.5 focus-visible:bg-primary/70 focus-visible:opacity-100"
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
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onResize(clampWidth(currentWidth + (event.key === 'ArrowRight' ? 16 : -16)))
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
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [formatted, setFormatted] = useState(false)
  const raw = value?.value ?? ''
  const display = formatted ? formatJsonIfPossible(raw) : raw
  const lowerQuery = query.trim().toLowerCase()
  const matchCount = lowerQuery ? display.toLowerCase().split(lowerQuery).length - 1 : 0

  return (
    <Dialog open={Boolean(value)} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(70vh,44rem)] w-[calc(100vw-4rem)] max-w-[46rem] flex-col gap-0 overflow-hidden p-0 sm:w-[min(46rem,calc(100vw-4rem))] sm:max-w-[46rem]"
        overlayClassName="bg-[hsl(var(--overlay)/0.3)] backdrop-blur-none"
        showCloseButton
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-4 pr-11">
          <DialogTitle>{value?.title ?? t('result.value')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/65 px-5 py-2">
          <input
            className="ide-input h-8 min-w-0 flex-1 text-xs"
            placeholder={t('result.searchValue')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="hidden shrink-0 whitespace-nowrap text-[11px] text-muted-foreground min-[560px]:inline">{t('result.matchCount', { count: matchCount })}</span>
          <Button type="button" size="xs" variant="ghost" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => copyToClipboard(raw)}>
            <Copy className="size-3.5" />
            {t('common.copy')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={formatted ? 'secondary' : 'ghost'}
            className="h-7 shrink-0 px-2 text-[11px]"
            disabled={!isJsonLike(raw)}
            onClick={() => setFormatted((current) => !current)}
          >
            <Braces className="size-3.5" />
            JSON
          </Button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-surface p-5 font-mono text-xs leading-5">
          {display}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

function copyToClipboard(value: string) {
  if (typeof window !== 'undefined' && (isTauri() || '__TAURI_INTERNALS__' in window)) {
    void writeNativeClipboardText(value).catch(() => copyWithSelection(value))
    return
  }
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value).catch(() => copyWithSelection(value))
    return
  }
  copyWithSelection(value)
}

function copyWithSelection(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function activeCellValue(result: QueryResult, selection: GridSelection) {
  return formatValue(result.rows[selection.focusRow]?.[selection.focusColumn])
}

function cellContextActions(
  result: QueryResult,
  selection: GridSelection,
  t: ReturnType<typeof useTranslation>['t'],
  handlers: { copy: (value: string) => void; openInspector: () => void },
): ContextMenuAction[] {
  return [
    { id: 'copy-cell', label: t('result.copyCell'), icon: 'copy', onSelect: () => handlers.copy(activeCellValue(result, selection)) },
    {
      id: 'copy-row',
      label: t('result.copyRow'),
      icon: 'data',
      onSelect: () => handlers.copy(rowClipboardValue(result, selection.focusRow)),
    },
    { id: 'row-details', label: t('result.rowDetails'), icon: 'data', onSelect: handlers.openInspector },
  ]
}

function rowClipboardValue(result: QueryResult, rowIndex: number) {
  const row = result.rows[rowIndex] ?? []
  return JSON.stringify(Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])))
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

function isFocusCell(selection: GridSelection | null, rowIndex: number, columnIndex: number) {
  return Boolean(selection && selection.focusRow === rowIndex && selection.focusColumn === columnIndex)
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

type CellPresentationKind = 'value' | 'null' | 'empty' | 'boolean' | 'json' | 'binary'

interface CellPresentation {
  display: string
  kind: CellPresentationKind
  ariaLabel?: string
}

/** Presentation only: copy and the value viewer continue using the unmodified driver value. */
function presentCellValue(value: unknown, column: ColumnMeta): CellPresentation {
  if (value == null) {
    return { display: 'NULL', kind: 'null', ariaLabel: 'NULL value' }
  }

  const raw = formatValue(value)
  if (isBinaryColumn(column)) {
    return { display: '<BINARY>', kind: 'binary', ariaLabel: 'Binary value' }
  }
  if (isBooleanColumn(column)) {
    return { display: normalizeBooleanDisplay(value, raw), kind: 'boolean' }
  }
  if (isJsonColumn(column)) {
    return { display: compactJsonPreview(raw), kind: 'json' }
  }
  if (raw === '') {
    // Keep the product's existing blank rendering for empty strings; NULL remains explicit above.
    return { display: '', kind: 'empty', ariaLabel: 'Empty string' }
  }
  return { display: raw, kind: 'value' }
}

function normalizeBooleanDisplay(value: unknown, raw: string) {
  if (typeof value === 'boolean') return String(value)
  if (value === 0 || value === 1) return value === 1 ? 'true' : 'false'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 't') return 'true'
  if (normalized === 'false' || normalized === '0' || normalized === 'f') return 'false'
  return raw
}

function compactJsonPreview(value: string) {
  let compact = value
  try {
    compact = JSON.stringify(JSON.parse(value))
  } catch {
    // The driver may return JSON text that is not parseable by the browser. Keep it verbatim.
  }
  return compact.length > 96 ? `${compact.slice(0, 92)}…` : compact
}

/**
 * The grid deliberately stays single-line. The on-demand inspector is allowed
 * a useful preview, but keeps values bounded so one CLOB/JSON field cannot
 * turn a row browser into an unbounded document reader.
 */
function inspectorValuePreview(value: string, column: ColumnMeta) {
  if (value === 'NULL') return value
  const formatted = isJsonColumn(column) && value.length <= 12_000 ? formatJsonIfPossible(value) : value
  const limit = isLongTextColumn(column) || isJsonColumn(column) ? 720 : 480
  return formatted.length > limit ? `${formatted.slice(0, limit).trimEnd()}…` : formatted
}

function cellAlignment(column: ColumnMeta) {
  if (isBooleanColumn(column)) {
    return 'justify-center text-center'
  }
  if (isNumericColumn(column)) {
    return 'justify-end text-right tabular-nums'
  }
  return 'text-left'
}

function defaultColumnWidth(column: ColumnMeta) {
  if (isBooleanColumn(column)) return 96
  if (isNumericColumn(column)) return 120
  if (isDateLikeColumn(column)) return /timestamp|datetime/.test(normalizedColumnType(column)) ? 176 : 144
  if (isUuidColumn(column)) return 224
  if (isBinaryColumn(column)) return 136
  if (isJsonColumn(column)) return 240
  if (isLongTextColumn(column)) return 272
  return 160
}

function isInspectableColumn(column: ColumnMeta) {
  return isJsonColumn(column) || isBinaryColumn(column)
}

function isNumericColumn(column: ColumnMeta) {
  return /\b(?:tinyint|smallint|mediumint|bigint|int|integer|serial|numeric|decimal|float|double|real|number|money)\b/.test(normalizedColumnType(column))
}

function isBooleanColumn(column: ColumnMeta) {
  return /\b(?:boolean|bool)\b/.test(normalizedColumnType(column))
}

function isJsonColumn(column: ColumnMeta) {
  return /\bjsonb?\b/.test(normalizedColumnType(column))
}

function isBinaryColumn(column: ColumnMeta) {
  return /\b(?:blob|binary|varbinary|bytea|image|raw)\b/.test(normalizedColumnType(column))
}

function isLongTextColumn(column: ColumnMeta) {
  return /\b(?:text|clob|xml)\b/.test(normalizedColumnType(column))
}

function isDateLikeColumn(column: ColumnMeta) {
  return /\b(?:date|time|timestamp|datetime|year)\b/.test(normalizedColumnType(column))
}

function isUuidColumn(column: ColumnMeta) {
  return /\b(?:uuid|uniqueidentifier)\b/.test(normalizedColumnType(column))
}

function normalizedColumnType(column: ColumnMeta) {
  return displayDataType(column.dataType).toLowerCase()
}

function columnTooltip(column: ColumnMeta, nullable: string, notNullable: string) {
  return `${column.name}\n${column.dataType}\n${column.nullable ? nullable : notNullable}`
}

/** Keep driver-internal JDBC/MySQL names out of the primary table hierarchy. */
function displayDataType(dataType: string) {
  const normalized = dataType.trim().toUpperCase()
  const aliases: Record<string, string> = {
    MYSQL_TYPE_BIT: 'BIT',
    MYSQL_TYPE_TINY: 'TINYINT',
    MYSQL_TYPE_SHORT: 'SMALLINT',
    MYSQL_TYPE_LONG: 'INT',
    MYSQL_TYPE_LONGLONG: 'BIGINT',
    MYSQL_TYPE_INT24: 'MEDIUMINT',
    MYSQL_TYPE_FLOAT: 'FLOAT',
    MYSQL_TYPE_DOUBLE: 'DOUBLE',
    MYSQL_TYPE_NEWDECIMAL: 'DECIMAL',
    MYSQL_TYPE_DATE: 'DATE',
    MYSQL_TYPE_TIME: 'TIME',
    MYSQL_TYPE_DATETIME: 'DATETIME',
    MYSQL_TYPE_TIMESTAMP: 'TIMESTAMP',
    MYSQL_TYPE_YEAR: 'YEAR',
    MYSQL_TYPE_VAR_STRING: 'VARCHAR',
    MYSQL_TYPE_STRING: 'CHAR',
    MYSQL_TYPE_VARCHAR: 'VARCHAR',
    MYSQL_TYPE_BLOB: 'BLOB',
    MYSQL_TYPE_JSON: 'JSON',
  }
  return aliases[normalized] ?? dataType
}
