import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ConnectionRow } from './ConnectionRow'

it('declares a menu trigger (no active Button translation), stops row selection and reports its anchor', () => {
  const onSelect = vi.fn(), onOpenMenu = vi.fn()
  const props = { connection: { id: 'local', name: 'Local', driverType: 'sqlite' as const }, status: 'disconnected' as const, busy: false, selected: true, expanded: false, favorite: false, query: '', t: i18n.t.bind(i18n), onSelect, onOpen: vi.fn(), onToggle: vi.fn(), onOpenMenu }
  const view = render(<ConnectionRow {...props} />)
  const trigger = screen.getByRole('button', { name: i18n.t('common.moreActions') })
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ right: 280, bottom: 90 } as DOMRect)
  fireEvent.click(trigger)
  expect(onOpenMenu).toHaveBeenCalledExactlyOnceWith({ x: 104, y: 94 })
  expect(onSelect).not.toHaveBeenCalled()
  view.rerender(<ConnectionRow {...props} menuOpen />)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
})
