import { normalizeAppError } from '@/ipc/client'
import type { AppNotification } from '@/stores/uiStore'
import type { AppError } from '@/types/error'

export type ConnectionGroupMoveResult = {
  connectionId: string
  status: 'success' | 'failure'
  error?: AppError
}

export type ConnectionGroupMoveBatchResult = {
  results: ConnectionGroupMoveResult[]
  refreshFailed: boolean
}

export async function runConnectionGroupOperation<T>(
  operation: () => Promise<T>,
  title: string,
  notifyError: (error: AppError, title: string) => void,
): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    const appError = normalizeAppError(error)
    notifyError(appError, title)
    return null
  }
}

export async function settleConnectionGroupMoves(
  connectionIds: string[],
  groupId: string | null,
  moveConnectionToGroup: (connectionId: string, groupId: string | null) => Promise<void>,
): Promise<ConnectionGroupMoveResult[]> {
  const settled = await Promise.allSettled(
    connectionIds.map((connectionId) => Promise.resolve().then(() => moveConnectionToGroup(connectionId, groupId))),
  )

  return settled.map((result, index) => result.status === 'fulfilled'
    ? { connectionId: connectionIds[index], status: 'success' }
    : { connectionId: connectionIds[index], status: 'failure', error: normalizeAppError(result.reason) })
}

export function buildConnectionGroupMoveNotification(
  result: ConnectionGroupMoveBatchResult,
  connectionNames: Record<string, string>,
  copy: {
    summary: (successCount: number, failureCount: number) => string
    listSeparator: string
    failedItems: (names: string) => string
    moreFailedItems: (count: number) => string
    refreshFailed: string
    succeeded: string
    partial: string
    failed: string
  },
): Omit<AppNotification, 'id'> {
  const failed = result.results.filter((item) => item.status === 'failure')
  const succeeded = result.results.length - failed.length
  const failedNames = failed
    .map((item) => connectionNames[item.connectionId])
    .filter((name): name is string => Boolean(name))
  const names = failedNames.slice(0, 3).join(copy.listSeparator)
  const remaining = failedNames.length - 3
  const failedItems = names
    ? `${copy.failedItems(names)}${remaining > 0 ? ` ${copy.moreFailedItems(remaining)}` : ''}`
    : ''

  return {
    kind: result.refreshFailed || failed.length === result.results.length
      ? 'error'
      : failed.length > 0
        ? 'warning'
        : 'success',
    title: result.refreshFailed
      ? copy.refreshFailed
      : failed.length === 0
        ? copy.succeeded
        : failed.length === result.results.length
          ? copy.failed
          : copy.partial,
    message: [copy.summary(succeeded, failed.length), failedItems, result.refreshFailed ? copy.refreshFailed : '']
      .filter(Boolean)
      .join('\n'),
  }
}
