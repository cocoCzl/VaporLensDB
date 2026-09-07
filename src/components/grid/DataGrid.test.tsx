import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { DataGrid, ResultMetadataGrid } from '@/components/grid/DataGrid'
import i18n from '@/i18n'

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
})
