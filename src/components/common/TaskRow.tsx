import { useTranslation } from 'react-i18next'
import { FolderOpen, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTaskStore } from '@/stores/taskStore'
import type { TaskInfo } from '@/types/task'

function MetadataTaskProgress({ task, onCancel }: { task: TaskInfo; onCancel: () => void }) {
  const { t } = useTranslation()
  const progress = task.progress.metadata
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(task.status)
  const requested = useTaskStore((state) => state.cancellingIds.includes(task.id))
  const cancelling = !terminal && (task.status === 'cancelling' || requested)
  const status = terminal ? task.status : cancelling ? 'cancelling' : task.status

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border bg-background/70 px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium" title={progress?.connectionName}>
          {t('tasks.metadata.title')}{progress?.connectionName ? ` · ${progress.connectionName}` : ''}
        </div>
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <div>{t(`tasks.metadata.status.${status}`)}</div>
          {terminal ? (
            task.status === 'succeeded' && task.progress.metadataCapacityReached
              ? <div>{t('tasks.metadata.capacityReached')}</div>
              : null
          ) : cancelling ? (
            <div>{t('tasks.metadata.cancelWaiting')}</div>
          ) : progress ? (
            <>
              <div>{t(`tasks.metadata.stage.${progress.stage}`)}</div>
              {progress.schemaName && (
                <div className="break-all">
                  {t('tasks.metadata.schema', { name: progress.schemaName })}
                  {progress.total ? ` · ${t('tasks.metadata.schemaPosition', { current: Math.min(progress.current + 1, progress.total), total: progress.total })}` : ''}
                </div>
              )}
              {progress.objectName && (
                <div className="break-all">
                  {progress.objectTotal && progress.objectCurrent
                    ? `${t(progress.stage === 'viewColumns' ? 'tasks.metadata.viewPosition' : 'tasks.metadata.tablePosition', { current: progress.objectCurrent, total: progress.objectTotal })} · `
                    : ''}
                  {progress.objectName}
                </div>
              )}
            </>
          ) : null}
          {task.status === 'failed' && task.error && <div className="break-words text-destructive">{task.error}</div>}
        </div>
      </div>
      {!terminal && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={cancelling}
          title={t('tasks.cancel')}
          aria-label={t('tasks.cancel')}
          onClick={onCancel}
        >
          <Square className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

export default function TaskRow({ task, onCancel, onReveal, revealLabel }: { task: TaskInfo; onCancel: () => void; onReveal: () => void; revealLabel: string }) {
  if (task.kind === 'metadata-index') {
    return <MetadataTaskProgress task={task} onCancel={onCancel} />
  }
  const active = ['pending', 'running', 'cancelling'].includes(task.status)
  const total = task.progress.total
  const progress = total ? `${task.progress.current}/${total}` : task.progress.message

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border bg-background/70 px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium">{task.title}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {task.status}
          {progress ? ` · ${progress}` : ''}
          {task.error ? ` · ${task.error}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {task.status === 'succeeded' && task.outputPath && (
          <Button type="button" size="icon-xs" variant="ghost" title={revealLabel} onClick={onReveal}>
            <FolderOpen className="size-3.5" />
          </Button>
        )}
        {active && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={task.status === 'cancelling'}
            onClick={onCancel}
          >
            <Square className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

