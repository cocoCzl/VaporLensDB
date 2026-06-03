import { ThemeToggle } from '@/components/common/ThemeToggle'
import { TaskStatusIndicator } from '@/components/common/TaskStatusIndicator'

interface StatusBarProps {
  backendStatus: string
}

export function StatusBar({ backendStatus }: StatusBarProps) {
  return (
    <footer className="flex h-6 items-center justify-between border-t bg-muted/70 px-2 text-xs text-muted-foreground">
      <span title="Tauri/Rust 后端健康检查">{formatBackendStatus(backendStatus)}</span>
      <div className="flex items-center gap-1">
        <TaskStatusIndicator />
        <span className="mx-1 h-3 w-px bg-border" />
        <span>Theme</span>
        <ThemeToggle />
      </div>
    </footer>
  )
}

function formatBackendStatus(status: string) {
  if (status.startsWith('ok ')) {
    return `后端: 正常 ${status.slice(3)}`
  }

  if (status === 'checking') {
    return '后端: 检查中'
  }

  if (status === 'unavailable') {
    return '后端: 不可用'
  }

  return `后端: ${status}`
}
