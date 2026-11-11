import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LostConsoleRecovery } from './LostConsoleRecovery'
import { useEditorStore } from '@/stores/editorStore'
import { useQueryResultStore } from '@/stores/queryResultStore'
import { recoverLostConsoleSession } from '@/ipc/query'
import i18n from '@/i18n'
vi.mock('@/ipc/query', () => ({ recoverLostConsoleSession: vi.fn() }))
it('requires target confirmation, replaces only the lost console, retains SQL and old result provenance without replay', async () => {
  await i18n.changeLanguage('en')
  useEditorStore.setState({ activeTabId: 'lost', tabs: [
    { id: 'lost', title: 'SQL', sql: 'INSERT INTO own_table VALUES (1)', connectionId: 'db', database: 'fixture_database', transactionMode: 'manual', transactionPhase: 'lost', lastQueryId: 'old-result' },
    { id: 'other', title: 'SQL2', sql: '', connectionId: 'db', transactionMode: 'manual', transactionPhase: 'active' },
  ] })
  const sources = useQueryResultStore.getState().sources
  vi.mocked(recoverLostConsoleSession).mockImplementation(async input => ({ connectionId: 'db', consoleId: input.newConsoleId, mode: 'manual', phase: 'idle' }))
  render(<LostConsoleRecovery tab={useEditorStore.getState().tabs[0]} />)
  expect(screen.getByRole('alert')).toHaveTextContent(/final outcome is unknown/i)
  fireEvent.click(screen.getByRole('button', { name: /create new session/i }))
  expect(recoverLostConsoleSession).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('fixture_database')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /create new session/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(useEditorStore.getState().activeTabId).not.toBe('lost'))
  const [next, other] = useEditorStore.getState().tabs
  expect(next).toMatchObject({ sql: 'INSERT INTO own_table VALUES (1)', lastQueryId: 'old-result', database: 'fixture_database', transactionMode: 'manual', transactionPhase: 'idle', transactionBusy: false })
  expect(other).toMatchObject({ id: 'other', transactionPhase: 'active' })
  expect(useQueryResultStore.getState().sources).toBe(sources)
  expect(recoverLostConsoleSession).toHaveBeenCalledTimes(1)
})

it.each(['en', 'zh'])('shows observation-first Lost guidance without exposing execution inputs (%s)', async language => {
  await i18n.changeLanguage(language)
  const sql = "SELECT 'fixture_private_value', 'jdbc:fixture://db.invalid'; -- password=fixture_secret"
  useEditorStore.setState({ tabs: [{ id: 'lost', title: 'SQL', sql, connectionId: 'fixture', transactionMode: 'manual', transactionPhase: 'lost' }] })
  render(<LostConsoleRecovery tab={useEditorStore.getState().tabs[0]} />)
  const message = screen.getByRole('alert').textContent ?? ''
  if (language === 'en') {
    expect(message).toMatch(/independent session.*end the invalid console/i)
    expect(message).toMatch(/cannot be committed or rolled back through a new connection/i)
    expect(message).toMatch(/final outcome is unknown/i)
    expect(message).toMatch(/does not imply rollback succeeded/i)
  } else {
    expect(message).toContain('先通过独立会话核对数据库结果，再结束失效控制台或创建新会话') // i18n-hardcoded-ok: expected Chinese recovery guidance in a localization regression
    expect(message).toContain('无法通过新连接继续提交或回滚') // i18n-hardcoded-ok: expected Chinese recovery guidance in a localization regression
    expect(message).toContain('事务最终结果未知') // i18n-hardcoded-ok: expected Chinese recovery guidance in a localization regression
    expect(message).toContain('不代表已回滚成功') // i18n-hardcoded-ok: expected Chinese recovery guidance in a localization regression
  }
  for (const sensitive of [sql, 'fixture_private_value', 'fixture_secret', 'password=', 'jdbc:fixture']) expect(message).not.toContain(sensitive)
})
