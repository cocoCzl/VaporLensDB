import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { normalizeAppError } from '@/ipc/client'
import { useConnectionStore } from '@/stores/connectionStore'
import { tableObjectKey, useMetadataStore } from '@/stores/metadataStore'

/** Metadata only: data preview and SQL execution remain explicit existing actions. */
export function ObjectStructurePreview({ connectionId, schema, object }: { connectionId: string | null; schema: string; object: string }) {
  const { t } = useTranslation()
  const connected = useConnectionStore(state => Boolean(connectionId && state.statuses[connectionId]?.status === 'connected'))
  const busy = useConnectionStore(state => Boolean(connectionId && state.busyConnectionIds[connectionId]))
  const epoch = useConnectionStore(state => connectionId ? state.lifecycleEpochs[connectionId] : undefined)
  const columns = useMetadataStore(state => connectionId ? state.columns[tableObjectKey(connectionId, schema, object)] : undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connectionId || !connected || busy) return
    let current = true
    void useMetadataStore.getState().loadColumns(connectionId, schema, object).then(() => {
      if (current) setError('')
    }).catch(error => {
      if (current) setError(normalizeAppError(error).message)
    })
    return () => { current = false }
  }, [connectionId, schema, object, connected, busy, epoch])

  return <section className="min-w-0" aria-label={t('workbench.structure')}>
    <h2 className="mb-2 text-xs font-semibold">{t('workbench.structure')} <span className="font-normal text-muted-foreground">{columns?.length ?? ''}</span></h2>
    {error ? <p className="break-words text-xs text-danger" role="alert">{error}</p> : columns?.length ? <div className="overflow-hidden rounded border">
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_72px] border-b bg-surface-secondary px-3 py-2 text-[11px] text-muted-foreground"><span>{t('inspector.columnName')}</span><span>{t('inspector.columnType')}</span><span>{t('inspector.columnNullable')}</span></div>
      {columns.map(column => <div key={column.name} className="grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_72px] border-b px-3 py-2 text-xs last:border-0">
        <span className="flex min-w-0 items-center gap-1.5" title={column.name}>{column.isPrimaryKey && <KeyRound className="size-3 shrink-0 text-warning" />}<span className="truncate font-mono">{column.name}</span></span>
        <span className="truncate text-muted-foreground" title={column.dataType}>{column.dataType}</span><span className="text-muted-foreground">{t(column.nullable ? 'inspector.yes' : 'inspector.no')}</span>
      </div>)}
    </div> : <p className="rounded border border-dashed px-3 py-4 text-xs text-muted-foreground" role="status">{!connected ? t('browser.connectToBrowse') : columns ? t('workbench.noColumns') : t('inspector.loadingColumns')}</p>}
  </section>
}
