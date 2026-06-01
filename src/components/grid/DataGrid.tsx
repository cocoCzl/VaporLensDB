/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual intentionally exposes non-memoizable instance methods. */
import { useMemo, useRef, useState } from 'react'
import { Copy, DatabaseZap, Rows3 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import type { QueryResult } from '@/types/query'
import type { TableEditContext } from '@/stores/editorStore'

interface DataGridProps {
  result?: QueryResult
  tableContext?: TableEditContext | null
  onExecuteEditSql?: (sql: string) => void
}

const ROW_HEIGHT = 28
const ROW_INDEX_WIDTH = 56
const COLUMN_MIN_WIDTH = 180

export function DataGrid({ result, tableContext, onExecuteEditSql }: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selectedCell, setSelectedCell] = useState<{
    rowIndex: number
    columnIndex: number
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
        暂无查询结果
      </div>
    )
  }

  if (result.columns.length === 0) {
    if (result.elapsedMs === 0 && result.affectedRows === 0) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          正在接收结果
        </div>
      )
    }

    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        语句完成，影响 {result.affectedRows} 行，用时 {result.elapsedMs} ms
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-xs">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ minWidth: minGridWidth }}>
          {result.truncated && (
            <div className="sticky top-0 z-30 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
              已显示 {result.rowCount.toLocaleString()} 行，结果达到交互查询上限
              {result.maxRows ? ` ${result.maxRows.toLocaleString()} 行` : ''}。
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

                    return (
                      <button
                        key={`${virtualRow.index}-${column.name}`}
                        type="button"
                        className={[
                          'min-w-0 truncate border-b border-r px-2 py-1 text-left font-mono outline-none',
                          selected
                            ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/40'
                            : 'hover:bg-accent/50',
                        ].join(' ')}
                        title={formatted}
                        onClick={() => setSelectedCell({ rowIndex: virtualRow.index, columnIndex })}
                      >
                        {formatted}
                      </button>
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
        tableContext={tableContext}
        onExecuteEditSql={onExecuteEditSql}
      />
    </div>
  )
}

function CellInspector({
  result,
  selectedCell,
  tableContext,
  onExecuteEditSql,
}: {
  result: QueryResult
  selectedCell: { rowIndex: number; columnIndex: number } | null
  tableContext?: TableEditContext | null
  onExecuteEditSql?: (sql: string) => void
}) {
  const [editValue, setEditValue] = useState('')
  const [editingCellKey, setEditingCellKey] = useState('')

  if (!selectedCell) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        <Rows3 className="size-3.5" />
        选择一个单元格可查看完整值
      </div>
    )
  }

  const column = result.columns[selectedCell.columnIndex]
  const row = result.rows[selectedCell.rowIndex] ?? []
  const value = formatValue(row[selectedCell.columnIndex])
  const rowValue = JSON.stringify(Object.fromEntries(result.columns.map((item, index) => [item.name, row[index]])))
  const cellKey = `${selectedCell.rowIndex}:${selectedCell.columnIndex}`
  const primaryKeyColumns = tableContext?.primaryKeyColumns ?? []
  const canEdit =
    Boolean(primaryKeyColumns.length) &&
    Boolean(onExecuteEditSql) &&
    Boolean(column) &&
    !primaryKeyColumns.includes(column.name) &&
    primaryKeyColumns.every((key) =>
      result.columns.some((resultColumn) => resultColumn.name === key),
    )
  const editing = editingCellKey === cellKey

  function startEdit() {
    setEditingCellKey(cellKey)
    setEditValue(value === 'NULL' ? '' : value)
  }

  function submitEdit() {
    if (!tableContext || !column || !canEdit) {
      return
    }
    onExecuteEditSql?.(buildUpdateSql(tableContext, result, row, column.name, editValue))
    setEditingCellKey('')
  }

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-t px-2 py-1 text-xs">
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium">
          {selectedCell.rowIndex + 1}.{column?.name ?? selectedCell.columnIndex + 1}
        </span>
        {editing ? (
          <input
            className="ml-2 h-7 w-[min(420px,55vw)] rounded-md border bg-background px-2 font-mono text-[11px] outline-none focus:border-ring"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitEdit()
              }
              if (event.key === 'Escape') {
                setEditingCellKey('')
              }
            }}
          />
        ) : (
          <span className="ml-2 font-mono text-muted-foreground">{value}</span>
        )}
      </div>
      {editing ? (
        <Button type="button" size="xs" onClick={submitEdit}>
          <DatabaseZap className="size-3.5" />
          提交
        </Button>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={!canEdit}
          title={
            canEdit
              ? '编辑该单元格并生成 UPDATE'
              : '仅从表数据页打开且结果包含主键列时可编辑'
          }
          onClick={startEdit}
        >
          <DatabaseZap className="size-3.5" />
          编辑
        </Button>
      )}
      <Button type="button" size="xs" variant="ghost" onClick={() => copyToClipboard(value)}>
        <Copy className="size-3.5" />
        单元格
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => copyToClipboard(rowValue)}>
        <Rows3 className="size-3.5" />
        行
      </Button>
    </div>
  )
}

function copyToClipboard(value: string) {
  navigator.clipboard?.writeText(value)
}

function buildUpdateSql(
  context: TableEditContext,
  result: QueryResult,
  row: unknown[],
  columnName: string,
  nextValue: string,
) {
  const quote = context.driverType === 'mysql' ? '`' : '"'
  const setClause = `${quoteIdentifier(columnName, quote)} = ${sqlLiteral(nextValue)}`
  const whereClause = context.primaryKeyColumns
    .map((primaryKey) => {
      const index = result.columns.findIndex((column) => column.name === primaryKey)
      return `${quoteIdentifier(primaryKey, quote)} = ${sqlLiteral(row[index])}`
    })
    .join(' AND ')

  return `UPDATE ${quoteIdentifier(context.schema, quote)}.${quoteIdentifier(context.table, quote)}\nSET ${setClause}\nWHERE ${whereClause};`
}

function quoteIdentifier(value: string, quote: '"' | '`') {
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`
}

function sqlLiteral(value: unknown) {
  if (value == null || value === 'NULL') {
    return 'NULL'
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }
  return `'${String(value).replaceAll("'", "''")}'`
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
