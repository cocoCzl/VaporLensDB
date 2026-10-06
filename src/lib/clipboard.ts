import { isTauri } from '@tauri-apps/api/core'
import { writeText as writeNativeClipboardText } from '@tauri-apps/plugin-clipboard-manager'
import i18n from '@/i18n'
import { useUiStore } from '@/stores/uiStore'

export async function copyToClipboard(
  value: string,
  failureMessageKey: 'notifications.clipboardCopyFailed' | 'inspector.copyDdlFailed' = 'notifications.clipboardCopyFailed',
): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && (isTauri() || '__TAURI_INTERNALS__' in window)) {
      await writeNativeClipboardText(value)
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // The selection fallback can recover from native/browser clipboard failures.
  }
  try {
    if (copyWithSelection(value)) return true
  } catch {
    // Report only the final outcome, without clipboard contents or raw errors.
  }
  useUiStore.getState().notify({
    kind: 'error',
    title: i18n.t('notifications.copyFailed'),
    message: i18n.t(failureMessageKey),
  })
  return false
}

function copyWithSelection(value: string) {
  const focusedElement = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;'
  try {
    document.body.appendChild(textarea)
    textarea.select()
    return document.execCommand('copy')
  } finally {
    textarea.remove()
    if (focusedElement instanceof HTMLElement && focusedElement.isConnected) {
      focusedElement.focus({ preventScroll: true })
    }
  }
}
