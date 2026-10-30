import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ModuleBoundary } from './ModuleBoundary'
import i18n from '@/i18n'

it('offers local recovery for rendering errors without exposing values or calling them chunk failures', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let fail = true
  function BrokenView() { if (fail) throw new Error('private URL and property value'); return <p>Recovered</p> }
  render(<ModuleBoundary onRecover={() => { fail = false }}><BrokenView /></ModuleBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('app.renderFailed'))
  expect(screen.getByRole('alert')).not.toHaveTextContent('private URL')
  expect(screen.getByRole('alert')).not.toHaveTextContent(i18n.t('app.moduleLoadFailed'))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('app.retryView') }))
  expect(screen.getByText('Recovered')).toBeVisible()
})

it('keeps the module load failure explanation for actual import errors', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  function MissingChunk(): never { throw new TypeError('Failed to fetch dynamically imported module: private-url') }
  render(<ModuleBoundary><MissingChunk /></ModuleBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('app.moduleLoadFailed'))
  expect(screen.getByRole('alert')).not.toHaveTextContent('private-url')
})
