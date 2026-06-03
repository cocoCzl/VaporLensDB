import { Loader2, Play, Square } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useTaskStore } from '@/stores/taskStore'
import type { TaskInfo } from '@/types/task'

export function TaskStatusIndicator() {
  const tasks = useTaskStore((state) => state.tasks)
  const startNoop = useTaskStore((state) => state.startNoop)
  const cancel = useTaskStore((state) => state.cancel)
  const activeTask = useMemo(
    () => tasks.find((task) => ['pending', 'running', 'cancelling'].includes(task.status)),
    [tasks],
  )

  return (
    <div className="flex min-w-0 items-center gap-1">
      {activeTask ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          <span className="max-w-44 truncate" title={taskTitle(activeTask)}>
            {taskTitle(activeTask)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5"
            disabled={activeTask.status === 'cancelling'}
            title="取消后台任务"
            onClick={() => cancel(activeTask.id)}
          >
            <Square className="size-3" />
          </Button>
        </>
      ) : (
        <>
          <span title="后台任务状态">后台任务: 空闲</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5"
            title="启动 no-op 后台任务"
            onClick={() => startNoop({ title: 'No-op task', steps: 5, stepDelayMs: 180 })}
          >
            <Play className="size-3" />
          </Button>
        </>
      )}
    </div>
  )
}

function taskTitle(task: TaskInfo) {
  const total = task.progress.total
  const suffix = total ? ` ${task.progress.current}/${total}` : ''
  return `${task.title}${suffix}`
}
