const PERF_LOG_ENDPOINT = 'http://47.108.203.64:5000/log';

// Build-time toggles (Vite):
// - VITE_DIAG=1: enable local diagnostics (native file + localStorage ring buffer)
// - VITE_PERF_REMOTE=1: enable remote perf log upload
// - VITE_PERF_CONSOLE=1: force console logging in prod
// Disable diagnostics to avoid perf impact during interactions
const DIAG_ENABLED = 1;
const REMOTE_ENABLED = 0;
const CONSOLE_ENABLED = 0;

export const diagEnabled = !!DIAG_ENABLED;

let diagnosticsPlugin = null;
let isNative = null;
const DIAG_LOCAL_KEY = 'amaze_diag_js';
const DIAG_LOCAL_MAX = 200;
let pending = null; // { items: Array<{t:number,text:string}> }
let flushTimer = null;

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
    // Batch writes to avoid localStorage churn during UI interactions.
    if (!pending) pending = { items: [] };
    pending.items.push({ t: Date.now(), text });
    scheduleFlush();
};

const flushLocalDiag = (items) => {
    try {
        const raw = localStorage.getItem(DIAG_LOCAL_KEY);
        const list = raw ? JSON.parse(raw) : [];
        items.forEach(x => list.push(x));
        if (list.length > DIAG_LOCAL_MAX) list.splice(0, list.length - DIAG_LOCAL_MAX);
        localStorage.setItem(DIAG_LOCAL_KEY, JSON.stringify(list));
    } catch (_) {}
};

const appendNativeDiag = async (text) => {
    if (!DIAG_ENABLED) return;
    // Batched via scheduleFlush() to reduce bridge calls.
    appendLocalDiag(text);
};

const flushNativeDiag = async (items) => {
    try {
        if (isNative === null) {
            const mod = await import('@capacitor/core');
            isNative = !!mod.Capacitor?.isNativePlatform?.();
        }
        if (!isNative) return;
        if (!diagnosticsPlugin) {
            diagnosticsPlugin = (await import('../plugins/Diagnostics')).default;
        }
        // Send as one payload to reduce bridge overhead. Native side will prefix with one timestamp.
        diagnosticsPlugin.appendLog({ text: items.map(x => x.text).join('\n') }).catch(() => {});
    } catch (_) {}
};

const scheduleFlush = () => {
    if (!DIAG_ENABLED) return;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = pending;
        pending = null;
        if (!batch || !batch.items.length) return;
        // Local ring buffer
        flushLocalDiag(batch.items);
        // Native file (best-effort)
        flushNativeDiag(batch.items);
    }, 250);
};

export const perfLog = (...args) => {
    if (!CONSOLE_ENABLED && !REMOTE_ENABLED && !DIAG_ENABLED) return;
    if (CONSOLE_ENABLED) console.log(...args);
    const text = args.map(safeStringify).join(' ');
    appendLocalDiag(text);
    postPerfLog(text);
};
