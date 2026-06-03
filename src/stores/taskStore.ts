import { create } from 'zustand'
import { cancelTask, listTasks, startNoopTask } from '@/ipc/task'
import { normalizeAppError } from '@/ipc/client'
import { useUiStore } from '@/stores/uiStore'
import type { StartNoopTaskInput, TaskInfo } from '@/types/task'

interface TaskState {
  tasks: TaskInfo[]
  loading: boolean
  loadTasks: () => Promise<void>
  upsertTask: (task: TaskInfo) => void
  startNoop: (input?: StartNoopTaskInput) => Promise<void>
  cancel: (taskId: string) => Promise<void>
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
      useUiStore.getState().notifyError(normalizeAppError(error), '加载后台任务失败')
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
  startNoop: async (input) => {
    try {
      const task = await startNoopTask(input)
      useTaskStore.getState().upsertTask(task)
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), '启动后台任务失败')
    }
  },
  cancel: async (taskId) => {
    try {
      const task = await cancelTask(taskId)
      useTaskStore.getState().upsertTask(task)
    } catch (error) {
      useUiStore.getState().notifyError(normalizeAppError(error), '取消后台任务失败')
    }
  },
}))

function sortTasks(tasks: TaskInfo[]) {
  return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
