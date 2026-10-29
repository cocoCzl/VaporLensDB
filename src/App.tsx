import './styles/globals.css'
import { useDriverStore } from './stores/driverStore'
import { SqlFileDialog } from './components/editor/SqlFileDialog'
import { dispatchSqlFileAction } from './lib/sqlFileActions'
import { useEffect, useState } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { WorkspacePanel } from './components/layout/WorkspacePanel'
import { StatusBar } from './components/layout/StatusBar'
import { TabBar } from './components/layout/TabBar'
import { AppTopBar } from './components/layout/AppTopBar'
import { healthCheck } from './ipc/health'
import { NotificationBridge } from './components/common/NotificationBridge'
import { WorkspaceCommandPalette } from './components/common/WorkspaceCommandPalette'
import { useUiStore } from './stores/uiStore'
import { onTaskUpdated } from './ipc/task'
import { listen } from '@tauri-apps/api/event'
import { normalizedApplicationMenuLanguage, setApplicationMenuLanguage } from './ipc/settings'
import { setConnectionSessionPolicy } from './ipc/connection'
import { useTaskStore } from './stores/taskStore'
import { persistSqlWorkspace, subscribeSqlWorkspacePersistence, useEditorStore } from './stores/editorStore'
import { useConnectionStore } from './stores/connectionStore'
import { useMetadataStore } from './stores/metadataStore'
import i18n from './i18n'
import { closeEditorTab } from './lib/closeEditorTab'
import { subscribeApplicationCloseRequests } from './lib/applicationCloseListener'
import { onConsoleTransactionUpdated } from './ipc/query'
import type { ConnectionStatus } from './types/connection'
import { normalizeAppError } from './ipc/client'
import { watchAppTheme } from './lib/appTheme'

export default function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const theme = useUiStore((state) => state.theme)
  const setResolvedTheme = useUiStore((state) => state.setResolvedTheme)
  const maxLiveSessions = useUiStore((state) => state.maxLiveSessions)
  const idleReclaimMinutes = useUiStore((state) => state.idleReclaimMinutes)
  const loadTasks = useTaskStore((state) => state.loadTasks)
  const upsertTask = useTaskStore((state) => state.upsertTask)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    listen<{ status: ConnectionStatus; revision: number }>('vaporlensdb:idle-reclaim-status', ({ payload }) => {
      if (cancelled) return
      void useConnectionStore.getState().synchronizeIdleReclaim(payload.status, payload.revision)
        .catch((error) => useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.loadConnectionsFailed')))
    })
      .then((dispose) => {
        if (cancelled) dispose()
        else unlisten = dispose
      })
      .catch(() => {})
    return () => { cancelled = true; unlisten?.() }
  }, [])

  useEffect(() => { void useDriverStore.getState().loadDrivers() }, [])

  useEffect(subscribeApplicationCloseRequests, [])

  useEffect(() => {
    let cancelled = false

    setApplicationMenuLanguage(normalizedApplicationMenuLanguage(i18n.language)).catch(() => {
      // The app can still run in browser preview or if the native menu is unavailable.
    })
    setConnectionSessionPolicy({ maxLiveSessions, idleReclaimMinutes }).catch(() => {
      // Browser preview does not expose native connection-session settings.
    })

    healthCheck()
      .then((health) => {
        if (!cancelled) {
          setBackendStatus(`${health.status} (${health.version})`)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendStatus('unavailable')
        }
      })

    return () => { cancelled = true }
  }, [idleReclaimMinutes, maxLiveSessions])

  useEffect(() => {
    void loadTasks()
    let unlisten: (() => void) | undefined
    let cancelled = false

    onTaskUpdated((task) => upsertTask(task))
      .then((dispose) => {
        if (cancelled) {
          dispose()
        } else {
          unlisten = dispose
        }
      })
      .catch(() => {
        // Task events are best-effort; command calls still refresh visible state.
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [loadTasks, upsertTask])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    onConsoleTransactionUpdated((transaction) => {
      useEditorStore.getState().syncConsoleTransactionState(transaction)
    })
      .then((dispose) => {
        if (cancelled) dispose()
        else unlisten = dispose
      })
      .catch(() => {
        // Browser preview does not expose native transaction events.
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  useEffect(() => watchAppTheme(theme, setResolvedTheme), [setResolvedTheme, theme])

  useEffect(() => {
    return subscribeSqlWorkspacePersistence()
  }, [])

  useEffect(() => {
    const flushWorkspace = () => {
      const editor = useEditorStore.getState()
      persistSqlWorkspace(editor.tabs, editor.activeTabId)
    }
    window.addEventListener('pagehide', flushWorkspace)
    return () => window.removeEventListener('pagehide', flushWorkspace)
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    listen<string>('vaporlensdb:workspace-command', ({ payload }) => {
      const editor = useEditorStore.getState()
      const connections = useConnectionStore.getState()
      const activeTab = editor.tabs.find((tab) => tab.id === editor.activeTabId) ?? null
      const openDataSources = () => {
        const existing = editor.tabs.find((tab) => tab.kind === 'dataSources')
        if (existing) editor.setActiveTab(existing.id)
        else editor.addTab({ id: crypto.randomUUID(), kind: 'dataSources', title: i18n.t('connection.dataSources'), sql: '', connectionId: null })
      }
      const openSettings = () => {
        const existing = editor.tabs.find((tab) => tab.kind === 'settings')
        if (existing) editor.setActiveTab(existing.id)
        else editor.addTab({ id: crypto.randomUUID(), kind: 'settings', title: i18n.t('settings.title'), sql: '', connectionId: null })
      }
      switch (payload) {
        case 'open-sql-file': dispatchSqlFileAction('open'); break
        case 'save-sql-file': dispatchSqlFileAction('save'); break
        case 'save-sql-file-as': dispatchSqlFileAction('saveAs'); break
        case 'new-sql': {
          const connectionId = activeTab?.kind === 'sql' || !activeTab?.kind
            ? activeTab?.connectionId ?? connections.browsingConnectionId
            : connections.browsingConnectionId
          const connection = connections.connections.find((item) => item.id === connectionId)
          editor.addTab({ id: crypto.randomUUID(), kind: 'sql', title: connection ? `SQL · ${connection.name}` : 'SQL', sql: '', connectionId })
          break
        }
        case 'new-connection':
        case 'manage-data-sources': openDataSources(); break
        case 'close-tab': if (editor.activeTabId) void closeEditorTab(editor.activeTabId); break
        case 'command-palette': window.dispatchEvent(new Event('vaporlensdb:open-command-palette')); break
        case 'query-history': {
          const existing = editor.tabs.find((tab) => tab.kind === 'queryHistory')
          if (existing) editor.setActiveTab(existing.id)
          else editor.addTab({ id: crypto.randomUUID(), kind: 'queryHistory', title: i18n.t('sql.history'), sql: '', connectionId: null })
          break
        }
        case 'settings': openSettings(); break
        case 'connect-browsing-data-source':
          if (connections.browsingConnectionId) void connections.connectConnection(connections.browsingConnectionId)
          break
        case 'refresh-browsing-data-source':
          if (connections.browsingConnectionId) useMetadataStore.getState().clearConnection(connections.browsingConnectionId)
          break
      }
    }).then((dispose) => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch(() => {
      // Browser preview does not expose Tauri's event bridge.
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTopBar />
      <div className="ide-app-body flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar />
          <WorkspacePanel />
        </div>
      </div>
      <StatusBar backendStatus={backendStatus} />
      <NotificationBridge />
      <SqlFileDialog />
      <WorkspaceCommandPalette />
    </div>
  )
}
