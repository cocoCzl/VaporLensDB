import { useDriverStore } from '@/stores/driverStore'
import { create } from 'zustand'
import i18n from '@/i18n'
import { cancelTask, clearCompletedTasks, listTasks } from '@/ipc/task'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { TaskInfo } from '@/types/task'

interface TaskState {
  tasks: TaskInfo[]
  loading: boolean
  cancellingIds: string[]
  loadTasks: () => Promise<void>
  upsertTask: (task: TaskInfo) => void
  cancel: (taskId: string) => Promise<void>
  clearCompleted: () => Promise<void>
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  cancellingIds: [],
  loadTasks: async () => {
    const initialTasks = new Set(useTaskStore.getState().tasks)
    set({ loading: true })
    try {
      const tasks = await listTasks()
      set(state => {
        const incomingIds = new Set(tasks.map(task => task.id))
        const merged = tasks.map(task => mergeTask(state.tasks.find(previous => previous.id === task.id), task))
        // The list snapshot may predate an event for a newly created/updated task.
        const newerTasks = state.tasks.filter(task => !incomingIds.has(task.id) && !initialTasks.has(task))
        return { tasks: sortTasks([...merged, ...newerTasks]) }
      })
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.loadTasksFailed'))
    } finally {
      set({ loading: false })
    }
  },
  upsertTask: (task) => {
    if (task.kind.startsWith('driver.download:') && task.status === 'succeeded' && useTaskStore.getState().tasks.find(t => t.id === task.id)?.status !== 'succeeded') void useDriverStore.getState().loadDrivers(true)
    set((state) => {
      const previous = state.tasks.find((candidate) => candidate.id === task.id)
      if (mergeTask(previous, task) === previous) return state
      return { tasks: sortTasks([task, ...state.tasks.filter((candidate) => candidate.id !== task.id)]) }
    })
  },
  cancel: async (taskId) => {
    if (useTaskStore.getState().cancellingIds.includes(taskId)) return
    if (useTaskStore.getState().tasks.some((task) => task.id === taskId && task.kind === 'metadata-index')) {
      set((state) => ({ cancellingIds: [...state.cancellingIds, taskId] }))
    }
    try {
      const task = await cancelTask(taskId)
      useTaskStore.getState().upsertTask(task)
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.cancelTaskFailed'))
    } finally {
      set((state) => ({ cancellingIds: state.cancellingIds.filter((id) => id !== taskId) }))
    }
  },
  clearCompleted: async () => {
    try {
      await clearCompletedTasks()
      set((state) => ({
        tasks: state.tasks.filter((task) => ['pending', 'running', 'cancelling'].includes(task.status)),
      }))
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.clearTasksFailed'))
    }
  },
}))

function sortTasks(tasks: TaskInfo[]) {
  return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** A task id denotes one lifecycle; a terminal outcome cannot be reopened. */
function mergeTask(previous: TaskInfo | undefined, task: TaskInfo): TaskInfo {
  if (!previous) return task
  const ranks = { pending: 0, running: 1, cancelling: 2, succeeded: 3, failed: 3, cancelled: 3 }
  const oldTime = Date.parse(previous.updatedAt)
  const newTime = Date.parse(task.updatedAt)
  if (ranks[previous.status] === 3 || ranks[task.status] < ranks[previous.status]
    || newTime < oldTime
    || (task.status === previous.status && newTime === oldTime && task.progress.current < previous.progress.current)) return previous
  return task
}
