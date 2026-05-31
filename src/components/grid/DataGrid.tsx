/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual intentionally exposes non-memoizable instance methods. */
import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { QueryResult } from '@/types/query'

interface DataGridProps {
  result?: QueryResult
}

const ROW_HEIGHT = 28
const ROW_INDEX_WIDTH = 56
const COLUMN_MIN_WIDTH = 180

export function DataGrid({ result }: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
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
    <div ref={scrollRef} className="h-full overflow-auto text-xs">
      <div className="relative" style={{ minWidth: minGridWidth }}>
        {result.truncated && (
          <div className="sticky top-0 z-30 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
            已显示 {result.rowCount.toLocaleString()} 行，结果达到交互查询上限
            {result.maxRows ? ` ${result.maxRows.toLocaleString()} 行` : ''}。
          </div>
        )}
        <div
          className="sticky top-0 z-20 grid bg-muted"
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
                className="absolute left-0 grid w-full hover:bg-muted/50"
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

                  return (
                    <div
                      key={`${virtualRow.index}-${column.name}`}
                      className="min-w-0 truncate border-b border-r px-2 py-1 font-mono"
                      title={formatted}
                    >
                      {formatted}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
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
