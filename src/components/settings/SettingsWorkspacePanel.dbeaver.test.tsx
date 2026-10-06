import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('DBeaver preview localization and parser feedback', () => {
  const originalLanguage = i18n.language
  afterEach(async () => { await i18n.changeLanguage(originalLanguage) })

  it.each([
    { language: 'en', summary: '2 supported / 2 skipped', password: 'Password must be entered manually', noPassword: 'No password', unsupported: 'Unsupported driver', unknown: 'Unknown driver', urlOnly: 'URL only' },
    { language: 'zh', summary: '可导入 2 个 / 已跳过 2 个', password: '密码需手动输入', noPassword: '无密码', unsupported: '不支持的驱动', unknown: '未知驱动', urlOnly: '仅 URL' }, // i18n-hardcoded-ok: expected Chinese translations in localization regression test.
  ])('localizes preview, states, and report in $language', async (copy) => {
    await i18n.changeLanguage(copy.language)
    const { container, onNotify } = renderImport(async (input) => {
      if (input.name === 'MySQL fixture') throw new Error('fixture rejected')
    })
    const file = new File([JSON.stringify({ connections: {
      pg: { name: 'PostgreSQL fixture', driver: 'postgres', configuration: { host: 'localhost', password: 'fixture-preview-secret' } },
      mysql: { name: 'MySQL fixture', driver: 'mysql' },
      skipped: { name: 'Unsupported fixture', driver: 'db2' },
      unknown: { name: 'Unnamed driver fixture' },
    } })], 'data-sources.JSON')
    await selectFile(container, file)
    expect(screen.getByText(new RegExp(copy.summary))).toBeVisible()
    expect(screen.getByText(i18n.t('dbeaver.passwordSummary', { count: 1 }), { exact: false })).toBeVisible()
    expect(screen.getByText(`localhost · ${copy.password}`)).toBeVisible()
    expect(screen.getByText(copy.noPassword, { exact: false })).toBeVisible()
    expect(screen.getByText(copy.urlOnly, { exact: false })).toBeVisible()
    expect(screen.getAllByText(copy.unsupported, { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText(copy.unknown)).toBeVisible()
    expect(screen.getAllByText(i18n.t('dbeaver.unsupported')).length).toBe(2)
    expect(screen.getAllByText(i18n.t('dbeaver.itemPending')).length).toBe(2)
    expect(onNotify).toHaveBeenLastCalledWith(expect.objectContaining({ message: copy.summary }))
    expect(screen.getByText('PostgreSQL fixture')).toBeVisible()
    expect(screen.getByText('MySQL fixture')).toBeVisible()
    expect(screen.getByText('db2')).toBeVisible()
    expect(container.textContent).not.toContain('fixture-preview-secret')
    expect(JSON.stringify(onNotify.mock.calls)).not.toContain('fixture-preview-secret')
    if (copy.language === 'zh') {
      expect(container.textContent).not.toMatch(/password manual entry|passwords need manual entry|unsupported driver|URL only|\d+ supported|\d+ skipped/i)
    }

    fireEvent.click(importButton())
    await waitFor(() => expect(importButton()).toHaveTextContent(i18n.t('dbeaver.retryFailed')))
    expect(screen.getByText(i18n.t('dbeaver.itemImported'))).toBeVisible()
    expect(screen.getByText(i18n.t('dbeaver.itemFailed'))).toBeVisible()
    expect(screen.getByText(i18n.t('dbeaver.importSummary', { imported: 1, failed: 1, skipped: 2 }))).toBeVisible()

    // Preview data carries a reason key, so changing language also updates an
    // already open skipped-items report without reparsing the source file.
    if (copy.language === 'en') {
      await act(async () => { await i18n.changeLanguage('zh') })
      expect(screen.getAllByText(/不支持的驱动/).length).toBe(2) // i18n-hardcoded-ok: verifies language switching in an existing preview.
      expect(screen.queryByText(/Unsupported driver/)).not.toBeInTheDocument()
    }
  })

  it.each(['en', 'zh'])('uses safe localized parser errors in %s', async (language) => {
    await i18n.changeLanguage(language)
    const { container, onNotifyError } = renderImport(async () => {})
    const input = container.querySelector('input[type="file"]')!
    for (const [name, source, key] of [
      ['data-sources.txt', '<data-sources password="fixture-parse-secret"/>', 'unsupportedFormat'],
      ['data-sources.JSON', 'fixture-parse-secret {"password":"fixture-parse-secret"}', 'jsonParseFailed'],
      ['data-sources.XML', '<data-sources password="fixture-parse-secret"><', 'xmlParseFailed'],
    ]) {
      onNotifyError.mockClear()
      fireEvent.change(input, { target: { files: [new File([source], name)] } })
      await waitFor(() => expect(onNotifyError).toHaveBeenCalledWith({
        code: 'DBEAVER_IMPORT_PREVIEW_FAILED', message: i18n.t(`dbeaver.${key}`),
      }, i18n.t('dbeaver.previewFailed')))
      expect(JSON.stringify(onNotifyError.mock.calls)).not.toContain('fixture-parse-secret')
    }
  })
})

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
