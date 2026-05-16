import { Sidebar } from './components/layout/Sidebar'
import { MainPanel } from './components/layout/MainPanel'
import { StatusBar } from './components/layout/StatusBar'
import { TabBar } from './components/layout/TabBar'

export default function App() {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TabBar />
          <MainPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}