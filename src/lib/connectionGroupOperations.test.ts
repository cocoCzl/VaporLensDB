import { describe, expect, it, vi } from 'vitest'
import { buildConnectionGroupMoveNotification, runConnectionGroupOperation, settleConnectionGroupMoves } from '@/lib/connectionGroupOperations'

describe('connection group operation callers', () => {
  it.each([
    'Unable to create group',
    'Unable to rename group',
    'Unable to delete group',
    'Unable to move connection',
    'Unable to reorder groups',
  ])('consumes a rejected %s operation and notifies exactly once', async (title) => {
    const notifyError = vi.fn()
    const failure = { code: 'GROUP_FAILURE', message: 'backend rejected', detail: 'secret=hidden' }

    await expect(runConnectionGroupOperation(() => Promise.reject(failure), title, notifyError)).resolves.toBeNull()

    expect(notifyError).toHaveBeenCalledOnce()
    expect(notifyError).toHaveBeenCalledWith(failure, title)
  })

  it('returns per-item outcomes without rejecting when one move fails', async () => {
    const moveConnectionToGroup = vi.fn(async (connectionId: string) => {
      if (connectionId === 'connection-b') throw new Error('B failed')
    })

    await expect(settleConnectionGroupMoves(
      ['connection-a', 'connection-b', 'connection-c'],
      'group-1',
      moveConnectionToGroup,
    )).resolves.toEqual([
      { connectionId: 'connection-a', status: 'success' },
      { connectionId: 'connection-b', status: 'failure', error: { code: 'UNKNOWN_ERROR', message: 'B failed' } },
      { connectionId: 'connection-c', status: 'success' },
    ])
    expect(moveConnectionToGroup).toHaveBeenCalledTimes(3)
  })

  it.each([
    {
      name: 'full success',
      result: { results: [{ connectionId: 'a', status: 'success' as const }, { connectionId: 'b', status: 'success' as const }, { connectionId: 'c', status: 'success' as const }], refreshFailed: false },
      expected: { kind: 'success', title: 'moved', message: '3/0' },
    },
    {
      name: 'full failure',
      result: { results: [{ connectionId: 'a', status: 'failure' as const }, { connectionId: 'b', status: 'failure' as const }, { connectionId: 'c', status: 'failure' as const }], refreshFailed: false },
      expected: { kind: 'error', title: 'failed', message: '0/3\nFailed: A, B, C' },
    },
    {
      name: 'partial success',
      result: { results: [{ connectionId: 'a', status: 'success' as const }, { connectionId: 'b', status: 'failure' as const }, { connectionId: 'c', status: 'success' as const }], refreshFailed: false },
      expected: { kind: 'warning', title: 'partial', message: '2/1\nFailed: B' },
    },
  ])('builds an accurate $name notification', ({ result, expected }) => {
    expect(buildConnectionGroupMoveNotification(result, { a: 'A', b: 'B', c: 'C' }, {
      summary: (successCount, failureCount) => `${successCount}/${failureCount}`,
      listSeparator: ', ',
      failedItems: (names) => `Failed: ${names}`,
      moreFailedItems: (count) => `and ${count} more`,
      refreshFailed: 'refresh failed',
      succeeded: 'moved',
      partial: 'partial',
      failed: 'failed',
    })).toEqual(expected)
  })
})
