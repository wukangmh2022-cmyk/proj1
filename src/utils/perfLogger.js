const PERF_LOG_ENDPOINT = 'http://47.108.203.64:5000/log';
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
    try {
        const raw = localStorage.getItem(DIAG_LOCAL_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.push({ t: Date.now(), text });
        if (list.length > DIAG_LOCAL_MAX) list.splice(0, list.length - DIAG_LOCAL_MAX);
        localStorage.setItem(DIAG_LOCAL_KEY, JSON.stringify(list));
    } catch (_) {}
};

const appendNativeDiag = async (text) => {
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
    console.log(...args);
    const text = args.map(safeStringify).join(' ');
    // Always keep a local ring-buffer so we can inspect after a gray-screen resume.
    appendLocalDiag(text);
    // Best-effort native file log (doesn't rely on network).
    appendNativeDiag(text);
    postPerfLog(text);
};
