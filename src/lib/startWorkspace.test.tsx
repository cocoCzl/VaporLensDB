import { act } from 'react'
import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import { startWorkspace } from './startWorkspace'

function shell() {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.getElementById('root')!
  document.body.replaceChildren(root)
  return root
}

describe('entry shell handoff', () => {
  it('keeps the real HTML skeleton while the application import is pending, then commits content', async () => {
    const root = shell()
    let ready!: (app: { default: () => React.JSX.Element }) => void
    const module = new Promise<{ default: () => React.JSX.Element }>(resolve => { ready = resolve })
    const startup = startWorkspace(root, () => module, 'failure')
    await Promise.resolve()
    expect(root.querySelector('.startup-top')).toBeTruthy()
    expect(root.querySelectorAll('.home-action')).toHaveLength(3)
    expect(root.querySelector('button, input, [tabindex]')).toBeNull()
    expect(root.querySelectorAll('img')).toHaveLength(1)
    expect(root.querySelector('img')?.width).toBe(24)
    await act(async () => {
      ready({ default: () => <main>Ready workspace</main> })
      await startup
    })
    expect(root.textContent).toBe('Ready workspace')
    expect(root.querySelector('#startup-status')).toBeNull()
  })

  it('preserves structure and shows an actionable failure instead of indefinite loading', async () => {
    const root = shell()
    await startWorkspace(root, () => Promise.reject(new Error('missing chunk')), 'Please reopen')
    expect(root.querySelector('.startup-sidebar')).toBeTruthy()
    const alert = root.querySelector('[role="alert"]')!
    expect(alert.getAttribute('aria-busy')).toBe('false')
    expect(alert.getAttribute('data-state')).toBe('error')
    expect(alert.textContent).toContain('Please reopen')
  })
})
