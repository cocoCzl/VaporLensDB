import { ConnectionList } from '@/components/connection/ConnectionList'
import { DatabaseTree } from '@/components/explorer/DatabaseTree'

export function Sidebar() {
  return (
    <aside className="flex w-80 flex-col border-r bg-background">
      <ConnectionList />
      <DatabaseTree />
    </aside>
  )
}
