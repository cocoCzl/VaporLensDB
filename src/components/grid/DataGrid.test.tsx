import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataGrid, ResultMetadataGrid } from '@/components/grid/DataGrid'
import i18n from '@/i18n'

const nativeClipboard = vi.hoisted(() => ({
  writeText: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: nativeClipboard.writeText,
}))

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

  beforeEach(() => {
    nativeClipboard.writeText.mockClear()
  })

  afterEach(async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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

  it.each([
    [{ truncated: false, displayTruncated: false }, false, false],
    [{ truncated: true, displayTruncated: false }, true, false],
    [{ truncated: false, displayTruncated: true }, false, true],
    [{ truncated: true, displayTruncated: true }, true, false],
  ])('presents backend and renderer truncation separately %#', (flags, backendWarning, rendererWarning) => {
    render(
      <DataGrid
        result={{
          queryId: 'truncation',
          columns: [{ name: 'id', dataType: 'integer', nullable: false }],
          rows: [[1]],
          rowCount: 2,
          affectedRows: 0,
          elapsedMs: 1,
          maxRows: 1,
          ...flags,
        }}
      />,
    )

    if (backendWarning) {
      expect(screen.getByText(/query limit/i)).toBeInTheDocument()
    } else {
      expect(screen.queryByText(/query limit/i)).not.toBeInTheDocument()
    }
    if (rendererWarning) {
      expect(screen.getByText(/rows; grid cap/i)).toBeInTheDocument()
    } else {
      expect(screen.queryByText(/rows; grid cap/i)).not.toBeInTheDocument()
    }
  })

  it('renders and resizes duplicate columns independently', () => {
    window.localStorage.clear()
    render(
      <DataGrid
        result={{
          queryId: 'duplicate-columns',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'id', dataType: 'integer', nullable: false },
          ],
          rows: [[1, 2]],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect(screen.getAllByText('id')).toHaveLength(2)
    const handles = screen.getAllByRole('separator', { name: /resize id, [12]/i })
    expect(handles).toHaveLength(2)

    fireEvent.keyDown(handles[0], { key: 'ArrowRight' })
    expect(JSON.parse(window.localStorage.getItem('vaporlensdb.grid.widths.id|id')!)).toEqual({ '0': 136 })

    fireEvent.keyDown(handles[1], { key: 'ArrowRight' })
    expect(JSON.parse(window.localStorage.getItem('vaporlensdb.grid.widths.id|id')!)).toEqual({ '0': 136, '1': 136 })
  })

  it('migrates unambiguous legacy column widths and prefers position keys', () => {
    window.localStorage.setItem('vaporlensdb.grid.widths.id|name', JSON.stringify({ id: 120, name: 220 }))
    render(
      <DataGrid
        result={{
          queryId: 'legacy-widths',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'name', dataType: 'text', nullable: true },
          ],
          rows: [[1, 'Ada']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const header = document.querySelector('.data-grid-header') as HTMLElement
    expect(header.style.gridTemplateColumns).toContain('44px 120px 220px')

    window.localStorage.clear()
    window.localStorage.setItem('vaporlensdb.grid.widths.id|name', JSON.stringify({ '0': 180, id: 120, name: 220 }))
    render(
      <DataGrid
        result={{
          queryId: 'new-widths-win',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'name', dataType: 'text', nullable: true },
          ],
          rows: [[1, 'Ada']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect((document.querySelectorAll('.data-grid-header')[1] as HTMLElement).style.gridTemplateColumns).toContain('44px 180px 220px')
  })

  it('ignores ambiguous legacy widths while migrating unique names in mixed results', () => {
    window.localStorage.setItem('vaporlensdb.grid.widths.id|id|name', JSON.stringify({ id: 160, name: 200 }))
    render(
      <DataGrid
        result={{
          queryId: 'ambiguous-legacy-widths',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'name', dataType: 'text', nullable: true },
          ],
          rows: [[1, 2, 'Ada']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect((document.querySelector('.data-grid-header') as HTMLElement).style.gridTemplateColumns).toContain('44px 120px 120px 200px')
  })

  it('keeps invalid legacy widths safe and clamps valid numeric widths', () => {
    window.localStorage.setItem('vaporlensdb.grid.widths.id|name', JSON.stringify({ id: 'wide', name: 999 }))
    const first = render(
      <DataGrid
        result={{
          queryId: 'invalid-legacy-widths',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'name', dataType: 'text', nullable: true },
          ],
          rows: [[1, 'Ada']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect((document.querySelector('.data-grid-header') as HTMLElement).style.gridTemplateColumns).toContain('44px 120px 272px')
    first.unmount()

    window.localStorage.clear()
    window.localStorage.setItem('vaporlensdb.grid.widths.id|name', JSON.stringify({ id: 1, name: 999 }))
    render(
      <DataGrid
        result={{
          queryId: 'clamped-legacy-widths',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'name', dataType: 'text', nullable: true },
          ],
          rows: [[1, 'Ada']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect((document.querySelector('.data-grid-header') as HTMLElement).style.gridTemplateColumns).toContain('44px 72px 640px')
  })

  it('gives duplicate resize handles distinct accessible names', () => {
    render(
      <DataGrid
        result={{
          queryId: 'duplicate-accessibility',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'id', dataType: 'integer', nullable: false },
          ],
          rows: [[1, 2]],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    expect(screen.getByRole('separator', { name: 'resize id, 1' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'resize id, 2' })).toBeInTheDocument()
  })

  it('preserves duplicate values in row and JSON range copy', () => {
    nativeClipboard.writeText.mockResolvedValue(undefined)
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    render(
      <DataGrid
        result={{
          queryId: 'duplicate-copy',
          columns: [
            { name: 'id', dataType: 'integer', nullable: false },
            { name: 'id', dataType: 'integer', nullable: false },
          ],
          rows: [[1, 2]],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const cells = screen.getAllByTitle(/^[12]$/).map((cell) => cell.querySelector('button')!)
    fireEvent.click(cells[0])
    fireEvent.click(screen.getByRole('button', { name: /copy row/i }))
    expect(nativeClipboard.writeText).toHaveBeenLastCalledWith('[["id",1],["id",2]]')

    fireEvent.click(cells[0])
    fireEvent.click(cells[1], { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    expect(nativeClipboard.writeText).toHaveBeenLastCalledWith(`[
  [
    [
      "id",
      1
    ],
    [
      "id",
      2
    ]
  ]
]`)
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

  it.each([
    ['text', 'hello', 'hello'],
    ['number', 42, '42'],
    ['exact bigint', '9007199254740993', '9007199254740993'],
    ['exact decimal', '123.4500', '123.4500'],
    ['lossless JSON text', '{"id":9007199254740993}', '{"id":9007199254740993}'],
    ['empty string', '', ''],
    ['NULL', null, 'NULL'],
  ])('focuses and copies a %s cell with Cmd+C', (_kind, sourceValue, expectedClipboardValue) => {
    nativeClipboard.writeText.mockResolvedValue(undefined)
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    render(
      <DataGrid
        result={{
          queryId: 'copy-cell',
          columns: [{ name: 'value', dataType: 'TEXT', nullable: true }],
          rows: [[sourceValue]],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const cell = screen.getByTitle(expectedClipboardValue)
    const button = cell.querySelector('button')!
    fireEvent.click(button)
    expect(button).toHaveFocus()
    fireEvent.keyDown(button, { key: 'c', metaKey: true })

    expect(nativeClipboard.writeText).toHaveBeenCalledWith(expectedClipboardValue)
  })

  it('supports Ctrl+C for an active result cell without hijacking an input', () => {
    nativeClipboard.writeText.mockResolvedValue(undefined)
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    render(
      <>
        <DataGrid
          result={{
            queryId: 'copy-control',
            columns: [{ name: 'value', dataType: 'TEXT', nullable: true }],
            rows: [['ctrl-copy']],
            rowCount: 1,
            affectedRows: 0,
            elapsedMs: 1,
            truncated: false,
          }}
        />
        <input aria-label="outside input" defaultValue="keep this" />
      </>,
    )

    const cell = screen.getByTitle('ctrl-copy')
    const button = cell.querySelector('button')!
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'c', ctrlKey: true })
    expect(nativeClipboard.writeText).toHaveBeenCalledWith('ctrl-copy')

    nativeClipboard.writeText.mockClear()
    const input = screen.getByRole('textbox', { name: 'outside input' })
    input.focus()
    fireEvent.keyDown(input, { key: 'c', ctrlKey: true })
    expect(nativeClipboard.writeText).not.toHaveBeenCalled()
  })

  it('uses a localized application menu for result cells and reuses the cell/row actions', async () => {
    nativeClipboard.writeText.mockResolvedValue(undefined)
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    await i18n.changeLanguage('zh')
    render(
      <DataGrid
        result={{
          queryId: 'copy-context',
          columns: [{ name: 'value', dataType: 'TEXT', nullable: true }],
          rows: [['copy-runtime']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const button = screen.getByTitle('copy-runtime').querySelector('button')!
    const contextEvent = fireEvent.contextMenu(button, { clientX: 100, clientY: 100 })
    expect(contextEvent).toBe(false)
    expect(button).toHaveFocus()
    const copyCellLabel = i18n.t('result.copyCell')
    const copyRowLabel = i18n.t('result.copyRow')
    const rowDetailsLabel = i18n.t('result.rowDetails')
    expect(screen.getByRole('menuitem', { name: copyCellLabel })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: copyRowLabel })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: rowDetailsLabel })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: copyCellLabel }))
    expect(nativeClipboard.writeText).toHaveBeenCalledWith('copy-runtime')

    fireEvent.contextMenu(button, { clientX: 100, clientY: 100 })
    fireEvent.click(screen.getByRole('menuitem', { name: copyRowLabel }))
    expect(nativeClipboard.writeText).toHaveBeenCalledWith('{"value":"copy-runtime"}')

    fireEvent.contextMenu(button, { clientX: 100, clientY: 100 })
    fireEvent.click(screen.getByRole('menuitem', { name: rowDetailsLabel }))
    expect(screen.getByRole('complementary', { name: rowDetailsLabel })).toBeInTheDocument()
  })

  it('falls back to the browser copy command when the Clipboard API is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })
    render(
      <DataGrid
        result={{
          queryId: 'copy-fallback',
          columns: [{ name: 'value', dataType: 'TEXT', nullable: true }],
          rows: [['fallback-copy']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const button = screen.getByTitle('fallback-copy').querySelector('button')!
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'c', metaKey: true })

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('uses Tauri native clipboard access in the desktop runtime', () => {
    nativeClipboard.writeText.mockResolvedValue(undefined)
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    render(
      <DataGrid
        result={{
          queryId: 'copy-native',
          columns: [{ name: 'value', dataType: 'TEXT', nullable: true }],
          rows: [['native-copy']],
          rowCount: 1,
          affectedRows: 0,
          elapsedMs: 1,
          truncated: false,
        }}
      />,
    )

    const button = screen.getByTitle('native-copy').querySelector('button')!
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'c', metaKey: true })

    expect(nativeClipboard.writeText).toHaveBeenCalledWith('native-copy')
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })
})
