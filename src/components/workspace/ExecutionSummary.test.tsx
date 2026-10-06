import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ExecutionSummary } from './ExecutionSummary'
import type { ExecutionReport } from '@/types/query'

const report: ExecutionReport = { outcome: 'failed', statements: [
  { index: 1, preview: 'SELECT 1', status: 'succeeded', elapsedMs: 3, resultIndex: 0 },
  { index: 2, preview: 'UPDATE example', status: 'succeeded', affectedRows: 3, elapsedMs: 4, resultIndex: 1 },
  { index: 3, preview: 'bad', status: 'failed', error: { code: 'QUERY_FAILED', message: 'syntax error' } },
  { index: 4, preview: 'SELECT 4', status: 'notExecuted' },
] }
describe('Execution summary', () => {
  it('expands partial failure and preserves result navigation and affected rows', async () => {
    await i18n.changeLanguage('en')
    const select = vi.fn()
    const view = render(<ExecutionSummary report={report} onSelectResult={select} />)
    expect(view.container.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByText('Not executed')).toBeVisible()
    expect(screen.getByText('Affected rows: 3')).toBeVisible()
    expect(screen.getByText('syntax error')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Statement 2' }))
    expect(select).toHaveBeenCalledWith(1)
  })
  it('keeps complete batches collapsed and distinguishes cancellation from failure', async () => {
    await i18n.changeLanguage('en')
    const view = render(<ExecutionSummary report={{ outcome: 'completed', statements: report.statements.slice(0, 2) }} onSelectResult={() => {}} />)
    expect(view.container.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/2 of 2 statements succeeded/)).toBeVisible()
    view.rerender(<ExecutionSummary report={{ outcome: 'cancelled', statements: [{ index: 1, preview: 'SELECT 1', status: 'cancelled' }, report.statements[3]] }} onSelectResult={() => {}} />)
    expect(screen.getByText('Cancelled')).toBeVisible()
    expect(screen.getByText('Not executed')).toBeVisible()
  })
})
