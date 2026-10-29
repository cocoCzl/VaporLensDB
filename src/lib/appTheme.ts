import { syncWindowAppearance } from '@/ipc/settings'
import { resolveTheme, type Theme, type ResolvedTheme } from '@/stores/uiStore'

/** Apply the same preference as the pre-module bootstrap, without gating UI. */
export function watchAppTheme(theme: Theme, onResolved: (theme: ResolvedTheme) => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const resolved = resolveTheme(theme, media.matches)
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
    onResolved(resolved)
    if ('__TAURI_INTERNALS__' in window) {
      void syncWindowAppearance(theme, resolved === 'dark')
        .catch(error => console.warn('Unable to synchronize window theme', error))
    }
  }
  apply()
  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
}
