import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { ModuleBoundary } from '@/components/common/ModuleBoundary'

/** Leave the HTML shell in place until a ready React tree can commit. */
export async function startWorkspace(root: HTMLElement, load: () => Promise<{ default: ComponentType }>, failure: string) {
  try {
    const { default: App } = await load()
    createRoot(root).render(<StrictMode><ModuleBoundary><App /></ModuleBoundary></StrictMode>)
  } catch {
    const status = root.querySelector('#startup-status')
    const message = root.querySelector('#startup-message')
    if (status && message) {
      status.setAttribute('role', 'alert')
      status.setAttribute('aria-busy', 'false')
      status.setAttribute('data-state', 'error')
      message.textContent = failure
    } else {
      const error = document.createElement('p')
      error.setAttribute('role', 'alert')
      error.textContent = failure
      root.replaceChildren(error)
    }
  }
}
