import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useUiStore } from '@/stores/uiStore'
import { useEditorStore } from '@/stores/editorStore'

export function NotificationBridge() {
  const { t } = useTranslation()
  const notifications = useUiStore((state) => state.notifications)
  const dismissNotification = useUiStore((state) => state.dismissNotification)

  useEffect(() => {
    for (const notification of notifications) {
      const description = notification.message
      const options = {
        id: notification.id,
        description,
        duration: notification.action ? 8000 : 5000,
        action: notification.action === 'credentialCleanup' ? {
          label: t('credentialCleanup.viewDetails'),
          onClick: () => {
            useUiStore.getState().setSettingsSection('diagnostics')
            const editor = useEditorStore.getState()
            const existing = editor.tabs.find(tab => tab.kind === 'settings')
            if (existing) editor.setActiveTab(existing.id)
            else editor.addTab({ id: crypto.randomUUID(), kind: 'settings', title: t('settings.title'), sql: '', connectionId: null })
          },
        } : undefined,
      }
      if (notification.kind === 'success') {
        toast.success(notification.title, options)
      } else if (notification.kind === 'error') {
        toast.error(notification.title, options)
      } else if (notification.kind === 'warning') {
        toast.warning(notification.title, options)
      } else {
        toast.info(notification.title, options)
      }
      dismissNotification(notification.id)
    }
  }, [dismissNotification, notifications, t])

  return createPortal(<Toaster richColors closeButton />, document.body)
}
