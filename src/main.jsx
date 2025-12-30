import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
