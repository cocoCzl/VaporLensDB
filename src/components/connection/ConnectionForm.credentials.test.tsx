import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ConnectionForm } from '@/components/connection/ConnectionForm'
import type { ConnectionConfig } from '@/types/connection'
import type { DriverDefinition } from '@/types/driver'

const driver: DriverDefinition = {
  id: 'postgres', driverType: 'postgres', driverDialect: 'postgresql', name: 'PostgreSQL',
  backend: 'nativeRust', status: 'ready', builtIn: true, userDriverRequired: false,
  driverArtifacts: [], connectionVariants: [{ id: 'urlOnly', label: 'URL', requiredFields: ['connectionUrl'] }],
  capabilities: { canConnect: true, canQuery: true, canStream: true, canReadMetadata: true, canCancel: true, canGenerateDdl: true },
}

function renderForm(connection: ConnectionConfig) {
  const onTest = vi.fn().mockResolvedValue(undefined)
  const onSaveOnly = vi.fn().mockResolvedValue(undefined)
  const rendered = render(<ConnectionForm
    connection={connection} driverDefinitions={[driver]}
    onTest={onTest} onSaveOnly={onSaveOnly} onSaveAndConnect={vi.fn()}
    onCancel={vi.fn()}
  />)
  return { ...rendered, onTest, onSaveOnly }
}

describe('ConnectionForm URL credential storage consent', () => {
  it.each([false, true])('pasting credentials preserves savePassword=%s for testing and saving', async (savePassword) => {
    const { container, onTest, onSaveOnly } = renderForm({
      id: 'qa', name: 'QA', driverType: 'postgres', driverDefinitionId: 'postgres',
      connectionUrl: 'postgres://host/db', username: 'alice', hasSavedPassword: savePassword,
    })
    const urlInput = container.querySelector<HTMLInputElement>('#connection-url')!
    fireEvent.change(urlInput, { target: { value: 'postgres://alice:authorityDummy@host/db?password=queryDummy&sslmode=require' } })
    expect(container.querySelector('input[role="switch"]')).toHaveProperty('checked', savePassword)
    expect(urlInput.value).toBe('postgres://host/db?sslmode=require')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('connectionForm.testConnection') }))
    await waitFor(() => expect(onTest).toHaveBeenCalledOnce())
    expect(onTest.mock.calls[0][0]).toMatchObject({
      password: 'authorityDummy', username: 'alice', savePassword,
      connectionUrl: 'postgres://host/db?sslmode=require',
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.moreActions') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('connectionForm.saveOnly') }))
    await waitFor(() => expect(onSaveOnly).toHaveBeenCalledOnce())
    expect(onSaveOnly.mock.calls[0][0]).toMatchObject({ password: 'authorityDummy', savePassword })
  })

  it('extracts a legacy URL password without silently enabling password storage', () => {
    const { container } = renderForm({
      id: 'qa', name: 'QA', driverType: 'postgres', driverDefinitionId: 'postgres',
      connectionUrl: 'postgres://alice:legacyDummy@host/db', hasSavedPassword: false,
    })
    expect(container.querySelector('input[role="switch"]')).not.toBeChecked()
    expect(container.querySelector('#connection-password')).toHaveValue('legacyDummy')
    expect(container.querySelector('#connection-url')).toHaveValue('postgres://host/db')
  })
})
