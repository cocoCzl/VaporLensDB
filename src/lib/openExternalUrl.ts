import { open } from '@tauri-apps/plugin-shell'

export async function openExternalUrl(url: string | null | undefined) {
  if (!url) return
  try {
    await open(url)
  } catch (error) {
    const popup = window.open(url, '_blank', 'noopener,noreferrer')
    if (!popup) {
      throw error
    }
  }
}
