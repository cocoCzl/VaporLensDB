import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import { HomeQuickActions } from '@/components/home/HomeQuickActions'
import { HomeHeroArtwork } from '@/components/home/HomeHeroArtwork'
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

  return (
    <section className="ide-workspace min-h-0 flex-1 overflow-auto">
      <div className="mr-auto w-full max-w-[1360px] px-7 py-5 min-[1280px]:px-10 min-[1600px]:px-11">
        <header className="relative mb-5 min-h-32 max-w-[1360px] overflow-hidden min-[1000px]:pr-[23rem]">
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/85">VaporLensDB</div>
          <h1 className="text-[36px] font-bold leading-[1.12] tracking-[-0.045em] text-foreground">{t('home.welcomeTitle')}</h1>
          <p className="mt-3 text-[15px] leading-6 text-muted-foreground">{t('home.welcomeDescription')}</p>
          <HomeHeroArtwork />
        </header>

        <HomeQuickActions
          onNewQuery={openNewQuery}
          onNewConnection={() => setConnectionDialogOpen(true)}
          onOpenCommandPalette={() => window.dispatchEvent(new Event('vaporlensdb:open-command-palette'))}
        />

        <div className="mt-8 grid gap-4 min-[900px]:grid-cols-2">
          <RecentConnections
            connections={recentConnections}
            loading={connectionsLoading}
            activeConnectionId={browsingConnectionId}
            onSelect={(connection) => setActiveConnection(connection.id)}
          />
          <RecentQueries entries={recentQueries} loading={historyLoading} onOpen={openRecentQuery} />
        </div>
      </div>
      <ConnectionDialog open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen} hideTrigger />
    </section>
  )
}
