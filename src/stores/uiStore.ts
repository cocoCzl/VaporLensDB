import { create } from 'zustand'
import type { AppError } from '@/types/error'

type Theme = 'light' | 'dark' | 'system'
type NotificationKind = 'success' | 'error' | 'info' | 'warning'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  message?: string
}

interface UiState {
  theme: Theme
  sidebarWidth: number
  bottomPanelHeight: number
  notifications: AppNotification[]
  setTheme: (theme: Theme) => void
  setSidebarWidth: (width: number) => void
  setBottomPanelHeight: (height: number) => void
  notify: (notification: Omit<AppNotification, 'id'>) => void
  notifyError: (error: AppError, title?: string) => void
  dismissNotification: (id: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  sidebarWidth: 256,
  bottomPanelHeight: 240,
  notifications: [],
  setTheme: (theme) => set({ theme }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
  notify: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...notification, id: crypto.randomUUID() },
      ],
    })),
  notifyError: (error, title = '操作失败') =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          id: crypto.randomUUID(),
          kind: 'error',
          title,
          message: error.detail ? `${error.message}\n${error.detail}` : error.message,
        },
      ],
    })),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),
}))
