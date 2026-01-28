import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import FloatingWidget from '../plugins/FloatingWidget';
import { perfLog } from '../utils/perfLogger';
import { getCompositeLegs, isCompositeSymbol, normalizeSymbol } from '../utils/symbols';

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
    const compositeSpecsRef = useRef([]);

    const isNative = Capacitor.isNativePlatform();
    const normalizedSymbols = symbols.map(normalizeSymbol).filter(Boolean);
    const compositeSpecs = normalizedSymbols.map((s) => (isCompositeSymbol(s) ? getCompositeLegs(s) : null)).filter(Boolean);
    const compositeSymbols = new Set(compositeSpecs.map(spec => spec.symbol));
    const subscriptionSymbolsSet = new Set(normalizedSymbols.filter(s => !compositeSymbols.has(s)));
    compositeSpecs.forEach(spec => {
        subscriptionSymbolsSet.add(spec.baseSpot);
        subscriptionSymbolsSet.add(spec.basePerp);
        subscriptionSymbolsSet.add(spec.quoteSpot);
        subscriptionSymbolsSet.add(spec.quotePerp);
    });
    const subscriptionSymbols = Array.from(subscriptionSymbolsSet).sort();
    const subscriptionKey = JSON.stringify(subscriptionSymbols);
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
    const getTickerOpen = (ticker) => {
        if (!ticker || !isFinite(ticker.price)) return null;
        if (isFinite(ticker.change)) return ticker.price - ticker.change;
        if (isFinite(ticker.changePercent)) {
            const ratio = 1 + ticker.changePercent / 100;
            if (ratio === 0) return null;
            return ticker.price / ratio;
        }
        return null;
    };
    const pickLegTicker = (source, spotSymbol, perpSymbol) => {
        const spot = source[spotSymbol];
        if (spot && isFinite(spot.price)) return { ticker: spot, symbol: spotSymbol };
        const perp = source[perpSymbol];
        if (perp && isFinite(perp.price)) return { ticker: perp, symbol: perpSymbol };
        return null;
    };
    const computeCompositeTickers = (source) => {
        const specs = compositeSpecsRef.current || [];
        if (!specs.length) return {};
        const derived = {};
        specs.forEach((spec) => {
            const basePick = pickLegTicker(source, spec.baseSpot, spec.basePerp);
            const quotePick = pickLegTicker(source, spec.quoteSpot, spec.quotePerp);
            const basePrice = basePick?.ticker?.price;
            const quotePrice = quotePick?.ticker?.price;
            if (!isFinite(basePrice) || !isFinite(quotePrice) || quotePrice === 0) return;

            const price = basePrice / quotePrice;
            const baseOpen = getTickerOpen(basePick?.ticker);
            const quoteOpen = getTickerOpen(quotePick?.ticker);
            let change = 0;
            let changePercent = 0;
            if (isFinite(baseOpen) && isFinite(quoteOpen) && quoteOpen !== 0) {
                const open = baseOpen / quoteOpen;
                if (isFinite(open) && open !== 0) {
                    change = price - open;
                    changePercent = (change / open) * 100;
                }
            } else if (isFinite(basePick?.ticker?.changePercent) && isFinite(quotePick?.ticker?.changePercent)) {
                const b = basePick.ticker.changePercent / 100;
                const q = quotePick.ticker.changePercent / 100;
                const ratio = (1 + b) / (1 + q) - 1;
                if (isFinite(ratio)) {
                    changePercent = ratio * 100;
                    change = price - price / (1 + ratio);
                }
            }

            derived[spec.symbol] = {
                price,
                change,
                changePercent,
                _composite: true,
            };
        });
        return derived;
    };

    useEffect(() => {
        compositeSpecsRef.current = compositeSpecs;
    }, [subscriptionKey]);

    // ===== UI UPDATE LOOP (Throttling) =====
    // Decouples high-frequency data (WS/Native) from React Rendering
    useEffect(() => {
        let timer = null;

        const flushUpdates = () => {
            if (Object.keys(bufferRef.current).length > 0) {
                setTickers(prev => {
                    // Merge buffer into previous state
                    const next = { ...prev, ...bufferRef.current };
                    const composites = computeCompositeTickers(next);
                    bufferRef.current = {}; // Clear buffer
                    return Object.keys(composites).length > 0 ? { ...next, ...composites } : next;
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

        perfLog('[perf] useBinanceTickers native listener setup at', Date.now(), 'symbols=', subscriptionSymbols);

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

    // Sync symbol list + request ticker updates when native data source is ready.
    useEffect(() => {
        if (!isNative) return;
        if (subscriptionSymbols.length === 0) return;

        let cancelled = false;
        const retryTimers = [];

        const requestUpdate = (delay) => {
            const timer = setTimeout(() => {
                if (cancelled) return;
                try {
                    FloatingWidget.requestTickerUpdate();
                } catch (e) {
                    console.error('requestTickerUpdate failed', e);
                }
            }, delay);
            retryTimers.push(timer);
        };

        try {
            FloatingWidget.setSymbols({ symbols: subscriptionSymbols });
        } catch (e) {
            console.error('setSymbols failed', e);
        }

        requestUpdate(0);
        requestUpdate(600);
        requestUpdate(1600);

        return () => {
            cancelled = true;
            retryTimers.forEach(clearTimeout);
        };
    }, [isNative, subscriptionKey]);

    // Native fallback: retry symbol sync + request updates if prices stay empty
    useEffect(() => {
        if (!isNative || subscriptionSymbols.length === 0) return;
        let attempts = 0;

        const tick = () => {
            const hasAny = subscriptionSymbols.some(s => bufferRef.current[s] || Object.prototype.hasOwnProperty.call(tickers, s));
            if (hasAny || attempts >= 3) return;
            attempts += 1;
            try {
                FloatingWidget.setSymbols({ symbols: subscriptionSymbols });
                FloatingWidget.requestTickerUpdate();
            } catch (e) {
                console.error('native retry failed', e);
            }
            resumeHeartbeatRef.current = setTimeout(tick, 1500);
        };

        resumeHeartbeatRef.current = setTimeout(tick, 1500);
        return () => {
            if (resumeHeartbeatRef.current) clearTimeout(resumeHeartbeatRef.current);
        };
    }, [isNative, subscriptionKey, tickers]);

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
        if (subscriptionSymbols.length === 0) return;

        // Separate spot and futures symbols
        const spotSymbols = subscriptionSymbols.filter(s => !isPerpetual(s));
        const futuresSymbols = subscriptionSymbols.filter(s => isPerpetual(s));

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
    }, [subscriptionKey, isNative]);

    // Seed prices via REST for both native + web (helps avoid long "--" before WS/native data)
    useEffect(() => {
        if (subscriptionSymbols.length === 0) return;
        let cancelled = false;

        const seedPrices = async () => {
            try {
                const updates = {};
                const spotSymbols = subscriptionSymbols.filter(s => !isPerpetual(s));
                const futuresSymbols = subscriptionSymbols.filter(s => isPerpetual(s));

                await Promise.all(spotSymbols.map(async (s) => {
                    try {
                        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`);
                        const json = await res.json();
                        const price = parseFloat(json.price);
                        if (!Number.isNaN(price)) updates[s] = { price, change: 0, changePercent: 0 };
                    } catch (_) { }
                }));

                await Promise.all(futuresSymbols.map(async (s) => {
                    try {
                        const base = getBaseSymbol(s);
                        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${base}`);
                        const json = await res.json();
                        const price = parseFloat(json.price);
                        if (!Number.isNaN(price)) updates[s] = { price, change: 0, changePercent: 0 };
                    } catch (_) { }
                }));

                if (cancelled || Object.keys(updates).length === 0) return;
                setTickers(prev => {
                    const merged = { ...prev, ...updates };
                    const composites = computeCompositeTickers(merged);
                    return Object.keys(composites).length > 0 ? { ...merged, ...composites } : merged;
                });
            } catch (e) {
                console.error('Seed price fetch failed', e);
            }
        };

        seedPrices();
        return () => { cancelled = true; };
    }, [subscriptionKey]);

    // Web + Native fallback: periodically fetch missing symbols that have no price yet (covers newly added .P)
    useEffect(() => {
        if (subscriptionSymbols.length === 0) return;
        let timer = null;

        const fetchMissing = async () => {
            const missing = subscriptionSymbols.filter(s => !bufferRef.current[s] && !Object.prototype.hasOwnProperty.call(tickers, s));
            if (missing.length === 0) return;
            const updates = {};
            await Promise.all(missing.map(async (s) => {
                const isPerp = isPerpetual(s);
                const base = getBaseSymbol(s);
                const url = isPerp
                    ? `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${base}`
                    : `https://api.binance.com/api/v3/ticker/price?symbol=${s}`;
                try {
                    const res = await fetch(url);
                    const json = await res.json();
                    const price = parseFloat(json.price);
                    if (!Number.isNaN(price)) {
                        updates[s] = { price, change: 0, changePercent: 0 };
                    }
                } catch (_) { }
            }));
            if (Object.keys(updates).length > 0) {
                setTickers(prev => {
                    const merged = { ...prev, ...updates };
                    const composites = computeCompositeTickers(merged);
                    return Object.keys(composites).length > 0 ? { ...merged, ...composites } : merged;
                });
            }
        };

        timer = setInterval(fetchMissing, isNative ? 6000 : 4000);
        fetchMissing();

        return () => { if (timer) clearInterval(timer); };
    }, [subscriptionKey, tickers, isNative]);

    return tickers;
};
