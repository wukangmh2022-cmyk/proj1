import { useState, useEffect, useRef } from 'react';
import FloatingWidget from '../plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream';

export const useBinanceTickers = (symbols = []) => {
    const [tickers, setTickers] = useState({});
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const watchdogIntervalRef = useRef(null);
    const lastUpdateRef = useRef(Date.now());

    const connect = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
        if (wsRef.current) wsRef.current.close();

        const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `${BINANCE_WS_URL}?streams=${streams}`;

        console.log('Connecting to Binance WS...');
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
                    const { s: symbol, c: price, p: changePrice, P: changePercent } = message.data;

                    setTickers(prev => ({
                        ...prev,
                        [symbol]: {
                            price: parseFloat(price),
                            change: parseFloat(changePrice),
                            changePercent: parseFloat(changePercent)
                        }
                    }));

                    // Send updates to native floating widget (only if active & platform is native)
                    // For simplicity, we send the first symbol's data
                    if (Capacitor.isNativePlatform() && symbol === symbols[0]) {
                        FloatingWidget.update({
                            symbol: symbol,
                            price: parseFloat(price).toFixed(2),
                            change: parseFloat(changePercent).toFixed(2)
                        }).catch(() => { }); // Ignore errors if widget not started
                    }
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
