import { listen } from '@tauri-apps/api/event'
import { applicationCloseListenerReady, applicationCloseRequestFinished } from '@/ipc/lifecycle'
import { requestApplicationClose } from '@/lib/applicationClose'

export function subscribeApplicationCloseRequests() {
  let unlisten: (() => void) | undefined
  let disposed = false
  void listen('vaporlensdb:request-application-close', () => {
    void requestApplicationClose().finally(applicationCloseRequestFinished).catch(() => {})
  }).then(async (dispose) => {
    if (disposed) {
      dispose()
      return
    }
    unlisten = dispose
    await applicationCloseListenerReady()
  }).catch(() => {})
  return () => {
    disposed = true
    unlisten?.()
  }
}
