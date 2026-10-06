import { useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/app-select'
import { useCsvPreview } from '@/hooks/useCsvPreview'
import { getCsvImportResult, importTableCsv, type CsvImportResult } from '@/ipc/export'
import { getColumns } from '@/ipc/metadata'
import { normalizeAppError } from '@/ipc/client'
import { cancelTask } from '@/ipc/task'
import { defaultCsvMapping, validCsvMapping, writableCsvColumns } from '@/lib/csvImport'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import type { DataTabContext } from '@/stores/editorStore'
import type { ColumnInfo } from '@/types/metadata'

export function CsvImportWorkflow({ connectionId, context }: { connectionId: string; context: DataTabContext }) {
  const { t } = useTranslation()
  const connection = useConnectionStore(state => state.connections.find(item => item.id === connectionId))
  const [path, setPath] = useState('')
  const [delimiter, setDelimiter] = useState(',')
  const [hasHeader, setHasHeader] = useState(true)
  const [emptyAsNull, setEmptyAsNull] = useState(true)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [report, setReport] = useState<CsvImportResult | null>(null)
  const request = useRef(0)
  const task = useTaskStore(state => state.tasks.find(item => item.id === taskId))
  const busy = starting || Boolean(taskId && (!task || ['pending', 'running', 'cancelling'].includes(task.status)))
  const csvPreview = useCsvPreview({
    onCompleted: preview => {
      setMapping(defaultCsvMapping(preview.headers, preview.targetColumns, hasHeader))
      setConfirmed(hasHeader)
    },
    onError: failure => setError(normalizeAppError(failure).message),
  })
  const { preview, clear, start } = csvPreview
  const targets = writableCsvColumns(columns).filter(column => preview?.targetColumns.includes(column.name))
  const validMapping = Boolean(preview && validCsvMapping(mapping, preview.headers.length, targets.map(column => column.name)))
  const selected = mapping.filter(value => value !== null)
  const duplicate = new Set(selected).size !== selected.length
  const target = [context.database, context.schema, context.object].filter(Boolean).join(' / ')

  useEffect(() => () => { request.current++ }, [])
  useEffect(() => {
    if (task?.status !== 'succeeded' || !taskId) return
    let active = true
    void getCsvImportResult(taskId).then(result => {
      if (active) {
        setReport(result)
        if (!result) setError(t('csvImport.reportUnavailable'))
      }
    }).catch(failure => { if (active) setError(normalizeAppError(failure).message) })
    return () => { active = false }
  }, [task?.status, taskId, t])

  async function refresh(nextPath = path, options = { delimiter, hasHeader, emptyAsNull }) {
    const generation = ++request.current
    clear()
    setError(null)
    setMapping([])
    setColumns([])
    setConfirmed(false)
    setReport(null)
    setTaskId(null)
    setCancelling(false)
    if (!nextPath) return
    // Metadata and parsing are independent. Import remains gated on both.
    await Promise.all([
      getColumns(connectionId, context.schema, context.object).then(value => {
        if (generation === request.current) setColumns(value)
      }).catch(failure => { if (generation === request.current) setError(normalizeAppError(failure).message) }),
      start({ connectionId, schema: context.schema, table: context.object, path: nextPath, ...options, mapping: [], previewRows: 20, sampleOnly: true }),
    ])
  }

  async function chooseFile() {
    try {
      const selectedPath = await open({ multiple: false, directory: false, filters: [{ name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] }] })
      if (typeof selectedPath !== 'string') return
      setPath(selectedPath)
      await refresh(selectedPath)
    } catch (failure) { setError(normalizeAppError(failure).message) }
  }

  async function runImport() {
    if (!preview?.canImport || preview.validRows !== preview.totalRows || !validMapping || !confirmed || busy || error || csvPreview.status !== 'idle') return
    setStarting(true)
    setReport(null)
    setError(null)
    setCancelling(false)
    try {
      const next = await importTableCsv({ connectionId, driverType: context.driverType, schema: context.schema, table: context.object,
        path: preview.path, delimiter, hasHeader, emptyAsNull, mapping })
      setTaskId(next.id)
      // A task event can beat this response. Do not replace a newer terminal event.
      if (!useTaskStore.getState().tasks.some(item => item.id === next.id)) useTaskStore.getState().upsertTask(next)
    } catch (failure) { setError(normalizeAppError(failure).message) }
    finally { setStarting(false) }
  }

  async function cancelImport() {
    if (!taskId) return
    setCancelling(true)
    try {
      const next = await cancelTask(taskId)
      const current = useTaskStore.getState().tasks.find(item => item.id === taskId)
      if (!current || ['pending', 'running', 'cancelling'].includes(current.status)) useTaskStore.getState().upsertTask(next)
    } catch (failure) { setCancelling(false); setError(normalizeAppError(failure).message) }
  }

  return <section aria-label={t('csvImport.title')} className="max-h-[60vh] shrink-0 overflow-auto border-b bg-muted/10 p-3 text-xs">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">{t('csvImport.title')}</h3><p className="mt-1 break-all text-muted-foreground">{connection?.name ?? connectionId} · {target}</p></div>
      <span className="rounded border px-2 py-1 font-mono">UTF-8</span>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs" variant="secondary" disabled={busy} onClick={() => void chooseFile()}>{t('csvImport.chooseFile')}</Button>
      <span className="font-medium">{path.split(/[/\\]/).pop()}</span>
      {path && <Button size="xs" variant="outline" disabled={busy} onClick={() => void refresh()}>{t('csvImport.preview')}</Button>}
      {csvPreview.status !== 'idle' && <Button size="xs" variant="outline" disabled={csvPreview.status === 'cancelling'} onClick={() => void csvPreview.cancel()}>{t(csvPreview.status === 'cancelling' ? 'csvImport.cancelling' : 'common.cancel')}</Button>}
    </div>
    {path && <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{path}</p>}
    <fieldset disabled={busy} className="my-3 grid gap-3 sm:grid-cols-3">
      <label className="space-y-1"><span>{t('csvImport.delimiter')}</span><AppSelect aria-label={t('csvImport.delimiter')} disabled={busy} value={delimiter} options={[[',', 'comma'], ['\t', 'tab'], [';', 'semicolon'], ['|', 'pipe']].map(([value, label]) => ({ value, label: t(`csvImport.${label}`) }))} onValueChange={value => { setDelimiter(value); void refresh(path, { delimiter: value, hasHeader, emptyAsNull }) }} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={hasHeader} onChange={event => { setHasHeader(event.target.checked); void refresh(path, { delimiter, hasHeader: event.target.checked, emptyAsNull }) }} />{t('csvImport.header')}</label>
      <label className="space-y-1"><span>{t('csvImport.emptyPolicy')}</span><AppSelect aria-label={t('csvImport.emptyPolicy')} disabled={busy} value={emptyAsNull ? 'null' : 'empty'} options={[{ value: 'empty', label: t('csvImport.preserveEmpty') }, { value: 'null', label: t('csvImport.emptyNull') }]} onValueChange={value => { setEmptyAsNull(value === 'null'); void refresh(path, { delimiter, hasHeader, emptyAsNull: value === 'null' }) }} /></label>
    </fieldset>
    <p className="mb-2 text-muted-foreground">{t('csvImport.emptyNote')}</p>
    {csvPreview.status !== 'idle' && <p role="status">{t(csvPreview.status === 'cancelling' ? 'csvImport.cancelling' : 'csvImport.previewing')}</p>}
    {error && <p role="alert" className="my-2 break-words text-destructive">{error}</p>}
    {preview && <>
      <div className="my-3 overflow-auto rounded border">
        <table className="w-full text-left"><caption className="p-2 text-left font-medium">{t('csvImport.mapping')}</caption><thead className="bg-muted/40"><tr><th className="p-2">{t('csvImport.source')}</th><th className="p-2">{t('csvImport.target')}</th></tr></thead><tbody>
          {preview.headers.map((header, index) => <tr key={index} className="border-t"><td className="p-2 font-mono">{hasHeader ? header : t('csvImport.column', { count: index + 1 })}</td><td className="p-2"><AppSelect aria-label={`${t('csvImport.target')} ${index + 1}`} disabled={busy} value={mapping[index] == null ? 'ignore' : `target:${mapping[index]}`} options={[{ value: 'ignore', label: t('csvImport.ignore') }, ...targets.map(column => ({ value: `target:${column.name}`, label: `${column.name} · ${column.dataType}` }))]} onValueChange={value => setMapping(current => current.map((item, at) => at === index ? value === 'ignore' ? null : value.slice(7) : item))} /></td></tr>)}
        </tbody></table>
      </div>
      {!hasHeader && <label className="my-2 flex items-center gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('csvImport.confirmMapping')}</label>}
      {duplicate && <p role="alert" className="text-destructive">{t('csvImport.duplicate')}</p>}
      <p className="mb-2 text-muted-foreground">{t('csvImport.optional')}</p>
      <p className="font-medium">{t(preview.hasMore ? 'csvImport.samplePrefix' : 'csvImport.sample', { count: preview.rows.length, total: preview.totalRows })}</p>
      <p className="my-1 text-muted-foreground">{t('csvImport.legend')}</p>
      <div className="max-h-48 overflow-auto rounded border"><table className="w-full text-left font-mono"><thead className="sticky top-0 bg-muted"><tr>{preview.headers.map((header, index) => <th className="p-2" key={index}>{hasHeader ? header : t('csvImport.column', { count: index + 1 })}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr className="border-t" key={index}>{row.map((value, column) => <td className="max-w-64 whitespace-pre-wrap break-all p-2" key={column}>{value === '' ? emptyAsNull ? <span className="rounded border px-1 font-sans text-muted-foreground">SQL NULL</span> : '""' : value === 'NULL' ? '"NULL"' : value}</td>)}</tr>)}</tbody></table></div>
      {preview.invalidRows.length > 0 && <details className="my-2" open><summary>{t('csvImport.parseErrors')}</summary><ul>{preview.invalidRows.slice(0, 20).map((row, index) => <li key={index}>{t('csvImport.row', { count: row.rowNumber })}: {row.message}</li>)}</ul></details>}
    </>}
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
      <Button size="xs" disabled={busy || csvPreview.status !== 'idle' || !preview?.canImport || preview.validRows !== preview.totalRows || !validMapping || !confirmed || Boolean(error)} onClick={() => void runImport()}>{t('workbench.runImport')}</Button>
      <span>{t('csvImport.destination', { target: `${context.schema}.${context.object}` })}</span>
      {busy && <><span role="status">{t(cancelling || task?.status === 'cancelling' ? 'csvImport.cancelling' : 'csvImport.importing')}</span>{taskId && <Button size="xs" variant="outline" disabled={cancelling || task?.status === 'cancelling'} onClick={() => void cancelImport()}>{t('common.cancel')}</Button>}</>}
    </div>
    {task?.status === 'cancelled' && <p role="status" className="mt-2">{t('csvImport.cancelled')}</p>}
    {task?.status === 'failed' && <p role="alert" className="mt-2 text-destructive">{task.error ?? t('csvImport.failed')}</p>}
    {report && <CsvResultReport report={report} />}
  </section>
}

export function CsvResultReport({ report }: { report: CsvImportResult }) {
  const { t } = useTranslation()
  return <div className="mt-3 rounded border p-2" role="status">
    <p className="font-medium">{t(report.failedRows === 0 ? 'csvImport.success' : report.insertedRows === 0 ? 'csvImport.failure' : 'csvImport.partial', { imported: report.insertedRows, failed: report.failedRows })}</p>
    {report.failedRows > 0 && <details open><summary className="cursor-pointer py-2">{t('csvImport.failedRows')} · {t('csvImport.detailsLimit', { count: Math.min(report.failures.length, 100), total: report.failedRows })}</summary><ul className="max-h-40 overflow-auto">{report.failures.slice(0, 100).map((row, index) => <li className="break-words py-1" key={index}>{t('csvImport.row', { count: row.rowNumber })}: {row.message}</li>)}</ul></details>}
  </div>
}
