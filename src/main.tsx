import React from 'react'
import ReactDOM from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import App from './App'
import './styles/globals.css'
import zh from './locales/zh.json'
import en from './locales/en.json'

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: 'zh',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)