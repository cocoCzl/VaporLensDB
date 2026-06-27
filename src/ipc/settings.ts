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
