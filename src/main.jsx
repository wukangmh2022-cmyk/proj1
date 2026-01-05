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

// Resume watchdog: if WebView/renderer resumes but doesn't paint within a short timeout,
// force a reload to recover from long gray-screen hangs on Android.
if (Capacitor.isNativePlatform()) {
  const MIN_BACKGROUND_MS = 30_000; // only arm after longer background/lock
  const WATCHDOG_MS = 4_000; // if no rAF within this, reload
  let hiddenAt = null;
  let watchdogTimer = null;

  const canReloadNow = () => {
    try {
      const now = Date.now();
      const lastAt = Number(sessionStorage.getItem('resume_reload_at') || 0);
      const lastCount = Number(sessionStorage.getItem('resume_reload_count') || 0);
      if (now - lastAt < 120_000) {
        if (lastCount >= 2) return false; // avoid reload loops
        sessionStorage.setItem('resume_reload_at', String(now));
        sessionStorage.setItem('resume_reload_count', String(lastCount + 1));
        return true;
      }
      sessionStorage.setItem('resume_reload_at', String(now));
      sessionStorage.setItem('resume_reload_count', '1');
      return true;
    } catch {
      return true;
    }
  };

  const armWatchdog = () => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    let painted = false;
    requestAnimationFrame(() => {
      painted = true;
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = null;
      perfLog('[perf] resume watchdog: first paint at', Date.now());
    });
    watchdogTimer = setTimeout(() => {
      if (painted) return;
      if (!canReloadNow()) {
        perfLog('[perf] resume watchdog: reload suppressed (loop guard) at', Date.now());
        return;
      }
      perfLog('[perf] resume watchdog: reloading at', Date.now());
      window.location.reload();
    }, WATCHDOG_MS);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      return;
    }
    const now = Date.now();
    const bg = hiddenAt ? (now - hiddenAt) : 0;
    hiddenAt = null;
    if (bg >= MIN_BACKGROUND_MS) {
      perfLog('[perf] resume watchdog: arm, backgroundMs=', bg, 'at', now);
      armWatchdog();
    }
  }, { passive: true });
}
