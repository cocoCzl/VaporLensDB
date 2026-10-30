import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { listCredentialCleanup, retryCredentialCleanup, type CredentialCleanupDiagnostic } from '@/ipc/diagnostics'
import { copyToClipboard } from '@/lib/clipboard'

export function CredentialCleanupDiagnostics() {
  const { t } = useTranslation()
  const [items, setItems] = useState<CredentialCleanupDiagnostic[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  async function refresh() {
    setLoading(true)
    try { setItems(await listCredentialCleanup()); setError(false) }
    catch { setError(true) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    let active = true
    void listCredentialCleanup().then(value => { if (active) setItems(value) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  async function retry(id: string) {
    setBusy(id)
    let failed = false
    try { await retryCredentialCleanup(id) }
    catch { failed = true }
    await refresh()
    if (failed) setError(true)
    setBusy(null)
  }
  return <section className="min-w-0 rounded-xl border bg-card p-4" aria-label={t('credentialCleanup.title')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium">{t('credentialCleanup.title')}</h3>
      <Button size="sm" variant="outline" disabled={loading || busy !== null} onClick={() => { void refresh() }}>{t('credentialCleanup.refresh')}</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{t('credentialCleanup.hint')}</p>
    {error && <p role="alert" className="mt-3 text-xs text-destructive">{t('credentialCleanup.retryFailed')}</p>}
    {loading && <p role="status" className="mt-3 text-xs">{t('common.loading')}</p>}
    {!loading && items.length === 0 && !error && <p className="mt-3 text-xs text-muted-foreground">{t('credentialCleanup.empty')}</p>}
    <div className="mt-3 grid min-w-0 gap-3">
      {items.map(item => {
        const details = [
          `connection UUID: ${item.connectionId}`, `status: ${item.status}`, item.updatedAt,
          item.diagnostic,
          item.credentialAccount ? `Keychain service: com.vaporlensdb.datasource-password.v1\naccount: ${item.credentialAccount}` : null,
        ].filter(Boolean).join('\n')
        const code = item.diagnostic?.match(/\(OSStatus (-?\d+)\)/)?.[1]
        const explanation = code === '-25244' ? 'ownerError' : code === '-25308' ? 'interactionError' : code === '-25293' ? 'accessError' : 'otherError'
        return <div key={item.connectionId} className="min-w-0 rounded-lg border bg-background/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{t(`credentialCleanup.${item.status}`)}</span>
            {item.status === 'pending' && <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => { void retry(item.connectionId) }}>{busy === item.connectionId ? t('common.loading') : t('credentialCleanup.retry')}</Button>}
          </div>
          <details className="mt-2 min-w-0">
            <summary className="cursor-pointer text-muted-foreground">{t('credentialCleanup.viewDetails')}</summary>
            {item.status === 'pending' && <>
              <p className="mt-3 leading-relaxed">{t(`credentialCleanup.${explanation}`)}</p>
              <p className="mt-2 leading-relaxed text-muted-foreground">{t('credentialCleanup.manual')}</p>
            </>}
            <pre tabIndex={0} className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-muted/50 p-3 text-[11px] [overflow-wrap:anywhere]">{details}</pre>
            <Button className="mt-2" size="xs" variant="outline" onClick={() => { void copyToClipboard(details) }}>{t('credentialCleanup.copy')}</Button>
          </details>
        </div>
      })}
    </div>
  </section>
}
