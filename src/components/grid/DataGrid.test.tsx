import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DataGrid, ResultMetadataGrid } from '@/components/grid/DataGrid'
import i18n from '@/i18n'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, size: 30, start: index * 30 })),
    getTotalSize: () => count * 30,
  }),
}))

describe('DataGrid', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders query columns and the empty result state', () => {
    render(
      <DataGrid
        result={{
          queryId: 'query-1',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'name', dataType: 'text', nullable: true },
          ],
          rows: [],
          rowCount: 0,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
          maxRows: 10_000,
        }}
      />,
    )

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('0 rows')).toBeInTheDocument()
  })

  it('renders result-set field metadata without requiring rows', () => {
    render(
      <ResultMetadataGrid
        result={{
          queryId: 'query-1',
          columns: [{ name: 'total', dataType: 'MYSQL_TYPE_LONG', nullable: true }],
          rows: [],
          rowCount: 0,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect(screen.getByTestId('result-metadata-grid')).toBeInTheDocument()
    expect(screen.getByText('Label')).toBeInTheDocument()
    expect(screen.getByText('INT')).toBeInTheDocument()
  })

  it('uses an explicit DML success summary instead of a generic completion', () => {
    render(<DataGrid result={{ queryId: 'update', columns: [], rows: [], rowCount: 0, affectedRows: 1, elapsedMs: 2, truncated: false, statementKind: 'dml' }} />)
    expect(screen.getByText(/Executed successfully.*1 rows affected.*2 ms/)).toBeInTheDocument()
  })

  it('renders a two-line column header with metadata-only details', () => {
    render(
      <DataGrid
        result={{
          queryId: 'query-2',
          columns: [
            { name: 'enabled', dataType: 'BOOLEAN', nullable: false },
            { name: 'payload', dataType: 'JSONB', nullable: true },
            { name: 'attachment', dataType: 'BLOB', nullable: true },
            { name: 'description', dataType: 'TEXT', nullable: true },
          ],
          rows: [],
          rowCount: 0,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect(screen.getByTitle(/enabled\s+BOOLEAN\s+Not nullable/)).toBeInTheDocument()
    expect(screen.getByText('BOOLEAN')).toBeInTheDocument()
    expect(screen.getByText('JSONB')).toBeInTheDocument()
  })

  it('keeps footer actions rendered for a selected long CLOB value', () => {
    const clobValue = 'A long CLOB value '.repeat(160)
    render(
      <DataGrid
        result={{
          queryId: 'query-clob',
          columns: [
            { name: 'ID', dataType: 'NUMBER', nullable: false },
            { name: 'CLOB_COL', dataType: 'CLOB', nullable: true },
          ],
          rows: [[1, clobValue]],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const clobCell = screen.getByTitle(/^A long CLOB value/)
    fireEvent.click(clobCell.querySelector('button')!)

    expect(screen.getByRole('button', { name: /row details/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy row/i })).toBeInTheDocument()
    expect(screen.getByText('Text')).toBeInTheDocument()
    expect(screen.getByText('CSV')).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
  })
})
