import { create } from 'zustand'
import i18n from '@/i18n'
import type { AppError } from '@/types/error'

type Theme = 'light' | 'dark' | 'system'
type SidebarView = 'explorer' | 'dataSources'
type NotificationKind = 'success' | 'error' | 'info' | 'warning'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  message?: string
}

const THEME_STORAGE_KEY = 'vaporlensdb.theme'
const SETTINGS_STORAGE_KEY = 'vaporlensdb.settings'
// Dark is the product baseline; light remains a complete, switchable theme.
const DEFAULT_THEME: Theme = 'dark'
const DEFAULT_QUERY_MAX_ROWS = 5_000
export const MAX_INTERACTIVE_RESULT_ROWS = 50_000
const DEFAULT_DATA_PREVIEW_ROWS = 200
const DEFAULT_EDITOR_FONT_SIZE = 13
const DEFAULT_MAX_LIVE_SESSIONS = 5
const DEFAULT_IDLE_RECLAIM_MINUTES = 30

interface UserSettings {
  queryMaxRows: number
  dataPreviewDefaultRows: number
  editorFontSize: number
  showSystemObjects: boolean
  sidebarWidth: number
  sidebarCollapsed: boolean
  bottomPanelHeight: number
  bottomPanelCollapsed: boolean
  exportDirectory: string | null
  maxLiveSessions: number
  idleReclaimMinutes: number | null
}

interface UiState {
  theme: Theme
  sidebarView: SidebarView
  sidebarWidth: number
  sidebarCollapsed: boolean
  bottomPanelHeight: number
  bottomPanelCollapsed: boolean
  queryMaxRows: number
  dataPreviewDefaultRows: number
  editorFontSize: number
  showSystemObjects: boolean
  exportDirectory: string | null
  maxLiveSessions: number
  idleReclaimMinutes: number | null
  notifications: AppNotification[]
  queryHistoryRequest: number
  setTheme: (theme: Theme) => void
  setSidebarView: (view: SidebarView) => void
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setBottomPanelHeight: (height: number) => void
  setBottomPanelCollapsed: (collapsed: boolean) => void
  setQueryMaxRows: (maxRows: number) => void
  setDataPreviewDefaultRows: (rows: number) => void
  setEditorFontSize: (fontSize: number) => void
  setShowSystemObjects: (showSystemObjects: boolean) => void
  setExportDirectory: (exportDirectory: string | null) => void
  setConnectionSessionPolicy: (maxLiveSessions: number, idleReclaimMinutes: number | null) => void
  requestQueryHistory: () => void
  notify: (notification: Omit<AppNotification, 'id'>) => void
  notifyError: (error: AppError, title?: string) => void
  dismissNotification: (id: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme: readStoredTheme(),
  ...readStoredSettings(),
  sidebarView: 'explorer',
  notifications: [],
  queryHistoryRequest: 0,
  setTheme: (theme) => {
    writeStoredTheme(theme)
    set({ theme })
  },
  setSidebarView: (sidebarView) => set({ sidebarView }),
  setSidebarWidth: (sidebarWidth) =>
    set((state) => {
      const next = {
        ...settingsFromState(state),
        sidebarWidth: clampNumber(sidebarWidth, 232, 460, 288),
      }
      writeStoredSettings(next)
      return { sidebarWidth: next.sidebarWidth }
    }),
  setSidebarCollapsed: (sidebarCollapsed) =>
    set((state) => {
      const next = { ...settingsFromState(state), sidebarCollapsed }
      writeStoredSettings(next)
      return { sidebarCollapsed }
    }),
  setBottomPanelHeight: (bottomPanelHeight) =>
    set((state) => {
      const next = {
        ...settingsFromState(state),
        bottomPanelHeight: clampNumber(bottomPanelHeight, 160, 800, 260),
      }
      writeStoredSettings(next)
      return { bottomPanelHeight: next.bottomPanelHeight }
    }),
  setBottomPanelCollapsed: (bottomPanelCollapsed) =>
    set((state) => {
      const next = { ...settingsFromState(state), bottomPanelCollapsed }
      writeStoredSettings(next)
      return { bottomPanelCollapsed }
    }),
  setQueryMaxRows: (queryMaxRows) =>
    set((state) => {
      const next = {
        ...settingsFromState(state),
        queryMaxRows: clampNumber(queryMaxRows, 100, MAX_INTERACTIVE_RESULT_ROWS),
      }
      writeStoredSettings(next)
      return { queryMaxRows: next.queryMaxRows }
    }),
  setDataPreviewDefaultRows: (dataPreviewDefaultRows) =>
    set((state) => {
      const next = {
        ...settingsFromState(state),
        dataPreviewDefaultRows: clampNumber(dataPreviewDefaultRows, 1, 10_000),
      }
      writeStoredSettings(next)
      return { dataPreviewDefaultRows: next.dataPreviewDefaultRows }
    }),
  setEditorFontSize: (editorFontSize) =>
    set((state) => {
      const next = {
        ...settingsFromState(state),
        editorFontSize: clampNumber(editorFontSize, 10, 24),
      }
      writeStoredSettings(next)
      return { editorFontSize: next.editorFontSize }
    }),
  setShowSystemObjects: (showSystemObjects) =>
    set((state) => {
      const next = { ...settingsFromState(state), showSystemObjects }
      writeStoredSettings(next)
      return { showSystemObjects }
    }),
  setExportDirectory: (exportDirectory) =>
    set((state) => {
      const next = { ...settingsFromState(state), exportDirectory }
      writeStoredSettings(next)
      return { exportDirectory }
    }),
  setConnectionSessionPolicy: (maxLiveSessions, idleReclaimMinutes) => set((state) => {
    const next = { ...settingsFromState(state), maxLiveSessions: clampNumber(maxLiveSessions, 1, 20, DEFAULT_MAX_LIVE_SESSIONS), idleReclaimMinutes: idleReclaimMinutes === null ? null : clampNumber(idleReclaimMinutes, 5, 120, DEFAULT_IDLE_RECLAIM_MINUTES) }
    writeStoredSettings(next)
    return { maxLiveSessions: next.maxLiveSessions, idleReclaimMinutes: next.idleReclaimMinutes }
  }),
  requestQueryHistory: () =>
    set((state) => ({ queryHistoryRequest: state.queryHistoryRequest + 1 })),
  notify: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...notification, id: crypto.randomUUID() },
      ],
    })),
  notifyError: (error, title = i18n.t('notifications.operationFailed')) =>
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
    return {
      queryMaxRows: DEFAULT_QUERY_MAX_ROWS,
      dataPreviewDefaultRows: DEFAULT_DATA_PREVIEW_ROWS,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      showSystemObjects: false,
      sidebarWidth: 288,
      sidebarCollapsed: false,
      bottomPanelHeight: 260,
      bottomPanelCollapsed: false,
      exportDirectory: null,
      maxLiveSessions: DEFAULT_MAX_LIVE_SESSIONS,
      idleReclaimMinutes: DEFAULT_IDLE_RECLAIM_MINUTES,
    }
  }

  try {
    const value = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : {}
    return {
      queryMaxRows: clampNumber(parsed.queryMaxRows, 100, MAX_INTERACTIVE_RESULT_ROWS, DEFAULT_QUERY_MAX_ROWS),
      dataPreviewDefaultRows: clampNumber(
        parsed.dataPreviewDefaultRows,
        1,
        10_000,
        DEFAULT_DATA_PREVIEW_ROWS,
      ),
      editorFontSize: clampNumber(parsed.editorFontSize, 10, 24, DEFAULT_EDITOR_FONT_SIZE),
      showSystemObjects: parsed.showSystemObjects === true,
      sidebarWidth: clampNumber(parsed.sidebarWidth, 232, 460, 288),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      bottomPanelHeight: clampNumber(parsed.bottomPanelHeight, 160, 800, 260),
      bottomPanelCollapsed: parsed.bottomPanelCollapsed === true,
      exportDirectory: typeof parsed.exportDirectory === 'string' && parsed.exportDirectory.trim()
        ? parsed.exportDirectory
        : null,
      maxLiveSessions: clampNumber(parsed.maxLiveSessions, 1, 20, DEFAULT_MAX_LIVE_SESSIONS),
      idleReclaimMinutes: parsed.idleReclaimMinutes === null ? null : clampNumber(parsed.idleReclaimMinutes, 5, 120, DEFAULT_IDLE_RECLAIM_MINUTES),
    }
  } catch {
    return {
      queryMaxRows: DEFAULT_QUERY_MAX_ROWS,
      dataPreviewDefaultRows: DEFAULT_DATA_PREVIEW_ROWS,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      showSystemObjects: false,
      sidebarWidth: 288,
      sidebarCollapsed: false,
      bottomPanelHeight: 260,
      bottomPanelCollapsed: false,
      exportDirectory: null,
      maxLiveSessions: DEFAULT_MAX_LIVE_SESSIONS,
      idleReclaimMinutes: DEFAULT_IDLE_RECLAIM_MINUTES,
    }
  }
}

function settingsFromState(state: Pick<UiState, 'queryMaxRows' | 'dataPreviewDefaultRows' | 'editorFontSize' | 'showSystemObjects' | 'sidebarWidth' | 'sidebarCollapsed' | 'bottomPanelHeight' | 'bottomPanelCollapsed' | 'exportDirectory' | 'maxLiveSessions' | 'idleReclaimMinutes'>): UserSettings {
  return {
    queryMaxRows: state.queryMaxRows,
    dataPreviewDefaultRows: state.dataPreviewDefaultRows,
    editorFontSize: state.editorFontSize,
    showSystemObjects: state.showSystemObjects,
    sidebarWidth: state.sidebarWidth,
    sidebarCollapsed: state.sidebarCollapsed,
    bottomPanelHeight: state.bottomPanelHeight,
    bottomPanelCollapsed: state.bottomPanelCollapsed,
    exportDirectory: state.exportDirectory,
    maxLiveSessions: state.maxLiveSessions,
    idleReclaimMinutes: state.idleReclaimMinutes,
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
