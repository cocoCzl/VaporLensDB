import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useUiStore } from '@/stores/uiStore'

export function NotificationBridge() {
  const notifications = useUiStore((state) => state.notifications)
  const dismissNotification = useUiStore((state) => state.dismissNotification)

  useEffect(() => {
    for (const notification of notifications) {
      const description = notification.message
      if (notification.kind === 'success') {
        toast.success(notification.title, { description })
      } else if (notification.kind === 'error') {
        toast.error(notification.title, { description })
      } else if (notification.kind === 'warning') {
        toast.warning(notification.title, { description })
      } else {
        toast.info(notification.title, { description })
      }
      dismissNotification(notification.id)
    }
  }, [dismissNotification, notifications])

  return <Toaster richColors closeButton />
}
