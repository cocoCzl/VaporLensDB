import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '@/i18n'
import { Button } from '@/components/ui/button'

/** Keep a failed on-demand module visible without reloading live SQL sessions. */
export class ModuleBoundary extends Component<{ children: ReactNode; onRecover?: () => void }, { failed: boolean; moduleFailure: boolean; components: string }> {
  state = { failed: false, moduleFailure: false, components: '' }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, moduleFailure: error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(error.message) }
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    // Only component identifiers: exception messages, props and URLs may contain
    // credentials. Never include them in the local recovery diagnostic.
    const components = [...(info.componentStack ?? '').matchAll(/(?:at\s+|^\s*)([A-Za-z][A-Za-z0-9_$]*)\s*(?:@|\()/gm)]
      .map(match => match[1]).slice(0, 12).join(' → ')
    this.setState({ components })
  }

  render() {
    if (this.state.failed) return <div role="alert" className="grid gap-3 p-5 text-sm">
      <p className="text-destructive">{i18n.t(this.state.moduleFailure ? 'app.moduleLoadFailed' : 'app.renderFailed')}</p>
      {this.state.components && <details className="text-xs text-muted-foreground"><summary>{i18n.t('connectionForm.errorDetails')}</summary><p className="break-words">{this.state.components}</p></details>}
      <Button type="button" variant="outline" className="justify-self-start" onClick={() => { this.props.onRecover?.(); this.setState({ failed: false, moduleFailure: false, components: '' }) }}>{i18n.t('app.retryView')}</Button>
    </div>
    return this.props.children
  }
}
