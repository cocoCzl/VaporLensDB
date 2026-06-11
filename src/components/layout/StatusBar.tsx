import { useTranslation } from 'react-i18next'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { TaskStatusIndicator } from '@/components/common/TaskStatusIndicator'

interface StatusBarProps {
  backendStatus: string
}

export function StatusBar({ backendStatus }: StatusBarProps) {
  const { t } = useTranslation()

  return (
    <footer className="flex h-6 items-center justify-between border-t bg-muted/70 px-2 text-xs text-muted-foreground">
      <span title={t('status.backendHealthTitle')}>{formatBackendStatus(backendStatus, t)}</span>
      <div className="flex items-center gap-1">
        <TaskStatusIndicator />
        <span className="mx-1 h-3 w-px bg-border" />
        <span>{t('settings.theme.label')}</span>
        <ThemeToggle />
      </div>
    </footer>
  )
}

function formatBackendStatus(status: string, t: ReturnType<typeof useTranslation>['t']) {
  if (status.startsWith('ok ')) {
    return t('status.backendOk', { version: status.slice(3) })
  }

  if (status === 'checking') {
    return t('status.backendChecking')
  }

  if (status === 'unavailable') {
    return t('status.backendUnavailable')
  }

  return t('status.backendOther', { status })
}
