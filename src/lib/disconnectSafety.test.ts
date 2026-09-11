import { describe, expect, it } from 'vitest'
import { getDisconnectPreflight } from '@/lib/disconnectSafety'
import type { EditorTab } from '@/stores/editorStore'

function sqlTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    kind: 'sql',
    title: 'SQL',
    sql: 'SELECT 1',
    connectionId: 'connection-1',
    transactionMode: 'auto',
    transactionPhase: 'idle',
    ...overrides,
  }
}

describe('disconnect safety preflight', () => {
  it('allows an idle connection to disconnect without a dialog', () => {
    expect(getDisconnectPreflight([sqlTab()], 'connection-1')).toEqual({ kind: 'idle' })
  })

  it('blocks a running query and ignores another connection', () => {
    const preflight = getDisconnectPreflight([
      sqlTab({ id: 'running', runningQueryId: 'query-1' }),
      sqlTab({ id: 'other', connectionId: 'connection-2', runningQueryId: 'query-2' }),
    ], 'connection-1')

    expect(preflight).toEqual({ kind: 'runningQuery', tabIds: ['running'] })
  })

  it('blocks active and failed manual transactions without choosing commit or rollback', () => {
    const preflight = getDisconnectPreflight([
      sqlTab({ id: 'active', transactionMode: 'manual', transactionPhase: 'active' }),
      sqlTab({ id: 'failed', transactionMode: 'manual', transactionPhase: 'failed' }),
    ], 'connection-1')

    expect(preflight).toEqual({ kind: 'uncommittedTransaction', tabIds: ['active', 'failed'] })
  })

  it('prioritizes transaction safety when a connection has both risks', () => {
    const preflight = getDisconnectPreflight([
      sqlTab({ runningQueryId: 'query-1', transactionMode: 'manual', transactionPhase: 'active' }),
    ], 'connection-1')

    expect(preflight.kind).toBe('uncommittedTransaction')
  })
})
