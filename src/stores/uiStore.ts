import { create } from 'zustand'

type Theme = 'light' | 'dark' | 'system'

interface UiState {
  theme: Theme
  sidebarWidth: number
  bottomPanelHeight: number
  setTheme: (theme: Theme) => void
  setSidebarWidth: (width: number) => void
  setBottomPanelHeight: (height: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  sidebarWidth: 256,
  bottomPanelHeight: 240,
  setTheme: (theme) => set({ theme }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
}))