import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

console.log('[perf] main.jsx loaded at', Date.now())

const rootEl = document.getElementById('root')
console.log('[perf] root element', !!rootEl, 'at', Date.now())

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
