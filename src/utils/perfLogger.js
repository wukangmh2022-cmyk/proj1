const PERF_LOG_ENDPOINT = 'http://47.108.203.64:5000/log';

// Build-time toggles (Vite):
// - VITE_DIAG=1: enable local diagnostics (native file + localStorage ring buffer)
// - VITE_PERF_REMOTE=1: enable remote perf log upload
// - VITE_PERF_CONSOLE=1: force console logging in prod
const DIAG_ENABLED = 1;
const REMOTE_ENABLED = 0;
const CONSOLE_ENABLED = 0;

let diagnosticsPlugin = null;
let isNative = null;
const DIAG_LOCAL_KEY = 'amaze_diag_js';
const DIAG_LOCAL_MAX = 200;

const safeStringify = (value) => {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
};

const postPerfLog = (text) => {
    if (!REMOTE_ENABLED) return;
    if (!text) return;
    if (typeof fetch !== 'function') return;
    try {
        fetch(PERF_LOG_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            keepalive: true
        }).catch(() => {});
    } catch (_) {
        // Ignore logging transport failures.
    }
};

const appendLocalDiag = (text) => {
    if (!DIAG_ENABLED) return;
    try {
        const raw = localStorage.getItem(DIAG_LOCAL_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.push({ t: Date.now(), text });
        if (list.length > DIAG_LOCAL_MAX) list.splice(0, list.length - DIAG_LOCAL_MAX);
        localStorage.setItem(DIAG_LOCAL_KEY, JSON.stringify(list));
    } catch (_) {}
};

const appendNativeDiag = async (text) => {
    if (!DIAG_ENABLED) return;
    try {
        if (isNative === null) {
            const mod = await import('@capacitor/core');
            isNative = !!mod.Capacitor?.isNativePlatform?.();
        }
        if (!isNative) return;
        if (!diagnosticsPlugin) {
            diagnosticsPlugin = (await import('../plugins/Diagnostics')).default;
        }
        diagnosticsPlugin.appendLog({ text }).catch(() => {});
    } catch (_) {}
};

export const perfLog = (...args) => {
    if (!CONSOLE_ENABLED && !REMOTE_ENABLED && !DIAG_ENABLED) return;
    if (CONSOLE_ENABLED) console.log(...args);
    const text = args.map(safeStringify).join(' ');
    appendLocalDiag(text);
    // Best-effort native file log (doesn't rely on network).
    appendNativeDiag(text);
    postPerfLog(text);
};
