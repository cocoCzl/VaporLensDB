import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchHome } from '@/components/home/WorkbenchHome'
import { ModuleBoundary } from '@/components/common/ModuleBoundary'
import { useEditorStore } from '@/stores/editorStore'
import { rememberDraftSelection } from '@/lib/editorDraftHandoff'

type Panel = typeof import('./MainPanel').MainPanel

export function WorkspacePanel() {
  const activeTabId = useEditorStore(state => state.activeTabId)
  const [opened, setOpened] = useState(Boolean(activeTabId))
  if (activeTabId && !opened) setOpened(true)
  // Once loaded, keep execution hooks mounted through tab switches and Home.
  if (!opened && !activeTabId) return <WorkbenchHome />
  return <ModuleBoundary><WorkspaceLoader /></ModuleBoundary>
}

function WorkspaceLoader() {
  const { t } = useTranslation()
  const [Panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [composing, setComposing] = useState(false)
  const tab = useEditorStore(state => state.tabs.find(tab => tab.id === state.activeTabId))
  useEffect(() => {
    let disposed = false
    void import('./MainPanel').then(module => { if (!disposed) setPanel(() => module.MainPanel) }, failure => { if (!disposed) setError(failure) })
    return () => { disposed = true }
  }, [])
  if (error) throw error
  if (Panel && !composing) return <Panel />
  if (tab && (!tab.kind || tab.kind === 'sql')) return <WorkspaceDraft key={tab.id} tabId={tab.id} value={tab.sql} readOnly={Boolean(tab.fileBusy || tab.closing)} onComposing={setComposing} />
  return <section className="ide-workspace flex-1 p-5" role="status">{t('common.loading')}</section>
}

function WorkspaceDraft({ tabId, value, readOnly, onComposing }: { tabId: string; value: string; readOnly: boolean; onComposing: (value: boolean) => void }) {
  const { t } = useTranslation()
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current
    element?.focus()
    return () => {
      if (element) rememberDraftSelection({ tabId, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, focused: document.activeElement === element })
      onComposing(false)
    }
  }, [tabId, onComposing])
  return <section className="ide-workspace relative flex min-h-0 flex-1 flex-col">
    <textarea ref={input} aria-label={t('editor.inputLabel')} className="min-h-0 flex-1 resize-none bg-card p-3 font-mono text-[13px] text-foreground outline-none" value={value} readOnly={readOnly} spellCheck={false}
      onChange={event => useEditorStore.getState().updateTabSql(tabId, event.currentTarget.value)}
      onCompositionStart={() => onComposing(true)}
      onCompositionEnd={event => { useEditorStore.getState().updateTabSql(tabId, event.currentTarget.value); onComposing(false) }} />
    <span role="status" className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-muted-foreground">{t('workbench.loadingSqlEditor')}</span>
  </section>
}
