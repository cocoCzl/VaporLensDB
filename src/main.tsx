import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/geist/index.css'
import App from './App'
import './i18n'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
