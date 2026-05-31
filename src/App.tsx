import { useEffect, useState } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { StatusBar } from './components/layout/StatusBar'
import { TabBar } from './components/layout/TabBar'
import { healthCheck } from './ipc/health'
import { NotificationBridge } from './components/common/NotificationBridge'
import splashBackground from './assets/brand/splash-background.png'

export default function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    let cancelled = false

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

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TabBar />
          <MainPanel />
        </div>
      </div>
      <StatusBar backendStatus={backendStatus} />
      <NotificationBridge />
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
