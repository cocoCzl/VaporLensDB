import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DbeaverImportSettings } from './SettingsWorkspacePanel'
import i18n from '@/i18n'
import type { ConnectionInput } from '@/types/connection'

function configFile(names: string[]) {
  const connections = Object.fromEntries(
    names.map((name) => [name.toLowerCase(), {
      name,
      driver: 'postgres',
      configuration: { url: `jdbc:postgresql://localhost:5432/${name.toLowerCase()}` },
    }]),
  )
  return new File([
    JSON.stringify({ connections }),
  ], 'data-sources.json', { type: 'application/json' })
}

function renderImport(onImportConnection: (input: ConnectionInput) => Promise<unknown>) {
  const onNotify = vi.fn()
  const onNotifyError = vi.fn()
  const rendered = render(
    <DbeaverImportSettings
      onImportConnection={onImportConnection}
      onNotify={onNotify}
      onNotifyError={onNotifyError}
    />,
  )
  return { ...rendered, onNotify, onNotifyError }
}

async function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('DBeaver file input not found')
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByText(file.name)).toBeVisible())
}

function importButton() {
  const labels = ['import', 'retryFailed', 'imported', 'importing']
    .map((key) => i18n.t(`dbeaver.${key}`))
    .join('|')
  return screen.getByRole('button', { name: new RegExp(`^(?:${labels})$`) })
}

describe('DBeaver import session semantics', () => {
  it('does not create successful items again after a full-success import', async () => {
    const calls: ConnectionInput[] = []
    const { container } = renderImport(async (input) => { calls.push(input) })
    await selectFile(container, configFile(['A', 'B', 'C']))

    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.imported')))
    fireEvent.click(importButton())

    expect(calls.map((input) => input.name)).toEqual(['A', 'B', 'C'])
    expect(importButton()).toBeDisabled()
  })

  it('retries only failed items and preserves successful items', async () => {
    const calls: string[] = []
    let failB = true
    const { container } = renderImport(async (input) => {
      calls.push(input.name)
      if (input.name === 'B' && failB) {
        failB = false
        throw new Error('backend rejected B')
      }
    })
    await selectFile(container, configFile(['A', 'B', 'C']))

    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.retryFailed')))
    expect(calls).toEqual(['A', 'B', 'C'])

    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.imported')))
    expect(calls).toEqual(['A', 'B', 'C', 'B'])
    expect(screen.getByText(i18n.t('dbeaver.importSummary', { imported: 3, failed: 0, skipped: 0 }))).toBeVisible()
  })

  it('allows a repeatedly failing item to be retried without retrying successes', async () => {
    const calls: string[] = []
    const { container } = renderImport(async (input) => {
      calls.push(input.name)
      if (input.name === 'B') throw new Error('B still unavailable')
    })
    await selectFile(container, configFile(['A', 'B', 'C']))

    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.retryFailed')))
    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.retryFailed')))

    expect(calls).toEqual(['A', 'B', 'C', 'B'])
    expect(screen.getByText('B still unavailable')).toBeVisible()
  })

  it('reports a full failure without claiming any item was imported', async () => {
    const { container, onNotify } = renderImport(async (input) => {
      throw new Error(`${input.name} unavailable`)
    })
    await selectFile(container, configFile(['A', 'B', 'C']))

    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.retryFailed')))

    expect(screen.getByText(i18n.t('dbeaver.importSummary', { imported: 0, failed: 3, skipped: 0 }))).toBeVisible()
    expect(onNotify).toHaveBeenLastCalledWith({
      kind: 'warning',
      title: i18n.t('dbeaver.importComplete'),
      message: i18n.t('dbeaver.importSummary', { imported: 0, failed: 3, skipped: 0 }),
    })
  })

  it('resets item state for a newly selected file', async () => {
    const calls: string[] = []
    const { container } = renderImport(async (input) => { calls.push(input.name) })
    await selectFile(container, configFile(['A', 'B', 'C']))
    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.imported')))

    await selectFile(container, configFile(['D', 'E']))
    expect(importButton()).toHaveTextContent(i18n.t('dbeaver.import'))
    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.imported')))

    expect(calls).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('does not reset succeeded items during an ordinary rerender', async () => {
    const calls: string[] = []
    const onImportConnection = async (input: ConnectionInput) => { calls.push(input.name) }
    const rendered = renderImport(onImportConnection)
    await selectFile(rendered.container, configFile(['A', 'B', 'C']))
    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toBeDisabled())

    rendered.rerender(
      <DbeaverImportSettings
        onImportConnection={onImportConnection}
        onNotify={rendered.onNotify}
        onNotifyError={rendered.onNotifyError}
      />,
    )
    expect(importButton()).toBeDisabled()
    expect(calls).toEqual(['A', 'B', 'C'])
  })

  it('does not start a second batch on a duplicate click while importing', async () => {
    let resolveFirst: (() => void) | undefined
    const firstSave = new Promise<void>((resolve) => { resolveFirst = resolve })
    const calls: string[] = []
    const { container } = renderImport(async (input) => {
      calls.push(input.name)
      if (input.name === 'A') await firstSave
    })
    await selectFile(container, configFile(['A', 'B', 'C']))

    fireEvent.click(importButton())
    fireEvent.click(importButton())
    expect(calls).toEqual(['A'])

    await act(async () => { resolveFirst?.() })
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.imported')))
    expect(calls).toEqual(['A', 'B', 'C'])
  })

  it('redacts credentials from failed item details', async () => {
    const { container } = renderImport(async () => {
      throw new Error('connection failed jdbc:postgresql://reader:secret@example.test/app?password=secret')
    })
    await selectFile(container, configFile(['A']))

    fireEvent.click(importButton())
    await waitFor(() => expect(screen.getByText(i18n.t('dbeaver.itemFailed'))).toBeVisible())
    expect(screen.queryByText(/secret/)).toBeNull()
    expect(screen.getByText(/redacted/)).toBeVisible()
  })
})
