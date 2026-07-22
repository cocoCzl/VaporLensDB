import { create } from 'zustand'
import i18n from '@/i18n'
import { cancelTask, clearCompletedTasks, listTasks } from '@/ipc/task'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { TaskInfo } from '@/types/task'

interface TaskState {
  tasks: TaskInfo[]
  loading: boolean
  loadTasks: () => Promise<void>
  upsertTask: (task: TaskInfo) => void
  cancel: (taskId: string) => Promise<void>
  clearCompleted: () => Promise<void>
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  loadTasks: async () => {
    set({ loading: true })
    try {
      const tasks = await listTasks()
      set({ tasks: sortTasks(tasks) })
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.loadTasksFailed'))
    } finally {
      set({ loading: false })
    }
  },
  upsertTask: (task) =>
    set((state) => ({
      tasks: sortTasks([
        task,
        ...state.tasks.filter((candidate) => candidate.id !== task.id),
      ]),
    })),
  cancel: async (taskId) => {
    try {
      const task = await cancelTask(taskId)
      useTaskStore.getState().upsertTask(task)
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), i18n.t('notifications.cancelTaskFailed'))
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
