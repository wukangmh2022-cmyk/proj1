import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import FloatingWidget from '../plugins/FloatingWidget';
import { perfLog } from '../utils/perfLogger';

const BINANCE_SPOT_WS = 'wss://stream.binance.com:9443/stream';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/stream';
const DIAG_ENABLED = 1;

/**
 * Hook to get real-time ticker data.
 * Supports both Spot (BTCUSDT) and Perpetual Futures (BTCUSDT.P)
 * On Android: receives data from native Service (must call FloatingWidget.startData first)
 * On Web: uses WebSocket directly
 */
export const useBinanceTickers = (symbols = []) => {
    const [tickers, setTickers] = useState({});
    const bufferRef = useRef({}); // Store latest data per symbol { symbol: { price, ... } }
    const wsSpotRef = useRef(null);
    const wsFuturesRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const watchdogIntervalRef = useRef(null);
    const lastUpdateRef = useRef(Date.now());
    const listenerRef = useRef(null);
    const flushIntervalRef = useRef(null);
    const perfLoggedRef = useRef(false);
    const resumeHeartbeatRef = useRef(null);

    const isNative = Capacitor.isNativePlatform();
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
    const connectSpot = (spotSymbols) => {
        if (isNative || spotSymbols.length === 0) return;
        if (wsSpotRef.current && wsSpotRef.current.readyState === WebSocket.OPEN) return;
        if (wsSpotRef.current) wsSpotRef.current.close();

        const streams = spotSymbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `${BINANCE_SPOT_WS}?streams=${streams}`;

        console.log('Connecting to Binance Spot WS...');
        wsSpotRef.current = new WebSocket(url);

        wsSpotRef.current.onopen = () => {
            console.log('Connected to Binance Spot WS');
            lastUpdateRef.current = Date.now();
        };

        wsSpotRef.current.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.data) {
                    lastUpdateRef.current = Date.now();
                    const { s: symbol, c: closeStr, o: openStr } = message.data;

                    const price = parseFloat(closeStr);
                    const openPrice = parseFloat(openStr);
                    const changePrice = price - openPrice;
                    const changePercent = openPrice > 0 ? (changePrice / openPrice) * 100 : 0;

                    // Update Buffer (use original symbol name)
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

        wsSpotRef.current.onclose = () => {
            console.log('Spot WS Disconnected. Scheduling reconnect...');
            setTimeout(() => connectSpot(spotSymbols), 3000);
        };

        wsSpotRef.current.onerror = (err) => {
            console.error('Spot WS Error:', err);
            wsSpotRef.current.close();
        };
    };

    const connectFutures = (futuresSymbols) => {
        if (isNative || futuresSymbols.length === 0) return;
        if (wsFuturesRef.current && wsFuturesRef.current.readyState === WebSocket.OPEN) return;
        if (wsFuturesRef.current) wsFuturesRef.current.close();

        // Remove .P suffix for API
        const baseSymbols = futuresSymbols.map(s => getBaseSymbol(s));
        const streams = baseSymbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `${BINANCE_FUTURES_WS}?streams=${streams}`;

        console.log('Connecting to Binance Futures WS...');
        wsFuturesRef.current = new WebSocket(url);

        wsFuturesRef.current.onopen = () => {
            console.log('Connected to Binance Futures WS');
            lastUpdateRef.current = Date.now();
        };

        wsFuturesRef.current.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.data) {
                    lastUpdateRef.current = Date.now();
                    const { s: baseSymbol, c: closeStr, o: openStr } = message.data;

                    const price = parseFloat(closeStr);
                    const openPrice = parseFloat(openStr);
                    const changePrice = price - openPrice;
                    const changePercent = openPrice > 0 ? (changePrice / openPrice) * 100 : 0;

                    // Update Buffer (add .P suffix back)
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

        wsFuturesRef.current.onclose = () => {
            console.log('Futures WS Disconnected. Scheduling reconnect...');
            setTimeout(() => connectFutures(futuresSymbols), 3000);
        };

        wsFuturesRef.current.onerror = (err) => {
            console.error('Futures WS Error:', err);
            wsFuturesRef.current.close();
        };
    };


    useEffect(() => {
        if (isNative) return; // Use native data on Android
        if (symbols.length === 0) return;

        // Separate spot and futures symbols
        const spotSymbols = symbols.filter(s => !isPerpetual(s));
        const futuresSymbols = symbols.filter(s => isPerpetual(s));

        connectSpot(spotSymbols);
        connectFutures(futuresSymbols);

        watchdogIntervalRef.current = setInterval(() => {
            const now = Date.now();
            const timeSinceLastUpdate = now - lastUpdateRef.current;

            if (timeSinceLastUpdate > 10000) {
                console.warn(`No data for ${timeSinceLastUpdate}ms. Forcing reconnect...`);
                lastUpdateRef.current = Date.now();
                if (wsSpotRef.current) wsSpotRef.current.close();
                if (wsFuturesRef.current) wsFuturesRef.current.close();
            }
        }, 5000);

        return () => {
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
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
