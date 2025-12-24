import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import FloatingWidget from '../plugins/FloatingWidget';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream';

export const useBinanceTickers = (symbols = []) => {
    const [tickers, setTickers] = useState({});
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const watchdogIntervalRef = useRef(null);
    const lastUpdateRef = useRef(Date.now());
    const listenerRef = useRef(null);

    // ===== NATIVE MODE (Android) =====
    // Receive data from native Service via Plugin events
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        // Subscribe to native ticker updates
        listenerRef.current = FloatingWidget.addListener('tickerUpdate', (data) => {
            const { symbol, price, changePercent } = data;

            // Calculate change from current/previous state (or just use percent)
            setTickers(prev => ({
                ...prev,
                [symbol]: {
                    price: price,
                    change: 0, // Not directly available from broadcast, but percent is.
                    changePercent: changePercent
                }
            }));
        });

        return () => {
            if (listenerRef.current) {
                listenerRef.current.remove();
            }
        };
    }, []); // Only run once

    // ===== WEB MODE (Fallback) =====
    // Use WebSocket directly when not on native platform
    const connect = () => {
        if (Capacitor.isNativePlatform()) return; // Skip on native
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
        if (wsRef.current) wsRef.current.close();

        const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `${BINANCE_WS_URL}?streams=${streams}`;

        console.log('Connecting to Binance WS (Web Mode)...');
        wsRef.current = new WebSocket(url);

        wsRef.current.onopen = () => {
            console.log('Connected to Binance WS');
            lastUpdateRef.current = Date.now();
        };

        wsRef.current.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.data) {
                    lastUpdateRef.current = Date.now();
                    const { s: symbol, c: closeStr, o: openStr } = message.data;

                    const price = parseFloat(closeStr);
                    const openPrice = parseFloat(openStr);
                    const changePrice = price - openPrice;
                    const changePercent = openPrice > 0 ? (changePrice / openPrice) * 100 : 0;

                    setTickers(prev => ({
                        ...prev,
                        [symbol]: {
                            price: price,
                            change: changePrice,
                            changePercent: changePercent
                        }
                    }));
                }
            } catch (err) {
                console.error('Parse Error', err);
            }
        };

        wsRef.current.onclose = () => {
            console.log('WS Disconnected. Scheduling reconnect...');
            cleanup();
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };

        wsRef.current.onerror = (err) => {
            console.error('WS Error:', err);
            wsRef.current.close();
        };
    };

    const cleanup = () => {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };

    useEffect(() => {
        if (Capacitor.isNativePlatform()) return; // Skip WS on native
        if (symbols.length === 0) return;

        connect();

        watchdogIntervalRef.current = setInterval(() => {
            const now = Date.now();
            const timeSinceLastUpdate = now - lastUpdateRef.current;

            if (timeSinceLastUpdate > 10000) {
                console.warn(`No data for ${timeSinceLastUpdate}ms. Forcing reconnect...`);
                lastUpdateRef.current = Date.now();
                if (wsRef.current) wsRef.current.close();
                else connect();
            }
        }, 5000);

        return () => {
            cleanup();
            if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, [JSON.stringify(symbols)]);

    return tickers;
};

