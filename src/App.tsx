import { useEffect, useState } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { StatusBar } from './components/layout/StatusBar'
import { TabBar } from './components/layout/TabBar'
import { healthCheck } from './ipc/health'
import { NotificationBridge } from './components/common/NotificationBridge'
import { WorkspaceCommandPalette } from './components/common/WorkspaceCommandPalette'
import { useUiStore } from './stores/uiStore'
import { onTaskUpdated } from './ipc/task'
import { normalizedApplicationMenuLanguage, setApplicationMenuLanguage } from './ipc/settings'
import { useTaskStore } from './stores/taskStore'
import splashBackground from './assets/brand/splash-background.png'
import i18n from './i18n'

export default function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [showSplash, setShowSplash] = useState(true)
  const theme = useUiStore((state) => state.theme)
  const loadTasks = useTaskStore((state) => state.loadTasks)
  const upsertTask = useTaskStore((state) => state.upsertTask)

  useEffect(() => {
    let cancelled = false

    setApplicationMenuLanguage(normalizedApplicationMenuLanguage(i18n.language)).catch(() => {
      // The app can still run in browser preview or if the native menu is unavailable.
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
  }, [])

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
