import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionDialog } from '@/components/connection/ConnectionDialog'
import i18n from '@/i18n'
import type { DriverDefinition } from '@/types/driver'

const state = vi.hoisted(() => ({
  saveConnection: vi.fn(),
  testConnectionInput: vi.fn(),
  connectConnection: vi.fn(),
  loadDrivers: vi.fn(),
  loading: false,
  dataSourceGroups: [],
}))

vi.mock('@/stores/connectionStore', () => ({
  useConnectionStore: (selector?: (value: typeof state) => unknown) => selector ? selector(state) : state,
}))

vi.mock('@/stores/driverStore', () => ({
  useDriverStore: () => ({ drivers: [driver], loadDrivers: state.loadDrivers }),
}))

const driver: DriverDefinition = {
  id: 'postgres', driverType: 'postgres', driverDialect: 'postgresql', name: 'PostgreSQL',
  backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false,
  driverArtifacts: [], connectionVariants: [{ id: 'hostPort', label: 'Host', requiredFields: ['host', 'username', 'database'] }],
  capabilities: { canConnect: true, canQuery: true, canStream: true, canReadMetadata: true, canCancel: true, canGenerateDdl: true },
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

function expectDialogClosed() {
  return waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="dialog-portal"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-base-ui-focus-guard]')).not.toBeInTheDocument()
  })
}

function openDialog() {
  const trigger = document.querySelector<HTMLElement>('[data-slot="dialog-trigger"]')!
  trigger.focus()
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: i18n.t('connection.newTitle') })).toBeVisible()
  expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1)
  return trigger
}

function fillForm() {
  fireEvent.change(document.querySelector('#connection-name')!, { target: { value: 'Dialog QA' } })
  fireEvent.change(document.querySelector('#connection-username')!, { target: { value: 'qa' } })
  fireEvent.change(document.querySelector('#connection-database')!, { target: { value: 'qa' } })
}

function closeWithX() {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
}

async function saveOnly() {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('common.moreActions') }))
  fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('connectionForm.saveOnly') }))
}

function saveAndConnect() {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('connection.connect') }))
}

beforeEach(() => {
  vi.clearAllMocks()
  state.loading = false
  state.saveConnection.mockResolvedValue({ id: 'saved' })
  state.connectConnection.mockResolvedValue(undefined)
  state.testConnectionInput.mockResolvedValue(undefined)
})

describe('ConnectionDialog dismissal with the real form and Base UI portal', () => {
  it('removes the uncontrolled popup, overlay, and focus guards when Cancel/X is clicked', async () => {
    render(<ConnectionDialog />)
    openDialog()
    closeWithX()
    await expectDialogClosed()
  })

  it('removes the popup and overlay on Escape', async () => {
    render(<ConnectionDialog />)
    openDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    await expectDialogClosed()
  })

  it('closes after a successful Save Only without connecting', async () => {
    render(<ConnectionDialog />)
    openDialog()
    fillForm()
    await saveOnly()
    await expectDialogClosed()
    expect(state.saveConnection).toHaveBeenCalledOnce()
    expect(state.connectConnection).not.toHaveBeenCalled()
  })

  it('closes after a successful Save + Connect', async () => {
    render(<ConnectionDialog />)
    openDialog()
    fillForm()
    saveAndConnect()
    await expectDialogClosed()
    expect(state.saveConnection).toHaveBeenCalledOnce()
    expect(state.connectConnection).toHaveBeenCalledWith('saved', { password: null })
  })

  it('does not dismiss before Save Only has completed', async () => {
    const save = deferred()
    state.saveConnection.mockImplementation(async () => { await save.promise; return { id: 'saved' } })
    render(<ConnectionDialog />)
    openDialog()
    fillForm()
    await saveOnly()
    expect(screen.getByRole('dialog')).toBeVisible()
    await act(async () => { save.resolve() })
    await expectDialogClosed()
  })

  it('waits for both save and connect before dismissing', async () => {
    const save = deferred()
    const connect = deferred()
    state.saveConnection.mockImplementation(async () => { await save.promise; return { id: 'saved' } })
    state.connectConnection.mockReturnValue(connect.promise)
    render(<ConnectionDialog />)
    openDialog()
    fillForm()
    saveAndConnect()
    expect(state.connectConnection).not.toHaveBeenCalled()
    await act(async () => { save.resolve() })
    expect(state.connectConnection).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toBeVisible()
    await act(async () => { connect.resolve() })
    await expectDialogClosed()
  })

  it('reopens with a fresh form after closing', async () => {
    render(<ConnectionDialog />)
    openDialog()
    fillForm()
    closeWithX()
    await expectDialogClosed()
    openDialog()
    expect(document.querySelector('#connection-name')).not.toHaveValue('Dialog QA')
    closeWithX()
    await expectDialogClosed()
  })

  it('leaves no stale portal through ten repeated open/close cycles', async () => {
    render(<ConnectionDialog />)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      openDialog()
      if (attempt % 2 === 0) closeWithX()
      else fireEvent.keyDown(document, { key: 'Escape' })
      await expectDialogClosed()
    }
  })

  it('returns focus to the trigger and releases outside focus and pointer interaction', async () => {
    const outsideClick = vi.fn()
    render(<><button onClick={outsideClick}>Workbench</button><ConnectionDialog /></>)
    const trigger = openDialog()
    await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement))
    closeWithX()
    await expectDialogClosed()
    await waitFor(() => expect(trigger).toHaveFocus())
    const outside = screen.getByRole('button', { name: 'Workbench' })
    outside.focus()
    fireEvent.click(outside)
    expect(outside).toHaveFocus()
    expect(outsideClick).toHaveBeenCalledOnce()
    expect(outside.closest('[data-base-ui-inert]')).toBeNull()
  })

  it.each(['X', 'Escape', 'Save Only', 'Save + Connect'])('removes the controlled popup via %s and consumes parent open state', async (action) => {
    const onOpenChange = vi.fn()
    function Controlled() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Open controlled</button>
        <ConnectionDialog open={open} hideTrigger onOpenChange={(nextOpen) => { onOpenChange(nextOpen); setOpen(nextOpen) }} />
      </>
    }
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button', { name: 'Open controlled' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    if (action === 'X') closeWithX()
    else if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
    else {
      fillForm()
      if (action === 'Save Only') await saveOnly()
      else saveAndConnect()
    }
    await expectDialogClosed()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open controlled' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    closeWithX()
    await expectDialogClosed()
  })

  it('dismisses when the controlled parent sets open=false without a Close primitive', async () => {
    const onOpenChange = vi.fn()
    const rendered = render(<ConnectionDialog open hideTrigger onOpenChange={onOpenChange} />)
    expect(screen.getByRole('dialog')).toBeVisible()
    rendered.rerender(<ConnectionDialog open={false} hideTrigger onOpenChange={onOpenChange} />)
    await expectDialogClosed()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('does not open the dormant global dialog when the inline instance is opened', async () => {
    render(<><ConnectionDialog /><ConnectionDialog open={false} hideTrigger onOpenChange={vi.fn()} /></>)
    openDialog()
    closeWithX()
    await expectDialogClosed()
  })
})
