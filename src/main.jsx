import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { Toast } from '@capacitor/toast'
import './index.css'
import App from './App.jsx'
import { perfLog, diagEnabled } from './utils/perfLogger'

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
  const WATCHDOG_MS = 1_200; // if no 2-frame paint within this, reload
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
    let painted2Frames = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        painted2Frames = true;
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = null;
        perfLog('[perf] resume watchdog: 2-frame paint at', Date.now());
        if (diagEnabled) Toast.show({ text: '恢复正常（已绘制）', duration: 'short' }).catch(() => {});
      });
    });
    watchdogTimer = setTimeout(() => {
      if (painted2Frames) return;
      if (!canReloadNow()) {
        perfLog('[perf] resume watchdog: reload suppressed (loop guard) at', Date.now());
        if (diagEnabled) Toast.show({ text: '恢复异常但已抑制重载', duration: 'short' }).catch(() => {});
        return;
      }
      perfLog('[perf] resume watchdog: reloading at', Date.now());
      if (diagEnabled) Toast.show({ text: '恢复超时，正在重载…', duration: 'short' }).catch(() => {});
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
