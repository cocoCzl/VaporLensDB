import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { beginExecutionTargetSwitch, type ExecutionTargetSwitch, type SwitchDecision } from '@/lib/executionTargetSwitch'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function useExecutionTargetSwitch() {
  const { t } = useTranslation()
  const pending = useRef<ExecutionTargetSwitch | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const [view, setView] = useState<{ tabId: string; source: string; target: string; context: string; busy: boolean; error: boolean } | null>(null)
  const tabs = useEditorStore((state) => state.tabs)
  const tab = tabs.find((item) => item.id === view?.tabId)
  const unresolved = tab?.transactionMode === 'manual' && tab.transactionPhase !== 'idle'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; pending.current?.cancel() }
  }, [])

  function dismiss() {
    if (!pending.current?.cancel()) return
    pending.current = null
    setView(null)
  }

  async function advance(session: ExecutionTargetSwitch, labels: NonNullable<typeof view>, decision?: SwitchDecision) {
    if (inFlight.current) return
    inFlight.current = true
    setView((current) => current ? { ...current, busy: true, error: false } : null)
    try {
      const outcome = await session.advance(decision)
      if (!mounted.current) { session.cancel(); return }
      if (outcome === 'switched') {
        pending.current = null
        setView(null)
      } else {
        setView({ ...labels, busy: false, error: false })
      }
    } catch {
      if (!mounted.current) { session.cancel(); return }
      // Do not display raw driver errors or connection URLs in a confirmation.
      setView({ ...labels, busy: false, error: true })
    } finally {
      inFlight.current = false
    }
  }

  function request(tabId: string, targetId: string | null) {
    if (pending.current) return
    const session = beginExecutionTargetSwitch(tabId, targetId)
    if (!session) return
    pending.current = session
    const connections = useConnectionStore.getState().connections
    const sourceTab = useEditorStore.getState().tabs.find((item) => item.id === tabId)
    const source = connections.find((item) => item.id === session.sourceId)
    const target = connections.find((item) => item.id === targetId)
    void advance(session, {
      tabId,
      source: source?.name ?? sourceTab?.unavailableConnectionName ?? t('executionContext.none'),
      target: target?.name ?? t('executionContext.none'),
      context: [sourceTab?.database ?? source?.database, sourceTab?.schema].filter(Boolean).join(' / '),
      busy: true, error: false,
    })
  }

  const dialog = view && (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('executionContext.switchTitle')}</DialogTitle>
          <DialogDescription>{t('executionContext.switchDescription')}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 text-sm">
          <div><dt className="text-muted-foreground">{t('executionContext.execution')}</dt><dd className="break-words">{view.source}{view.context ? ` · ${view.context}` : ''}</dd></div>
          <div><dt className="text-muted-foreground">{t('executionContext.target')}</dt><dd className="break-words">{view.target}</dd></div>
          <div><dt className="text-muted-foreground">{t('editor.transactionMode')}</dt><dd>{t(`executionContext.${tab?.transactionMode === 'manual' ? tab.transactionPhase ?? 'idle' : 'auto'}`)}</dd></div>
        </dl>
        {view.error && <p role="alert" className="text-sm text-destructive">{t('executionContext.switchFailed')}</p>}
        {view.busy && <p role="status" className="text-sm text-muted-foreground">{t('executionContext.switching')}</p>}
        <DialogFooter className="flex-wrap">
          <Button variant="outline" disabled={view.busy} onClick={dismiss}>{t('executionContext.cancelSwitch')}</Button>
          {unresolved ? <>
            <Button variant="outline" disabled={view.busy} onClick={() => void advance(pending.current!, view, 'rollback')}>{t('executionContext.rollbackSwitch')}</Button>
            {tab?.transactionPhase === 'active' && <Button disabled={view.busy} onClick={() => void advance(pending.current!, view, 'commit')}>{t('executionContext.commitSwitch')}</Button>}
          </> : <Button disabled={view.busy} onClick={() => void advance(pending.current!, view)}>{t('executionContext.retrySwitch')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return { request, dialog }
}
