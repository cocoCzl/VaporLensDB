import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { connectionCapabilities } from '@/ipc/connection'
import { getDisconnectPreflight, type DisconnectPreflight } from '@/lib/disconnectSafety'
import { useQuery } from '@/hooks/useQuery'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useUiStore } from '@/stores/uiStore'
import type { ConnectionConfig } from '@/types/connection'

interface DisconnectPrompt {
  connection: ConnectionConfig
  preflight: Exclude<DisconnectPreflight, { kind: 'idle' }>
  supportsCancel: boolean
}

/**
 * Shared advisory UX for every user-triggered disconnect. The backend still
 * owns the final safety decision because its state can change after preflight.
 */
export function useDisconnectRequest() {
  const { t } = useTranslation()
  const tabs = useEditorStore((state) => state.tabs)
  const disconnectConnection = useConnectionStore((state) => state.disconnectConnection)
  const notify = useUiStore((state) => state.notify)
  const { cancelRunningQuery } = useQuery()
  const [prompt, setPrompt] = useState<DisconnectPrompt | null>(null)

  async function requestDisconnect(connection: ConnectionConfig) {
    const preflight = getDisconnectPreflight(useEditorStore.getState().tabs, connection.id)
    if (preflight.kind === 'idle') {
      try {
        await disconnectConnection(connection.id)
      } catch {
        // The store already reports the sanitized backend rejection, including
        // races where work began after this frontend snapshot.
      }
      return
    }

    if (preflight.kind === 'uncommittedTransaction') {
      setPrompt({ connection, preflight, supportsCancel: false })
      return
    }

    let supportsCancel = false
    try {
      supportsCancel = (await connectionCapabilities(connection.id)).supportsCancel
    } catch {
      // Be conservative: if capabilities cannot be obtained, never offer an
      // action that might promise cancellation but cannot complete it.
    }
    setPrompt({ connection, preflight, supportsCancel })
  }

  async function stopRunningQuery(tabId: string) {
    if (!prompt || prompt.preflight.kind !== 'runningQuery' || !prompt.supportsCancel) return

    const tab = useEditorStore.getState().tabs.find((candidate) => candidate.id === tabId)
    if (!tab?.runningQueryId) return
    const cancelled = await cancelRunningQuery(tab.id, prompt.connection.id, tab.runningQueryId)
    if (!cancelled) return

    setPrompt(null)
    notify({ kind: 'info', title: t('disconnectSafety.cancellationRequested') })
  }

  const activeRunningTabs = prompt?.preflight.kind === 'runningQuery'
    ? tabs.filter((tab) => prompt.preflight.tabIds.includes(tab.id) && tab.runningQueryId)
    : []

  const dialog = (
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => !open && setPrompt(null)}>
      <DialogContent className="w-full max-w-sm gap-0 overflow-hidden p-0" showCloseButton>
        {prompt?.preflight.kind === 'uncommittedTransaction' ? (
          <>
            <DialogHeader className="border-b border-border/70 px-4 py-3 pr-11">
              <DialogTitle>{t('disconnectSafety.transactionTitle')}</DialogTitle>
              <DialogDescription className="text-xs leading-5">
                {t('disconnectSafety.transactionDescription', { name: prompt.connection.name })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end border-t border-border/70 bg-surface-secondary/55 px-4 py-3">
              <Button type="button" size="sm" variant="outline" onClick={() => setPrompt(null)}>
                {t('disconnectSafety.keepConnected')}
              </Button>
            </div>
          </>
        ) : prompt?.preflight.kind === 'runningQuery' ? (
          <>
            <DialogHeader className="border-b border-border/70 px-4 py-3 pr-11">
              <DialogTitle>{t('disconnectSafety.runningQueryTitle')}</DialogTitle>
              <DialogDescription className="text-xs leading-5">
                {prompt.supportsCancel
                  ? t('disconnectSafety.runningQueryDescription', { name: prompt.connection.name })
                  : t('disconnectSafety.cancelUnsupported', { name: prompt.connection.name })}
              </DialogDescription>
            </DialogHeader>
            {activeRunningTabs.length > 0 && (
              <div className="grid gap-1.5 px-4 py-3">
                {activeRunningTabs.map((tab) => (
                  <div key={tab.id} className="flex items-center gap-2 rounded-md bg-danger-bg/70 px-2.5 py-2 text-xs text-danger-foreground">
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                    {prompt.supportsCancel && (
                      <Button type="button" size="xs" variant="secondary" onClick={() => void stopRunningQuery(tab.id)}>
                        {t('disconnectSafety.stopQuery')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end border-t border-border/70 bg-surface-secondary/55 px-4 py-3">
              <Button type="button" size="sm" variant="outline" onClick={() => setPrompt(null)}>
                {t('disconnectSafety.keepConnected')}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )

  return { requestDisconnect, disconnectDialog: dialog }
}
