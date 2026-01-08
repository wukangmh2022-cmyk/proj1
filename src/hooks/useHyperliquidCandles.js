import { useEffect, useMemo, useRef, useState } from 'react';
import { SMA, EMA } from 'technicalindicators';

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

const toHlCoin = (symbol) => {
    if (!symbol) return null;
    const s = String(symbol).trim().toUpperCase();
    const base = s.endsWith('.P') ? s.slice(0, -2) : s;
    if (base.endsWith('USDT')) return base.slice(0, -4);
    if (base.endsWith('USD')) return base.slice(0, -3);
    return base;
};

const intervalToMs = (interval) => {
    if (!interval) return 60_000;
    const s = String(interval).trim();
    const unit = s.slice(-1);
    const n = parseInt(s.slice(0, -1), 10);
    const v = Number.isFinite(n) && n > 0 ? n : 1;
    if (unit === 'm') return v * 60_000;
    if (unit === 'h') return v * 3_600_000;
    if (unit === 'd') return v * 86_400_000;
    if (unit === 'w') return v * 7 * 86_400_000;
    return 60_000;
};

// subscriptions: [{ symbol: 'BTCUSDT', interval: '1m' }, ...]
export const useHyperliquidCandles = (subscriptions = []) => {
    const [candleData, setCandleData] = useState({});
    const wsRef = useRef(null);
    const historyLoadedRef = useRef(new Set()); // key: `${coin}_${interval}`
    const historyRef = useRef({}); // key: `${symbol}_${interval}` -> closes[]
    const lastOpenRef = useRef({}); // key: `${coin}_${interval}` -> last openTimeMs
    const lastCloseRef = useRef({}); // key: `${coin}_${interval}` -> last close
    const lastEmitAtRef = useRef({}); // key: `${symbol}_${interval}` -> ms

    const normalizedSubs = useMemo(() => {
        const list = (subscriptions || []).filter(s => s && s.symbol && s.interval);
        list.sort((a, b) => (a.symbol + a.interval).localeCompare(b.symbol + b.interval));
        return list;
    }, [subscriptions]);

    const subKey = useMemo(() => JSON.stringify(normalizedSubs), [normalizedSubs]);

    // Initial history load (HTTP candleSnapshot)
    useEffect(() => {
        normalizedSubs.forEach(({ symbol, interval }) => {
            const coin = toHlCoin(symbol);
            if (!coin) return;
            const coinKey = `${coin}_${interval}`;
            if (historyLoadedRef.current.has(coinKey)) return;

            const intervalMs = intervalToMs(interval);
            const endTime = Date.now() + 2_000;
            const startTime = endTime - Math.max(150, 110) * intervalMs;

            fetch(HL_INFO_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'candleSnapshot',
                    req: { coin, interval, startTime, endTime },
                }),
            })
                .then(res => res.json())
                .then((data) => {
                    if (!Array.isArray(data) || data.length === 0) return;
                    data.sort((a, b) => (a.t || 0) - (b.t || 0));
                    const closes = data.map(c => parseFloat(c.c)).filter(v => Number.isFinite(v));
                    if (closes.length < 2) return;

                    // Seed per-symbol history (even if multiple symbols map to same coin, keep per-symbol key)
                    const key = `${symbol}_${interval}`;
                    historyRef.current[key] = closes.slice(-150);

                    const last = data[data.length - 1];
                    if (last && typeof last.t === 'number') {
                        lastOpenRef.current[coinKey] = last.t;
                    }
                    if (last && last.c != null) {
                        const lc = parseFloat(last.c);
                        if (Number.isFinite(lc)) lastCloseRef.current[coinKey] = lc;
                    }

                    // Emit an initial snapshot as "not closed"
                    updateIndicators(symbol, interval, closes[closes.length - 1], false, last?.t ?? Date.now(), false);
                    historyLoadedRef.current.add(coinKey);
                })
                .catch(() => {});
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subKey]);

    // WS subscriptions for realtime candles
    useEffect(() => {
        if (normalizedSubs.length === 0) return;

        if (wsRef.current) {
            try { wsRef.current.close(); } catch {}
            wsRef.current = null;
        }

        const ws = new WebSocket(HL_WS_URL);
        wsRef.current = ws;

        const coinIntervalToSymbols = new Map();
        normalizedSubs.forEach(({ symbol, interval }) => {
            const coin = toHlCoin(symbol);
            if (!coin) return;
            const k = `${coin}_${interval}`;
            const list = coinIntervalToSymbols.get(k) || [];
            list.push(symbol);
            coinIntervalToSymbols.set(k, list);
        });

        ws.onopen = () => {
            coinIntervalToSymbols.forEach((_, k) => {
                const [coin, interval] = k.split('_');
                ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin, interval } }));
            });
        };

        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (!msg || msg.channel !== 'candle' || !msg.data) return;
            const c = msg.data;
            const coin = c.s;
            const interval = c.i;
            const openTime = c.t;
            const close = parseFloat(c.c);
            if (!coin || !interval || !Number.isFinite(openTime) || !Number.isFinite(close)) return;

            const coinKey = `${coin}_${interval}`;
            const prevOpen = lastOpenRef.current[coinKey];
            const prevClose = lastCloseRef.current[coinKey];

            const symbols = coinIntervalToSymbols.get(coinKey);
            if (!symbols || symbols.length === 0) return;

            const isNewCandle = prevOpen != null && openTime > prevOpen;
            if (isNewCandle && Number.isFinite(prevClose)) {
                // Emit a synthetic "closed" tick for the previous candle.
                symbols.forEach((sym) => {
                    updateIndicators(sym, interval, prevClose, true, prevOpen, true);
                });
            }

            // Live update for current candle
            lastOpenRef.current[coinKey] = openTime;
            lastCloseRef.current[coinKey] = close;
            symbols.forEach((sym) => {
                updateIndicators(sym, interval, close, false, openTime, false);
            });
        };

        ws.onerror = () => {};
        ws.onclose = () => {};

        return () => {
            if (wsRef.current) {
                try { wsRef.current.close(); } catch {}
                wsRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subKey]);

    const updateIndicators = (symbol, interval, close, isHistoryAppend, openTimeMs, isClosed) => {
        const key = `${symbol}_${interval}`;
        const now = Date.now();
        const lastEmit = lastEmitAtRef.current[key] || 0;
        // Throttle high-frequency candle updates; alerts and UI don't need per-tick precision.
        if (!isClosed && now - lastEmit < 150) return;
        lastEmitAtRef.current[key] = now;

        if (!historyRef.current[key]) historyRef.current[key] = [];

        if (isHistoryAppend) {
            historyRef.current[key].push(close);
        } else {
            const lastIdx = historyRef.current[key].length - 1;
            if (lastIdx >= 0) historyRef.current[key][lastIdx] = close;
            else historyRef.current[key].push(close);
        }

        const prices = historyRef.current[key];
        if (!prices || prices.length < 2) return;
        if (prices.length > 180) historyRef.current[key] = prices.slice(-180);

        const out = {
            close: prices[prices.length - 1],
            prevClose: prices[prices.length - 2],
            isClosed,
            kline: { t: openTimeMs, x: isClosed, i: interval, s: symbol },
            sma7: SMA.calculate({ period: 7, values: prices }).pop(),
            sma25: SMA.calculate({ period: 25, values: prices }).pop(),
            sma99: SMA.calculate({ period: 99, values: prices }).pop(),
            ema7: EMA.calculate({ period: 7, values: prices }).pop(),
            ema25: EMA.calculate({ period: 25, values: prices }).pop(),
            ema99: EMA.calculate({ period: 99, values: prices }).pop(),
        };

        setCandleData(prev => ({ ...prev, [key]: out }));
    };

    return candleData;
};

