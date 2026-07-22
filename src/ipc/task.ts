import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'
import type { TaskInfo } from '@/types/task'

export function listTasks() {
  return invokeCommand<TaskInfo[]>(COMMANDS.listTasks)
}

export function cancelTask(taskId: string) {
  return invokeCommand<TaskInfo>(COMMANDS.cancelTask, { taskId })
}

export function clearCompletedTasks() {
  return invokeCommand<number>(COMMANDS.clearCompletedTasks)
}

export function revealTaskOutput(taskId: string) {
  return invokeCommand<void>(COMMANDS.revealTaskOutput, { taskId })
}

export function onTaskUpdated(handler: (task: TaskInfo) => void): Promise<UnlistenFn> {
  return listen<TaskInfo>('task_updated', (event) => handler(event.payload))
}
