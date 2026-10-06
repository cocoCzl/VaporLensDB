import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { CsvImportWorkflow, CsvResultReport } from './CsvImportWorkflow'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import type { DataTabContext } from '@/stores/editorStore'
import type { TaskInfo } from '@/types/task'
import type { ColumnInfo } from '@/types/metadata'
import { defaultCsvMapping, validCsvMapping, writableCsvColumns } from '@/lib/csvImport'

const mocks = vi.hoisted(() => ({ open: vi.fn(), preview: vi.fn(), import: vi.fn(), columns: vi.fn(), cancel: vi.fn(), report: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('@/ipc/export', () => ({ previewTableCsvImport: mocks.preview, importTableCsv: mocks.import, getCsvImportResult: mocks.report }))
vi.mock('@/ipc/metadata', () => ({ getColumns: mocks.columns }))
vi.mock('@/ipc/task', () => ({ cancelTask: mocks.cancel }))
vi.mock('@/components/ui/app-select', () => ({ AppSelect: ({ options, onValueChange, ...props }: { options: { value: string; label: string }[]; onValueChange: (value: string) => void }) => <select {...props} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }))

const context: DataTabContext = { database: 'catalog', schema: 'main', object: 'items', objectKind: 'table', driverType: 'sqlite', limit: 100, offset: 0, primaryKeyColumns: [] }
const task = { id: 'csv-task', status: 'running', kind: 'import.csv.table', title: 'Import CSV', createdAt: '', updatedAt: '', logs: [], progress: { current: 0 } } satisfies TaskInfo
const columns = [
  { name: 'id', dataType: 'INTEGER' }, { name: 'note', dataType: 'TEXT' },
  { name: 'optional', dataType: 'TEXT', nullable: false, defaultValue: 'default' },
  { name: 'generated', isGenerated: true }, { name: 'identity', isIdentity: true }, { name: 'auto', isAutoIncrement: true },
].map((column, ordinalPosition): ColumnInfo => ({ table: 'items', ordinalPosition, dataType: 'TEXT', nullable: true, isPrimaryKey: false, isGenerated: false, isIdentity: false, isAutoIncrement: false, ...column }))
const parsed = { path: '/chosen/data.csv', headers: ['id', 'note', 'extra'], targetColumns: ['id', 'note', 'optional'], rows: [['1', '', 'NULL']], totalRows: 3, validRows: 3, invalidRows: [], canImport: true, cancelled: false }

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useTaskStore.setState({ tasks: [] })
  useConnectionStore.setState({ connections: [{ id: 'source', name: 'Production fixture', driverType: 'sqlite' }] })
  mocks.open.mockResolvedValue('/chosen/data.csv')
  mocks.preview.mockResolvedValue(parsed)
  mocks.columns.mockResolvedValue(columns)
  mocks.import.mockResolvedValue(task)
  mocks.cancel.mockResolvedValue({ ...task, status: 'cancelled' })
})
async function choose() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose CSV File…' }))
  await screen.findByText('Column mapping')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run import' })).toBeEnabled())
}

describe('CSV import workflow', () => {
  it('maps exact names, excludes structured non-writable columns, and permits omitted optional targets', () => {
    const targets = writableCsvColumns(columns).map(column => column.name)
    expect(targets).toEqual(['id', 'note', 'optional'])
    expect(defaultCsvMapping(['ID', 'note', 'extra'], targets, true)).toEqual([null, 'note', null])
    expect(defaultCsvMapping(['Column 1', 'Column 2'], targets, false)).toEqual(['id', 'note'])
    expect(validCsvMapping(['id', null, 'note'], 3, targets)).toBe(true)
    expect(validCsvMapping(['id', 'id'], 2, targets)).toBe(false)
    expect(validCsvMapping(['generated'], 1, targets)).toBe(false)
  })

  it('chooses a file and sends exactly the preview options and explicit mapping to import', async () => {
    render(<CsvImportWorkflow connectionId="source" context={context} />)
    await choose()
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ directory: false, multiple: false }))
    expect(screen.getByText('Production fixture · catalog / main / items')).toBeVisible()
    expect(screen.getByText('/chosen/data.csv')).toBeVisible()
    expect(screen.getByText('SQL NULL')).toBeVisible()
    expect(screen.getByText('"NULL"')).toBeVisible()
    expect(screen.getByLabelText('Target column 3')).toHaveValue('ignore')
    expect(screen.queryByRole('option', { name: /generated/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Empty fields'), { target: { value: 'empty' } })
    await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ emptyAsNull: false, sampleOnly: true })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run import' })).toBeEnabled())
    expect(screen.getByText('""')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Run import' }))
    await waitFor(() => expect(mocks.import).toHaveBeenCalledWith({ connectionId: 'source', driverType: 'sqlite', schema: 'main', table: 'items', path: '/chosen/data.csv', delimiter: ',', hasHeader: true, emptyAsNull: false, mapping: ['id', 'note', null] }))
    expect(screen.getByRole('button', { name: 'Run import' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByText(/Cancelled. Rollback was requested/)
    expect(mocks.cancel).toHaveBeenCalledWith('csv-task')
  })

  it('rejects duplicate targets and resets mapping on delimiter/header/file changes', async () => {
    render(<CsvImportWorkflow connectionId="source" context={context} />)
    await choose()
    fireEvent.change(screen.getByLabelText('Target column 2'), { target: { value: 'target:id' } })
    expect(screen.getByRole('button', { name: 'Run import' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Two source columns')
    for (const delimiter of ['\t', ';', '|']) {
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: delimiter } })
      await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ delimiter })))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Run import' })).toBeEnabled())
      expect(screen.getByLabelText('Target column 2')).toHaveValue('target:note')
    }
    mocks.preview.mockResolvedValue({ ...parsed, headers: ['Column 1', 'Column 2', 'Column 3'] })
    fireEvent.click(screen.getByLabelText('First row is header'))
    await waitFor(() => expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ hasHeader: false })))
    expect(screen.getByRole('button', { name: 'Run import' })).toBeDisabled()
    await waitFor(() => expect(screen.getByLabelText('Target column 3')).toHaveValue('target:optional'))
    fireEvent.click(screen.getByLabelText('I have checked the column order and mapping.'))
    expect(screen.getByRole('button', { name: 'Run import' })).toBeEnabled()
    await chooseAgain()
    expect(screen.getByRole('button', { name: 'Run import' })).toBeDisabled()
    expect(mocks.preview).toHaveBeenCalledTimes(6)
  })

  it('allows import after bounded preview without claiming a total row count', async () => {
    mocks.preview.mockResolvedValueOnce({ ...parsed, hasMore: true })
    render(<CsvImportWorkflow connectionId="source" context={context} />)
    await choose()
    expect(screen.getByText(/Total row count is unknown/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run import' })).toBeEnabled()
  })

  it('shows preview errors inline and prevents import after an unsuccessful reparse', async () => {
    render(<CsvImportWorkflow connectionId="source" context={context} />)
    await choose()
    mocks.preview.mockRejectedValueOnce({ code: 'SERIALIZATION_ERROR', message: 'CSV is not valid UTF-8' })
    await chooseAgain()
    expect(await screen.findByRole('alert')).toHaveTextContent('CSV is not valid UTF-8')
    expect(screen.getByRole('button', { name: 'Run import' })).toBeDisabled()
    expect(screen.queryByText('Column mapping')).not.toBeInTheDocument()
    expect(mocks.import).not.toHaveBeenCalled()
  })

  it('retrieves the bounded report after the task completes, then clears it on reselection', async () => {
    mocks.report.mockResolvedValue({ insertedRows: 2, failedRows: 1, failures: [{ rowNumber: 3, message: 'constraint failed', values: [] }] })
    render(<CsvImportWorkflow connectionId="source" context={context} />)
    await choose()
    fireEvent.click(screen.getByRole('button', { name: 'Run import' }))
    await waitFor(() => expect(mocks.import).toHaveBeenCalledOnce())
    act(() => useTaskStore.getState().upsertTask({ ...task, status: 'succeeded' }))
    expect(await screen.findByText('2 imported · 1 failed')).toBeVisible()
    expect(screen.getByText('Row 3: constraint failed')).toBeVisible()
    await chooseAgain()
    expect(screen.queryByText('2 imported · 1 failed')).not.toBeInTheDocument()
  })
})
async function chooseAgain() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose CSV File…' })) })
}

describe('CSV result facts', () => {
  it.each([[3, 0, '3 rows imported'], [2, 1, '2 imported · 1 failed'], [0, 2, '0 imported · 2 failed']])('shows %s imported / %s failed', (insertedRows, failedRows, text) => {
    render(<CsvResultReport report={{ insertedRows: Number(insertedRows), failedRows: Number(failedRows), failures: [] }} />)
    expect(screen.getByText(text)).toBeVisible()
  })
  it('bounds failure rendering and never renders row values', () => {
    render(<CsvResultReport report={{ insertedRows: 0, failedRows: 5000, failures: Array.from({ length: 5000 }, (_, i) => ({ rowNumber: i + 2, message: 'sanitized', values: ['private value'] })) }} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(100)
    expect(screen.getByText(/Showing 100 of 5000 failures/)).toBeVisible()
    expect(screen.queryByText('private value')).not.toBeInTheDocument()
  })
})
