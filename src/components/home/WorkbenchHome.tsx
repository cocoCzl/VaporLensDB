import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { HomeQuickActions } from '@/components/home/HomeQuickActions'
import { HomeHeroArtwork } from '@/components/home/HomeHeroArtwork'
import { BrowserWorkspace } from '@/components/workspace/BrowserWorkspace'
import { openBrowserWorkspace } from '@/components/workspace/openBrowserWorkspace'
import { Button } from '@/components/ui/button'
import { Database, Plus } from 'lucide-react'
import { RecentConnections } from '@/components/home/RecentConnections'
import { RecentQueries } from '@/components/home/RecentQueries'
import { useConnectionStore } from '@/stores/connectionStore'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryHistoryStore } from '@/stores/queryHistoryStore'
import type { QueryHistoryEntry } from '@/types/queryHistory'

/** A compact resume-work surface, not a database dashboard. */
export function WorkbenchHome() {
  const { t } = useTranslation()
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const { connections, browsingConnectionId, recentDataSourceIds, loading: connectionsLoading, loadConnections, setActiveConnection } = useConnectionStore(useShallow((state) => ({
    connections: state.connections,
    browsingConnectionId: state.browsingConnectionId,
    recentDataSourceIds: state.recentDataSourceIds,
    loading: state.loading,
    loadConnections: state.loadConnections,
    setActiveConnection: state.setActiveConnection,
  })))
  const { entries, loading: historyLoading, loadHistory } = useQueryHistoryStore(useShallow((state) => ({
    entries: state.entries,
    loading: state.loading,
    loadHistory: state.loadHistory,
  })))
  const addTab = useEditorStore((state) => state.addTab)

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  useEffect(() => {
    void loadHistory(6)
  }, [loadHistory])

  const recentConnections = useMemo(() => recentDataSourceIds
    .map((id) => connections.find((connection) => connection.id === id))
    .filter((connection): connection is NonNullable<typeof connection> => Boolean(connection))
    .slice(0, 6), [connections, recentDataSourceIds])
  const recentQueries = entries.slice(0, 6)

  function openNewQuery() {
    const connection = connections.find((item) => item.id === browsingConnectionId)
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: connection ? `SQL · ${connection.name}` : 'SQL',
      sql: '',
      connectionId: browsingConnectionId,
    })
  }

  function openRecentQuery(entry: QueryHistoryEntry) {
    const connection = connections.find((item) => item.id === entry.connectionId)
    addTab({
      id: crypto.randomUUID(),
      kind: 'sql',
      title: `SQL · ${entry.connectionNameSnapshot}`,
      sql: entry.sql,
      connectionId: connection ? entry.connectionId : null,
      unavailableConnectionName: connection ? null : entry.connectionNameSnapshot,
    })
  }

  if (browsingConnectionId && connections.some(connection => connection.id === browsingConnectionId)) {
    return <BrowserWorkspace key={browsingConnectionId} connectionId={browsingConnectionId} context={{ kind: 'connection' }} />
  }

  return (
    <section className="ide-workspace @container/home min-h-0 min-w-0 flex-1 overflow-auto">
      <div className="home-content">
        <header className="home-welcome relative flex items-center gap-3 border-b pb-3">
          <Database className="size-6 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight text-foreground">VaporLensDB <span className="ml-2 text-xs font-normal text-muted-foreground">{t('browser.workbench')}</span></h1>
            <p className="mt-1 text-xs text-muted-foreground">{t('browser.homeDescription')}</p>
          </div>
          <HomeHeroArtwork />
        </header>

        {connections.length > 0 ? <><HomeQuickActions
          onNewQuery={openNewQuery}
          onNewConnection={() => setConnectionDialogOpen(true)}
          onOpenCommandPalette={() => window.dispatchEvent(new Event('vaporlensdb:open-command-palette'))}
        />

        <p className="mt-4 text-xs text-muted-foreground">{t('browser.selectObject')}</p>

        <div className="home-recents">
          {recentConnections.length > 0 && <RecentConnections
            connections={recentConnections}
            loading={connectionsLoading}
            activeConnectionId={browsingConnectionId}
            onSelect={(connection) => { setActiveConnection(connection.id); openBrowserWorkspace(connection.id, connection.name) }}
          />}
          {recentQueries.length > 0 && <RecentQueries entries={recentQueries} loading={historyLoading} onOpen={openRecentQuery} />}
        </div></> : <div className="mt-4 flex max-w-xl items-start gap-3 rounded border border-dashed px-4 py-4">
          <Database className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0"><h2 className="text-sm font-medium">{t('connection.empty')}</h2><p className="mb-3 mt-1 text-xs text-muted-foreground">{t('browser.emptyDescription')}</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setConnectionDialogOpen(true)}><Plus /><span>{t('home.newConnection')}</span></Button><Button size="sm" variant="outline" onClick={openNewQuery}><span>{t('home.newQuery')}</span></Button></div></div>
        </div>}
      </div>
      <ConnectionDialog open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen} hideTrigger />
    </section>
  )
}
