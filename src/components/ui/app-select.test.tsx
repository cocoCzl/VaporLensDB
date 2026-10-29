import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { AppSelect } from './app-select'

it('keeps complete long labels accessible when selecting an installation', async () => {
  const label = 'Long installation name 长名称 with a distinguishable version suffix 2026.10' // i18n-hardcoded-ok: multilingual test fixture
  function Example() {
    const [value, setValue] = useState('a')
    return <AppSelect aria-label="Installation" value={value} onValueChange={setValue}
      options={[{ value: 'a', label: 'Version 1' }, { value: 'b', label }]} />
  }
  render(<Example />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Installation' }))
  const option = await screen.findByRole('option', { name: label })
  fireEvent.pointerDown(option, { pointerType: 'mouse' })
  fireEvent.mouseUp(option)
  fireEvent.click(option)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Installation' })).toHaveTextContent(label))
  expect(screen.getByRole('combobox', { name: 'Installation' })).toHaveAttribute('title', label)
})
