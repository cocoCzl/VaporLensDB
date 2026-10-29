import { invokeCommand } from '@/ipc/client'
import { COMMANDS } from '@/ipc/contracts'

export type ApplicationMenuLanguage = 'zh' | 'en'

export function setApplicationMenuLanguage(language: ApplicationMenuLanguage) {
  return invokeCommand<void>(COMMANDS.setApplicationMenuLanguage, {
    input: { language },
  })
}

export function normalizedApplicationMenuLanguage(language: string): ApplicationMenuLanguage {
  return language.startsWith('en') ? 'en' : 'zh'
}

/** Nonblocking mirror of the existing UI preference for pre-WebView appearance. */
export function syncWindowAppearance(theme: 'light' | 'dark' | 'system', dark: boolean) {
  return invokeCommand<void>(COMMANDS.syncWindowAppearance, { theme, dark })
}
