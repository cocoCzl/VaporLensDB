import { create } from 'zustand'
import type { AppError } from '@/types/error'

type Theme = 'light' | 'dark' | 'system'
type SidebarView = 'dataSources' | 'sql' | 'settings'
type NotificationKind = 'success' | 'error' | 'info' | 'warning'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  message?: string
}

const THEME_STORAGE_KEY = 'vaporlensdb.theme'
const SETTINGS_STORAGE_KEY = 'vaporlensdb.settings'
const DEFAULT_THEME: Theme = 'system'
const DEFAULT_QUERY_MAX_ROWS = 50_000
const DEFAULT_EDITOR_FONT_SIZE = 13

interface UserSettings {
  queryMaxRows: number
  editorFontSize: number
}

interface UiState {
  theme: Theme
  sidebarView: SidebarView
  sidebarWidth: number
  bottomPanelHeight: number
  queryMaxRows: number
  editorFontSize: number
  notifications: AppNotification[]
  setTheme: (theme: Theme) => void
  setSidebarView: (view: SidebarView) => void
  setSidebarWidth: (width: number) => void
  setBottomPanelHeight: (height: number) => void
  setQueryMaxRows: (maxRows: number) => void
  setEditorFontSize: (fontSize: number) => void
  notify: (notification: Omit<AppNotification, 'id'>) => void
  notifyError: (error: AppError, title?: string) => void
  dismissNotification: (id: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme: readStoredTheme(),
  ...readStoredSettings(),
  sidebarView: 'dataSources',
  sidebarWidth: 256,
  bottomPanelHeight: 240,
  notifications: [],
  setTheme: (theme) => {
    writeStoredTheme(theme)
    set({ theme })
  },
  setSidebarView: (sidebarView) => set({ sidebarView }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
  setQueryMaxRows: (queryMaxRows) =>
    set((state) => {
      const next = {
        queryMaxRows: clampNumber(queryMaxRows, 100, 1_000_000),
        editorFontSize: state.editorFontSize,
      }
      writeStoredSettings(next)
      return { queryMaxRows: next.queryMaxRows }
    }),
  setEditorFontSize: (editorFontSize) =>
    set((state) => {
      const next = {
        queryMaxRows: state.queryMaxRows,
        editorFontSize: clampNumber(editorFontSize, 10, 24),
      }
      writeStoredSettings(next)
      return { editorFontSize: next.editorFontSize }
    }),
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
          message: compactErrorMessage(error),
        },
      ],
    })),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),
}))

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME
  }

  const value = window.localStorage.getItem(THEME_STORAGE_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME
}

function writeStoredTheme(theme: Theme) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
}

function readStoredSettings(): UserSettings {
  if (typeof window === 'undefined') {
    return { queryMaxRows: DEFAULT_QUERY_MAX_ROWS, editorFontSize: DEFAULT_EDITOR_FONT_SIZE }
  }

  try {
    const value = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : {}
    return {
      queryMaxRows: clampNumber(parsed.queryMaxRows, 100, 1_000_000, DEFAULT_QUERY_MAX_ROWS),
      editorFontSize: clampNumber(parsed.editorFontSize, 10, 24, DEFAULT_EDITOR_FONT_SIZE),
    }
  } catch {
    return { queryMaxRows: DEFAULT_QUERY_MAX_ROWS, editorFontSize: DEFAULT_EDITOR_FONT_SIZE }
  }
}

function writeStoredSettings(settings: UserSettings) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

function compactErrorMessage(error: AppError) {
  const message = summarizeError(error.message)
  const detail = error.detail ? summarizeError(error.detail) : null
  return detail && detail !== message ? `${message}\n${detail}` : message
}

function summarizeError(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const noRoute = normalized.match(/No route to host[^.。]*/i)?.[0]
  if (noRoute) {
    return noRoute
  }

  const network = normalized.match(/The Network Adapter could not establish the connection/i)?.[0]
  if (network) {
    return network
  }

  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback = min,
) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}
