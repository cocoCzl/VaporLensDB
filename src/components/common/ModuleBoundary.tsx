import { Component, type ReactNode } from 'react'
import i18n from '@/i18n'

/** Keep a failed on-demand module visible without reloading live SQL sessions. */
export class ModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (this.state.failed) return <p role="alert" className="p-5 text-sm text-destructive">{i18n.t('app.moduleLoadFailed')}</p>
    return this.props.children
  }
}
