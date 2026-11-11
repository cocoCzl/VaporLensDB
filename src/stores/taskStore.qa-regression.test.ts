import { beforeEach, expect, it } from 'vitest'
import { useTaskStore } from './taskStore'
import type { TaskInfo } from '@/types/task'

beforeEach(() => useTaskStore.setState({ tasks: [] }))

it('retains completed CSV status when the initial pending IPC response arrives late', () => {
  const completed: TaskInfo = {
    id: 'qa-csv', kind: 'export.csv.result', title: 'QA export', status: 'succeeded',
    progress: { current: 2, total: 2 }, logs: [],
    createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:01Z',
    finishedAt: '2026-11-09T08:00:01Z',
  }
  useTaskStore.getState().upsertTask(completed)
  useTaskStore.getState().upsertTask({ ...completed, status: 'pending', progress: { current: 0, total: 2 }, updatedAt: completed.createdAt, finishedAt: null })
  expect(useTaskStore.getState().tasks[0].status).toBe('succeeded')
  expect(useTaskStore.getState().tasks[0].progress.current).toBe(2)
})

it.each(['succeeded', 'failed', 'cancelled'] as const)('keeps %s terminal against late progress and other tasks', (status) => {
  const terminal: TaskInfo = { id: 'old', kind: 'export.csv.query', title: 'QA', status, progress: { current: 2, total: 2 }, logs: [], createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:01Z', finishedAt: '2026-11-09T08:00:01Z' }
  useTaskStore.getState().upsertTask(terminal)
  for (const lateStatus of ['pending', 'running', 'cancelling', 'failed'] as const) useTaskStore.getState().upsertTask({ ...terminal, status: lateStatus, updatedAt: '2026-11-09T08:00:02Z', progress: { current: 0 } })
  useTaskStore.getState().upsertTask({ ...terminal, id: 'new', status: 'pending' })
  expect(useTaskStore.getState().tasks.find(t => t.id === 'old')).toEqual(terminal)
  expect(useTaskStore.getState().tasks.find(t => t.id === 'new')?.status).toBe('pending')
})

it('does not regress cancelling/running or progress at an equal timestamp', () => {
  const running: TaskInfo = { id: 'race', kind: 'export.csv.result', title: 'QA', status: 'running', progress: { current: 10, total: 20 }, logs: [], createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:01Z' }
  useTaskStore.getState().upsertTask(running)
  useTaskStore.getState().upsertTask({ ...running, progress: { current: 2, total: 20 } })
  expect(useTaskStore.getState().tasks[0].progress.current).toBe(10)
  useTaskStore.getState().upsertTask({ ...running, status: 'cancelling' })
  useTaskStore.getState().upsertTask({ ...running, updatedAt: '2026-11-09T08:00:02Z' })
  expect(useTaskStore.getState().tasks[0].status).toBe('cancelling')
})

import { vi } from 'vitest'
import { listTasks } from '@/ipc/task'
vi.mock('@/ipc/task', () => ({ listTasks: vi.fn(), cancelTask: vi.fn(), clearCompletedTasks: vi.fn() }))
it('merges a late list response without overwriting a terminal event', async () => {
  const old: TaskInfo = { id: 'list-race', kind: 'export.csv.result', title: 'QA', status: 'pending', progress: { current: 0 }, logs: [], createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:00Z' }
  let resolve!: (tasks: TaskInfo[]) => void
  vi.mocked(listTasks).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const pending = useTaskStore.getState().loadTasks()
  useTaskStore.getState().upsertTask({ ...old, status: 'failed', updatedAt: '2026-11-09T08:00:01Z' })
  resolve([old]); await pending
  expect(useTaskStore.getState().tasks[0].status).toBe('failed')
})

it('retains a new task created after an older list request started', async () => {
  let resolve!: (tasks: TaskInfo[]) => void
  vi.mocked(listTasks).mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const pending = useTaskStore.getState().loadTasks()
  const task: TaskInfo = { id: 'new-after-list', kind: 'export.csv.result', title: 'QA', status: 'succeeded', progress: { current: 2, total: 2 }, logs: [], createdAt: '2026-11-09T08:00:01Z', updatedAt: '2026-11-09T08:00:02Z' }
  useTaskStore.getState().upsertTask(task)
  resolve([]); await pending
  expect(useTaskStore.getState().tasks).toEqual([task])
})
