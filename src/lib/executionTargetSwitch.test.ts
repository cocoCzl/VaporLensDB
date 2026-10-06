import { describe, expect, it } from 'vitest'
import { useEditorStore } from '@/stores/editorStore'

describe('execution target invariant', () => {
  it.each(['active', 'failed'] as const)('does not hide an unresolved %s transaction through a direct target update', (phase) => {
    // Deterministic backend session after a mutation (or subsequent query failure).
    const backendA = { consoleId: 'tab', phase, pendingMutation: true }
    useEditorStore.setState({ tabs: [{ id: 'tab', title: 'SQL', sql: 'UPDATE fixture SET value = 2', connectionId: 'A', transactionMode: 'manual', transactionPhase: phase, lastQueryId: 'result-A' }] })
    useEditorStore.getState().updateTabConnection('tab', 'B', { database: 'db-B', schema: null })
    expect(backendA).toMatchObject({ phase, pendingMutation: true })
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ connectionId: 'A', transactionMode: 'manual', transactionPhase: phase, lastQueryId: 'result-A' })
  })
})
