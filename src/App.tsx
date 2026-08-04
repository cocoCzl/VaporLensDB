import { useEffect, useState } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { StatusBar } from './components/layout/StatusBar'
import { TabBar } from './components/layout/TabBar'
import { GlobalToolbar } from './components/layout/GlobalToolbar'
import { healthCheck } from './ipc/health'
import { NotificationBridge } from './components/common/NotificationBridge'
import { WorkspaceCommandPalette } from './components/common/WorkspaceCommandPalette'
import { useUiStore } from './stores/uiStore'
import { onTaskUpdated } from './ipc/task'
import { listen } from '@tauri-apps/api/event'
import { normalizedApplicationMenuLanguage, setApplicationMenuLanguage } from './ipc/settings'
import { setConnectionSessionPolicy } from './ipc/connection'
import { useTaskStore } from './stores/taskStore'
import { persistSqlWorkspace, useEditorStore } from './stores/editorStore'
import { useConnectionStore } from './stores/connectionStore'
import { useMetadataStore } from './stores/metadataStore'
import splashBackground from './assets/brand/splash-background.png'
import i18n from './i18n'

export default function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [showSplash, setShowSplash] = useState(true)
  const theme = useUiStore((state) => state.theme)
  const maxLiveSessions = useUiStore((state) => state.maxLiveSessions)
  const idleReclaimMinutes = useUiStore((state) => state.idleReclaimMinutes)
  const loadTasks = useTaskStore((state) => state.loadTasks)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const editorTabs = useEditorStore((state) => state.tabs)
  const activeEditorTabId = useEditorStore((state) => state.activeTabId)

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
      .finally(() => {
        window.setTimeout(() => {
          if (!cancelled) {
            setShowSplash(false)
          }
        }, 650)
      })

    return () => {
      cancelled = true
    }
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
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolvedTheme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
      document.documentElement.style.colorScheme = resolvedTheme
    }

    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    persistSqlWorkspace(editorTabs, activeEditorTabId)
  }, [editorTabs, activeEditorTabId])

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
        case 'close-tab': if (editor.activeTabId) editor.closeTab(editor.activeTabId); break
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
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      onContextMenu={(event) => {
        event.preventDefault()
      }}
    >
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <GlobalToolbar />
          <TabBar />
          <MainPanel />
        </div>
      </div>
      <StatusBar backendStatus={backendStatus} />
      <NotificationBridge />
      <WorkspaceCommandPalette />
      {showSplash && <SplashScreen />}
    </div>
  )
}

function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 text-white backdrop-blur-sm">
      <div
        className="h-[320px] w-[524px] max-w-[86vw] overflow-hidden rounded-lg bg-cover bg-center shadow-2xl ring-1 ring-black/15"
        style={{ backgroundImage: `url(${splashBackground})` }}
      />
    </div>
  )
}
