import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import FloatingWidget from '../plugins/FloatingWidget';
import { perfLog } from '../utils/perfLogger';

const BINANCE_SPOT_WS_ENDPOINTS = [
    'wss://stream.binance.com:9443/stream',
    'wss://stream.binance.com/stream',
    'wss://data-stream.binance.vision/stream',
];
const BINANCE_FUTURES_WS_ENDPOINTS = [
    'wss://fstream.binance.com/stream',
    'wss://fstream.binance.com:443/stream',
];
const DIAG_ENABLED = 1;
const TICKERS_CACHE_KEY = 'binance_tickers_cache_v1';
const DEV_REST_SPOT_BASE = '/binance-api/api/v3';
const DEV_REST_FUTURES_BASE = '/binance-fapi/fapi/v1';

/**
 * Hook to get real-time ticker data.
 * Supports both Spot (BTCUSDT) and Perpetual Futures (BTCUSDT.P)
 * On Android: receives data from native Service (must call FloatingWidget.startData first)
 * On Web: uses WebSocket directly
 */
export const useBinanceTickers = (symbols = []) => {
    const [tickers, setTickers] = useState(() => {
        try {
            const raw = localStorage.getItem(TICKERS_CACHE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    });
    const bufferRef = useRef({}); // Store latest data per symbol { symbol: { price, ... } }
    const wsSpotRef = useRef(null);
    const wsFuturesRef = useRef(null);
    const watchdogIntervalRef = useRef(null);
    const lastUpdateRef = useRef(Date.now());
    const listenerRef = useRef(null);
    const flushIntervalRef = useRef(null);
    const perfLoggedRef = useRef(false);
    const resumeHeartbeatRef = useRef(null);
    const lastPersistAtRef = useRef(0);

    const spotSymbolsRef = useRef([]);
    const futuresSymbolsRef = useRef([]);
    const spotEndpointIndexRef = useRef(0);
    const futuresEndpointIndexRef = useRef(0);
    const spotRetryRef = useRef(0);
    const futuresRetryRef = useRef(0);
    const spotReconnectTimerRef = useRef(null);
    const futuresReconnectTimerRef = useRef(null);

    const isNative = Capacitor.isNativePlatform();
    const canUseDevRestFallback = !isNative && (import.meta?.env?.DEV || location?.hostname === 'localhost' || location?.hostname === '127.0.0.1');
    useEffect(() => {
        if (perfLoggedRef.current) return;
        perfLoggedRef.current = true;
        perfLog('[perf] useBinanceTickers mount at', Date.now(), 'isNative=', isNative, 'symbols=', symbols);
        return () => {
            perfLog('[perf] useBinanceTickers unmount at', Date.now());
        };
        // Intentionally run once per hook instance to avoid noisy logs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Helper: Check if symbol is perpetual (.P suffix)
    const isPerpetual = (symbol) => symbol.endsWith('.P');
    const getBaseSymbol = (symbol) => isPerpetual(symbol) ? symbol.slice(0, -2) : symbol;

    // ===== UI UPDATE LOOP (Throttling) =====
    // Decouples high-frequency data (WS/Native) from React Rendering
    useEffect(() => {
        let timer = null;

        const flushUpdates = () => {
            if (Object.keys(bufferRef.current).length > 0) {
                setTickers(prev => {
                    // Merge buffer into previous state
                    const next = { ...prev, ...bufferRef.current };
                    bufferRef.current = {}; // Clear buffer
                    const now = Date.now();
                    if (now - lastPersistAtRef.current > 5000) {
                        lastPersistAtRef.current = now;
                        try {
                            localStorage.setItem(TICKERS_CACHE_KEY, JSON.stringify(next));
                        } catch { }
                    }
                    return next;
                });
            }
        };

        const startLoop = () => {
            if (timer) clearInterval(timer);
            // Flush every 200ms (5 FPS update rate for table is sufficient, 60FPS is waste for just numbers)
            timer = setInterval(flushUpdates, 200);
            flushIntervalRef.current = timer;
        };

        const stopLoop = () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        };

        // Initial Start
        startLoop();

        // Handle Background/Foreground
        const handleVisibilityChange = () => {
            if (document.hidden) {
                perfLog('[perf] visibilitychange hidden at', Date.now());
                stopLoop();
            } else {
                perfLog('[perf] visibilitychange visible at', Date.now(), 'isNative=', isNative);
                startLoop();
                if (DIAG_ENABLED) requestAnimationFrame(() => perfLog('[perf] visibilitychange visible rAF at', Date.now()));
                // On resume, if native, request fresh data
                if (isNative) requestAnimationFrame(() => FloatingWidget.requestTickerUpdate());
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            stopLoop();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isNative]);

    // ===== NATIVE MODE: Always listen to native events =====
    useEffect(() => {
        if (!isNative) return;

        perfLog('[perf] useBinanceTickers native listener setup at', Date.now(), 'symbols=', symbols);

        listenerRef.current = FloatingWidget.addListener('tickerUpdate', (data) => {
            const { symbol, price, changePercent } = data;

            // Update Buffer ONLY
            bufferRef.current[symbol] = {
                price: price,
                change: 0,
                changePercent: changePercent
            };
        });

        // Request update after first paint to reduce startup jank.
        const t = setTimeout(() => {
            perfLog('[perf] useBinanceTickers requestTickerUpdate at', Date.now());
            FloatingWidget.requestTickerUpdate();
        }, 0);

        return () => {
            clearTimeout(t);
            if (listenerRef.current) {
                listenerRef.current.remove();
            }
        };
    }, [isNative]);

    // ===== WEB MODE =====
    const scheduleSpotReconnect = (reason) => {
        if (spotReconnectTimerRef.current) clearTimeout(spotReconnectTimerRef.current);
        const attempt = ++spotRetryRef.current;
        if (attempt % 3 === 0) {
            spotEndpointIndexRef.current = (spotEndpointIndexRef.current + 1) % BINANCE_SPOT_WS_ENDPOINTS.length;
        }
        const base = 500;
        const delay = Math.min(15000, base * Math.pow(2, Math.min(attempt, 5))) + Math.floor(Math.random() * 250);
        perfLog('[perf] spot ws reconnect scheduled', 'attempt=', attempt, 'delay=', delay, 'reason=', reason || '');
        spotReconnectTimerRef.current = setTimeout(() => connectSpot(), delay);
    };

    const scheduleFuturesReconnect = (reason) => {
        if (futuresReconnectTimerRef.current) clearTimeout(futuresReconnectTimerRef.current);
        const attempt = ++futuresRetryRef.current;
        if (attempt % 3 === 0) {
            futuresEndpointIndexRef.current = (futuresEndpointIndexRef.current + 1) % BINANCE_FUTURES_WS_ENDPOINTS.length;
        }
        const base = 500;
        const delay = Math.min(15000, base * Math.pow(2, Math.min(attempt, 5))) + Math.floor(Math.random() * 250);
        perfLog('[perf] futures ws reconnect scheduled', 'attempt=', attempt, 'delay=', delay, 'reason=', reason || '');
        futuresReconnectTimerRef.current = setTimeout(() => connectFutures(), delay);
    };

    const connectSpot = () => {
        const spotSymbols = spotSymbolsRef.current || [];
        if (isNative || spotSymbols.length === 0) {
            if (wsSpotRef.current) {
                try { wsSpotRef.current.onclose = null; } catch { }
                try { wsSpotRef.current.close(); } catch { }
                wsSpotRef.current = null;
            }
            return;
        }
        if (wsSpotRef.current && wsSpotRef.current.readyState === WebSocket.OPEN) return;
        if (wsSpotRef.current) {
            try { wsSpotRef.current.close(); } catch { }
            wsSpotRef.current = null;
        }

        const endpoint = BINANCE_SPOT_WS_ENDPOINTS[spotEndpointIndexRef.current] || BINANCE_SPOT_WS_ENDPOINTS[0];
        const streams = spotSymbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `${endpoint}?streams=${streams}`;

        console.log('Connecting to Binance Spot WS...', url);
        const ws = new WebSocket(url);
        wsSpotRef.current = ws;

        ws.onopen = () => {
            console.log('Connected to Binance Spot WS');
            lastUpdateRef.current = Date.now();
            spotRetryRef.current = 0;
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.data) {
                    lastUpdateRef.current = Date.now();
                    const { s: symbol, c: closeStr, o: openStr } = message.data;

                    const price = parseFloat(closeStr);
                    const openPrice = parseFloat(openStr);
                    const changePrice = price - openPrice;
                    const changePercent = openPrice > 0 ? (changePrice / openPrice) * 100 : 0;

                    bufferRef.current[symbol] = {
                        price: price,
                        change: changePrice,
                        changePercent: changePercent
                    };
                }
            } catch (err) {
                console.error('Spot Parse Error', err);
            }
        };

        ws.onclose = () => {
            if (wsSpotRef.current === ws) wsSpotRef.current = null;
            console.log('Spot WS Disconnected. Scheduling reconnect...');
            scheduleSpotReconnect('close');
        };

        ws.onerror = (err) => {
            console.error('Spot WS Error:', err);
            try { ws.close(); } catch { }
        };
    };

    const connectFutures = () => {
        const futuresSymbols = futuresSymbolsRef.current || [];
        if (isNative || futuresSymbols.length === 0) {
            if (wsFuturesRef.current) {
                try { wsFuturesRef.current.onclose = null; } catch { }
                try { wsFuturesRef.current.close(); } catch { }
                wsFuturesRef.current = null;
            }
            return;
        }
        if (wsFuturesRef.current && wsFuturesRef.current.readyState === WebSocket.OPEN) return;
        if (wsFuturesRef.current) {
            try { wsFuturesRef.current.close(); } catch { }
            wsFuturesRef.current = null;
        }

        const baseSymbols = futuresSymbols.map(s => getBaseSymbol(s));
        const streams = baseSymbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const endpoint = BINANCE_FUTURES_WS_ENDPOINTS[futuresEndpointIndexRef.current] || BINANCE_FUTURES_WS_ENDPOINTS[0];
        const url = `${endpoint}?streams=${streams}`;

        console.log('Connecting to Binance Futures WS...', url);
        const ws = new WebSocket(url);
        wsFuturesRef.current = ws;

        ws.onopen = () => {
            console.log('Connected to Binance Futures WS');
            lastUpdateRef.current = Date.now();
            futuresRetryRef.current = 0;
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.data) {
                    lastUpdateRef.current = Date.now();
                    const { s: baseSymbol, c: closeStr, o: openStr } = message.data;

                    const price = parseFloat(closeStr);
                    const openPrice = parseFloat(openStr);
                    const changePrice = price - openPrice;
                    const changePercent = openPrice > 0 ? (changePrice / openPrice) * 100 : 0;

                    const displaySymbol = baseSymbol + '.P';
                    bufferRef.current[displaySymbol] = {
                        price: price,
                        change: changePrice,
                        changePercent: changePercent
                    };
                }
            } catch (err) {
                console.error('Futures Parse Error', err);
            }
        };

        ws.onclose = () => {
            if (wsFuturesRef.current === ws) wsFuturesRef.current = null;
            console.log('Futures WS Disconnected. Scheduling reconnect...');
            scheduleFuturesReconnect('close');
        };

        ws.onerror = (err) => {
            console.error('Futures WS Error:', err);
            try { ws.close(); } catch { }
        };
    };


    useEffect(() => {
        if (isNative) return; // Use native data on Android
        if (symbols.length === 0) return;

        // Separate spot and futures symbols
        const spotSymbols = symbols.filter(s => !isPerpetual(s));
        const futuresSymbols = symbols.filter(s => isPerpetual(s));

        spotSymbolsRef.current = spotSymbols;
        futuresSymbolsRef.current = futuresSymbols;

        connectSpot();
        connectFutures();

        // Dev-only REST fallback (via Vite proxy) to seed prices & cover WS-blocked networks.
        // This avoids CORS and keeps the UI usable when wss is unstable.
        let seedAbort = null;
        const seedPrices = async () => {
            if (!canUseDevRestFallback) return;
            try {
                if (seedAbort) seedAbort.abort();
                seedAbort = new AbortController();
                const updates = {};
                await Promise.all(spotSymbols.map(async (s) => {
                    try {
                        const res = await fetch(`${DEV_REST_SPOT_BASE}/ticker/24hr?symbol=${s}`, { signal: seedAbort.signal });
                        const json = await res.json();
                        const price = parseFloat(json.lastPrice);
                        const change = parseFloat(json.priceChange);
                        const changePercent = parseFloat(json.priceChangePercent);
                        if (!Number.isNaN(price)) {
                            updates[s] = {
                                price,
                                change: Number.isNaN(change) ? 0 : change,
                                changePercent: Number.isNaN(changePercent) ? 0 : changePercent
                            };
                        }
                    } catch (_) { }
                }));
                await Promise.all(futuresSymbols.map(async (s) => {
                    try {
                        const base = getBaseSymbol(s);
                        const res = await fetch(`${DEV_REST_FUTURES_BASE}/ticker/24hr?symbol=${base}`, { signal: seedAbort.signal });
                        const json = await res.json();
                        const price = parseFloat(json.lastPrice);
                        const change = parseFloat(json.priceChange);
                        const changePercent = parseFloat(json.priceChangePercent);
                        if (!Number.isNaN(price)) {
                            updates[s] = {
                                price,
                                change: Number.isNaN(change) ? 0 : change,
                                changePercent: Number.isNaN(changePercent) ? 0 : changePercent
                            };
                        }
                    } catch (_) { }
                }));
                if (Object.keys(updates).length > 0) {
                    setTickers(prev => {
                        const next = { ...prev };
                        Object.entries(updates).forEach(([sym, upd]) => {
                            const prevVal = next[sym];
                            if (prevVal && prevVal.changePercent && (!upd.changePercent && !upd.change)) {
                                next[sym] = { ...prevVal, price: upd.price };
                            } else {
                                next[sym] = upd;
                            }
                        });
                        return next;
                    });
                }
            } catch (_) { }
        };
        seedPrices();

        let fallbackTimer = null;
        const fetchMissing = async () => {
            if (!canUseDevRestFallback) return;
            // Only kick in when WS is not updating, to reduce load.
            if (Date.now() - lastUpdateRef.current < 5000) return;
            const missing = symbols.filter(s => !Object.prototype.hasOwnProperty.call(tickers, s));
            if (missing.length === 0) return;
            const updates = {};
            await Promise.all(missing.map(async (s) => {
                const isPerp = isPerpetual(s);
                const base = getBaseSymbol(s);
                const url = isPerp
                    ? `${DEV_REST_FUTURES_BASE}/ticker/24hr?symbol=${base}`
                    : `${DEV_REST_SPOT_BASE}/ticker/24hr?symbol=${s}`;
                try {
                    const res = await fetch(url);
                    const json = await res.json();
                    const price = parseFloat(json.lastPrice);
                    const change = parseFloat(json.priceChange);
                    const changePercent = parseFloat(json.priceChangePercent);
                    if (!Number.isNaN(price)) {
                        updates[s] = {
                            price,
                            change: Number.isNaN(change) ? 0 : change,
                            changePercent: Number.isNaN(changePercent) ? 0 : changePercent
                        };
                    }
                } catch (_) { }
            }));
            if (Object.keys(updates).length > 0) {
                setTickers(prev => ({ ...prev, ...updates }));
            }
        };
        fallbackTimer = setInterval(fetchMissing, 8000);

        watchdogIntervalRef.current = setInterval(() => {
            const now = Date.now();
            const timeSinceLastUpdate = now - lastUpdateRef.current;

            if (timeSinceLastUpdate > 10000) {
                console.warn(`No data for ${timeSinceLastUpdate}ms. Forcing reconnect...`);
                lastUpdateRef.current = Date.now();
                if (wsSpotRef.current) wsSpotRef.current.close();
                if (wsFuturesRef.current) wsFuturesRef.current.close();
                scheduleSpotReconnect('watchdog');
                scheduleFuturesReconnect('watchdog');
            }
        }, 5000);

        return () => {
            if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
            if (spotReconnectTimerRef.current) clearTimeout(spotReconnectTimerRef.current);
            if (futuresReconnectTimerRef.current) clearTimeout(futuresReconnectTimerRef.current);
            if (fallbackTimer) clearInterval(fallbackTimer);
            if (seedAbort) seedAbort.abort();
            if (wsSpotRef.current) {
                wsSpotRef.current.onclose = null;
                wsSpotRef.current.close();
            }
            if (wsFuturesRef.current) {
                wsFuturesRef.current.onclose = null;
                wsFuturesRef.current.close();
            }
        };
    }, [JSON.stringify(symbols), isNative]);

    return tickers;
};
