import { Database, FolderCog, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { IconTooltipButton } from '@/components/common/IconTooltipButton'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useMetadataStore } from '@/stores/metadataStore'

export function GlobalToolbar() {
  const { t } = useTranslation()
  const browsingConnectionId = useConnectionStore((state) => state.browsingConnectionId)
  const tabs = useEditorStore((state) => state.tabs)
  const addTab = useEditorStore((state) => state.addTab)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const clearMetadata = useMetadataStore((state) => state.clearConnection)

  function openManagement() {
    const existing = tabs.find((tab) => tab.kind === 'dataSources')
    if (existing) {
      setActiveTab(existing.id)
      return
    }
    addTab({ id: crypto.randomUUID(), kind: 'dataSources', title: t('connection.dataSources'), sql: '', connectionId: null })
  }

  return (
    <div className="ide-toolbar flex h-10 shrink-0 items-center gap-1 border-b px-2" role="toolbar" aria-label={t('commandPalette.workspace')}>
      <ConnectionDialog
        trigger={
          <IconTooltipButton label={t('connection.new')} variant="ghost">
            <Database className="size-3.5" />
          </IconTooltipButton>
        }
      />
      <IconTooltipButton label={t('connection.manageDataSources')} variant="ghost" onClick={openManagement}>
        <FolderCog className="size-3.5" />
      </IconTooltipButton>
      <IconTooltipButton
        label={t('explorer.refreshObjects')}
        variant="ghost"
        disabled={!browsingConnectionId}
        onClick={() => browsingConnectionId && clearMetadata(browsingConnectionId)}
      >
        <RefreshCw className="size-3.5" />
      </IconTooltipButton>
      <div className="flex-1" />
      <IconTooltipButton
        label={t('commandPalette.title')}
        variant="ghost"
        onClick={() => window.dispatchEvent(new Event('vaporlensdb:open-command-palette'))}
      >
        <Search className="size-3.5" />
      </IconTooltipButton>
    </div>
  )
}
