import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ObjectInspectorPanel } from './ObjectInspectorPanel'
import { useObjectInspectorStore } from '@/stores/objectInspectorStore'
import { useUiStore } from '@/stores/uiStore'
import i18n from '@/i18n'
import type { ColumnInfo } from '@/types/metadata'

const ddl = "CREATE TABLE private_fixture (secret text DEFAULT 'private literal');"

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  useObjectInspectorStore.setState({ selected: {
    connectionId: 'qa', schema: 'public', table: 'fixture', kind: 'table',
    columns: [], indexes: [], foreignKeys: [], ddl, loading: false,
  } })
})

it('reports one safe failure when browser clipboard and fallback are unavailable', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
  const notify = vi.spyOn(useUiStore.getState(), 'notify')
  render(<ObjectInspectorPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
  expect(JSON.stringify(notify.mock.calls)).not.toContain(ddl)
})

it('copies through the primary clipboard quietly', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const fallback = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback })
  const notify = vi.spyOn(useUiStore.getState(), 'notify')
  render(<ObjectInspectorPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(ddl))
  expect(fallback).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})

it('recovers primary rejection with the selection fallback and restores focus', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: vi.fn().mockRejectedValue(new Error(ddl)),
  } })
  const fallback = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { configurable: true, value: fallback })
  const notify = vi.spyOn(useUiStore.getState(), 'notify')
  render(<ObjectInspectorPanel />)
  const button = screen.getByRole('button', { name: 'Copy' })
  button.focus()
  fireEvent.click(button)
  await waitFor(() => expect(fallback).toHaveBeenCalledWith('copy'))
  expect(notify).not.toHaveBeenCalled()
  expect(button).toHaveFocus()
  expect(document.querySelector('textarea')).toBeNull()
})

it('reports one localized safe error after both failures and allows retry', async () => {
  await i18n.changeLanguage('zh')
  const writeText = vi.fn().mockRejectedValueOnce(new Error(ddl)).mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => { throw new Error(ddl) }) })
  const notify = vi.spyOn(useUiStore.getState(), 'notify')
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
  render(<ObjectInspectorPanel />)
  const button = screen.getByRole('button', { name: i18n.t('common.copy') })
  fireEvent.click(button)
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
  expect(notify).toHaveBeenCalledWith({ kind: 'error', title: i18n.t('notifications.copyFailed'), message: i18n.t('inspector.copyDdlFailed') })
  fireEvent.click(button)
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
  expect(notify).toHaveBeenCalledTimes(1)
  expect(JSON.stringify([notify.mock.calls, ...logs.map(log => log.mock.calls)])).not.toContain('private')
  expect(document.querySelector('textarea')).toBeNull()
})

function showColumn(properties: Partial<ColumnInfo>) {
  const selected = useObjectInspectorStore.getState().selected!
  useObjectInspectorStore.setState({ selected: { ...selected, columns: [{
    table: 'fixture', name: 'sample', ordinalPosition: 1, dataType: 'integer',
    nullable: true, isPrimaryKey: false, isGenerated: false, isIdentity: false,
    isAutoIncrement: false, ...properties,
  }] } })
  return render(<ObjectInspectorPanel />)
}

it.each([
  ['PostgreSQL-like', { isGenerated: true, isIdentity: true, isAutoIncrement: true, defaultValue: "nextval('fixture_seq')" }, ['Generated', 'Identity', 'Auto Increment']],
  ['MySQL-like', { isAutoIncrement: true, defaultValue: '0' }, ['Auto Increment']],
  ['SQLite-like', { isGenerated: true }, ['Generated']],
  ['Oracle virtual/JDBC-like', { isGenerated: true }, ['Generated']],
] as const)('shows reported %s metadata without inventing expressions', (_vendor, column, labels) => {
  showColumn(column)
  for (const label of labels) expect(screen.getByText(`${label}: YES`)).toBeInTheDocument()
  for (const label of ['Generated', 'Identity', 'Auto Increment']) {
    expect(screen.queryByText(`${label}: NO`)).not.toBeInTheDocument()
  }
  if ('defaultValue' in column) expect(screen.getByTitle(column.defaultValue)).toHaveTextContent(column.defaultValue)
  expect(screen.getByTitle(/Identity and auto increment/)).toBeInTheDocument()
})

it.each([
  ['JDBC/Oracle/MSSQL missing flags collapsed to false', { isGenerated: false, isIdentity: false, isAutoIncrement: false, defaultValue: null }],
  ['missing optional metadata', { isGenerated: undefined, isIdentity: undefined, isAutoIncrement: undefined, defaultValue: undefined }],
])('does not turn %s into negative generation claims', (_case, column) => {
  const { container } = showColumn(column)
  expect(screen.queryByText(/^(Generated|Identity|Auto Increment):/)).not.toBeInTheDocument()
  expect(screen.getByText(/absence does not mean No/)).toBeInTheDocument()
  expect(container.textContent).not.toMatch(/undefined|null/)
  expect(screen.queryByText('Default:')).not.toBeInTheDocument()
})

it('bounds defaults visually while retaining the exact unparsed full value', () => {
  const defaultValue = "'" + '<literal>  '.repeat(80) + "'::text"
  showColumn({ defaultValue, isPrimaryKey: true })
  const value = screen.getByTitle(defaultValue, { normalizer: value => value })
  expect(value.textContent).toBe(defaultValue)
  expect(value).toHaveClass('truncate')
  expect(screen.getByLabelText('Primary key')).toBeInTheDocument()
})

it('preserves empty defaults and PK/FK/index/DDL rendering', () => {
  const selected = useObjectInspectorStore.getState().selected!
  useObjectInspectorStore.setState({ selected: { ...selected,
    indexes: [{ table: 'fixture', name: 'idx_fixture', columns: ['sample'], unique: true }],
    foreignKeys: [{ table: 'fixture', name: 'fk_fixture', columns: ['sample'], referencedTable: 'parent', referencedColumns: ['id'] }],
  } })
  showColumn({ defaultValue: '', isPrimaryKey: true })
  expect(screen.getByText('Default:')).toBeInTheDocument()
  expect(screen.getByText('idx_fixture')).toBeInTheDocument()
  expect(screen.getByText('fk_fixture')).toBeInTheDocument()
  expect(screen.getByText('sample -> parent(id)')).toBeInTheDocument()
  expect(screen.getByText(ddl)).toBeInTheDocument()
})

it('preserves loading and error presentation', () => {
  const selected = useObjectInspectorStore.getState().selected!
  useObjectInspectorStore.setState({ selected: { ...selected, loading: true, ddl: null, error: 'Metadata unavailable' } })
  render(<ObjectInspectorPanel />)
  expect(screen.getByText('Loading columns')).toBeInTheDocument()
  expect(screen.getByText('Loading DDL')).toBeInTheDocument()
  expect(screen.getByText('Metadata unavailable')).toBeInTheDocument()
})
