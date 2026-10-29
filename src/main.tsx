import '@fontsource-variable/geist/index.css'
import i18n from './i18n'
import { startWorkspace } from './lib/startWorkspace'

;(window as Window & { __vaporStartupMark?: (stage: string) => void }).__vaporStartupMark?.('frontend_entry')

void startWorkspace(document.getElementById('root')!, () => import('./App'), i18n.t('app.moduleLoadFailed'))
