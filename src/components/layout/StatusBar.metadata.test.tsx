import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TaskRow from '@/components/common/TaskRow'
import { useTaskStore } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import i18n from '@/i18n'
import type { TaskInfo } from '@/types/task'

const ipc = vi.hoisted(() => ({ cancelTask: vi.fn(), listTasks: vi.fn(), clearCompletedTasks: vi.fn(), revealTaskOutput: vi.fn() }))
vi.mock('@/ipc/task', () => ipc)

function fixture(): TaskInfo {
  return {
    id: 'index', kind: 'metadata-index', title: 'Index metadata: fixture', status: 'running',
    progress: { current: 0, total: 1, metadata: {
      current: 0, total: 1, stage: 'tableColumns', connectionName: 'fixture', schemaName: 'public',
      objectName: 'orders', objectCurrent: 242, objectTotal: 1000,
    } },
    logs: [], createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:01Z',
  }
}

function row(task: TaskInfo) {
  return <TaskRow task={task} onCancel={() => void useTaskStore.getState().cancel(task.id)} onReveal={vi.fn()} revealLabel="Reveal output" />
}

describe('metadata task progress presentation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useTaskStore.setState({ tasks: [], cancellingIds: [] })
    useUiStore.setState({ notifications: [] })
    ipc.cancelTask.mockReset()
  })
  afterEach(async () => { await i18n.changeLanguage('en') })

  it('shows table context for a long single-schema fixture without an overall percentage', async () => {
    const task = fixture()
    const { rerender, container } = render(row(task))
    expect(await screen.findByText('Reading table columns')).toBeVisible()
    expect(screen.getByText(/Schema: public.*Schema 1 of 1/)).toBeVisible()
    expect(screen.getByText('Table 242 of 1000 · orders')).toBeVisible()
    for (const current of [500, 999, 1000]) {
      task.progress.metadata!.objectCurrent = current
      rerender(row({ ...task }))
      expect(screen.getByText(`Table ${current} of 1000 · orders`)).toBeVisible()
    }
    expect(container.textContent).not.toContain('%')
    expect(container.textContent).not.toContain('0/1')
  })

  it('shows view progress and preserves database object names', () => {
    const task = fixture()
    Object.assign(task.progress.metadata!, { stage: 'viewColumns', objectName: 'order_summary', objectCurrent: 2, objectTotal: 4 })
    render(row(task))
    expect(screen.getByText('Reading view columns')).toBeVisible()
    expect(screen.getByText('View 2 of 4 · order_summary')).toBeVisible()
  })

  it('does not invent counts while listing an unknown or empty catalog', () => {
    const task = fixture()
    Object.assign(task.progress.metadata!, { stage: 'views', objectName: null, objectCurrent: null, objectTotal: null })
    const { container } = render(row(task))
    expect(screen.getByText('Listing views')).toBeVisible()
    expect(container.textContent).not.toContain('0/0')
    expect(screen.queryByText(/View \d+ of/)).not.toBeInTheDocument()
  })

  it('immediately acknowledges cancel while IPC is pending, then shows Cancelled', async () => {
    const task = fixture()
    useTaskStore.setState({ tasks: [task] })
    let resolve!: (task: TaskInfo) => void
    ipc.cancelTask.mockReturnValue(new Promise<TaskInfo>((done) => { resolve = done }))
    const { rerender } = render(row(task))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel background task' }))
    expect(screen.getByText('Cancelling…')).toBeVisible()
    expect(screen.getByText(/Waiting for the current metadata operation/)).toBeVisible()
    expect(screen.queryByText('Reading table columns')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel background task' })).toBeDisabled()
    await act(async () => { resolve({ ...task, status: 'cancelling' }) })
    rerender(row(useTaskStore.getState().tasks[0]))
    expect(screen.getByText('Cancelling…')).toBeVisible()
    rerender(row({ ...task, status: 'cancelled' }))
    expect(screen.getByText('Cancelled')).toBeVisible()
    expect(screen.queryByText('Cancelling…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel background task' })).not.toBeInTheDocument()
  })

  it('restores the cancel control and stage if the cancellation request fails', async () => {
    ipc.cancelTask.mockRejectedValue(new Error('request failed'))
    render(row(fixture()))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel background task' })) })
    expect(screen.getByText('Reading table columns')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel background task' })).toBeEnabled()
    expect(useUiStore.getState().notifications).toHaveLength(1)
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('terminal %s hides stale stage and cancellation feedback', (status) => {
    useTaskStore.setState({ cancellingIds: ['index'] })
    const task = { ...fixture(), status, error: status === 'failed' ? 'Metadata unavailable' : null }
    task.progress.metadataCapacityReached = status === 'succeeded'
    render(row(task))
    expect(screen.queryByText('Reading table columns')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancelling…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel background task' })).not.toBeInTheDocument()
    if (status === 'succeeded') {
      expect(screen.getByText('Metadata index ready')).toBeVisible()
      expect(screen.getByText('Index complete (capacity limit reached).')).toBeVisible()
    } else if (status === 'failed') {
      expect(screen.getByText('Metadata indexing failed')).toBeVisible()
      expect(screen.getByText('Metadata unavailable')).toBeVisible()
    } else expect(screen.getByText('Cancelled')).toBeVisible()
  })

  it('shows cached success without stale stage, schema counts, or capacity warning', () => {
    const task = fixture()
    task.status = 'succeeded'
    task.progress.metadata!.stage = 'starting'
    task.progress.metadataCapacityReached = false
    render(row(task))
    expect(screen.getByText('Metadata index ready')).toBeVisible()
    expect(screen.queryByText(/Preparing|Schema:|Table 242|capacity limit/)).not.toBeInTheDocument()
  })

  it('does not resurrect active progress after cancellation or terminal events arrive first', () => {
    const task = fixture()
    const store = useTaskStore.getState()
    store.upsertTask({ ...task, status: 'cancelling' })
    store.upsertTask(task)
    expect(useTaskStore.getState().tasks[0].status).toBe('cancelling')
    store.upsertTask({ ...task, status: 'succeeded' })
    store.upsertTask({ ...task, status: 'cancelling' })
    expect(useTaskStore.getState().tasks[0].status).toBe('succeeded')
  })

  it('localizes stage and status in Chinese without translating object names', async () => {
    await i18n.changeLanguage('zh')
    const task = fixture()
    const { rerender } = render(row(task))
    expect(screen.getByText(i18n.t('tasks.metadata.stage.tableColumns'))).toBeVisible()
    expect(screen.getByText(/242.*1000.*orders/)).toBeVisible()
    rerender(row({ ...task, status: 'cancelled' }))
    expect(screen.getByText(i18n.t('tasks.metadata.status.cancelled'))).toBeVisible()
  })
})
