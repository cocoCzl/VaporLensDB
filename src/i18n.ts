import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'
import { readStorageString } from './lib/safeStorage'

const supportedLanguages = new Set(['zh', 'en'])
const storedLanguage = readStorageString('vaporlensdb.language', (value): value is 'zh' | 'en' => supportedLanguages.has(value))

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: storedLanguage.value ?? 'zh',
  fallbackLng: 'en',
  supportedLngs: ['zh', 'en'],
  interpolation: { escapeValue: false },
})

export default i18n
