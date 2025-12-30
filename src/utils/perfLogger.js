const PERF_LOG_ENDPOINT = 'http://47.108.203.64:5000/log';

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

export const perfLog = (...args) => {
    console.log(...args);
    const text = args.map(safeStringify).join(' ');
    postPerfLog(text);
};
