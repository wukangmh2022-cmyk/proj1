import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'
import { perfLog } from './utils/perfLogger'

perfLog('[perf] main.jsx loaded at', Date.now())

const rootEl = document.getElementById('root')
perfLog('[perf] root element', !!rootEl, 'at', Date.now())

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Helps diagnose "gray blank" resumes where WebView is alive but UI not painting yet.
requestAnimationFrame(() => perfLog('[perf] first rAF after render call at', Date.now()))
