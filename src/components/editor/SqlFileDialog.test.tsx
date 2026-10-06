import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { SqlFileDialog } from './SqlFileDialog'
import { chooseSqlFileAction, useSqlFileChoice } from '@/lib/sqlFileChoice'
afterEach(async () => { useSqlFileChoice.getState().pending?.resolve('cancel'); await i18n.changeLanguage('en') })
describe('SQL file decisions', () => {
  it.each(['en', 'zh'])('shows localized save/discard/cancel and filename in %s', async (language) => {
    await i18n.changeLanguage(language)
    render(<SqlFileDialog />)
    let choice!: Promise<string>
    act(() => { choice = chooseSqlFileAction('close', ['save', 'discard', 'cancel'], '/selected/query.sql') })
    expect(screen.getByRole('dialog')).toHaveTextContent('/selected/query.sql')
    expect(screen.getByRole('button', { name: i18n.t('sqlFile.discard') })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('sqlFile.save') }))
    expect(await choice).toBe('save')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('dismisses disk-conflict confirmation as Cancel', async () => {
    render(<SqlFileDialog />)
    let choice!: Promise<string>
    act(() => { choice = chooseSqlFileAction('changed', ['reload', 'overwrite', 'cancel']) })
    expect(screen.getByRole('button', { name: i18n.t('sqlFile.reload') })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('sqlFile.cancel') }))
    expect(await choice).toBe('cancel')
  })
})
