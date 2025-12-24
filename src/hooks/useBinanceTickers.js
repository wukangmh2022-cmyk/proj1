import { useState, useEffect, useRef } from 'react';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream';

export const useBinanceTickers = (symbols = [], onUpdate = null) => {
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

                    const tickerData = {
                        price: parseFloat(price),
                        change: parseFloat(changePrice),
                        changePercent: parseFloat(changePercent)
                    };

                    setTickers(prev => ({
                        ...prev,
                        [symbol]: tickerData
                    }));

                    // Call optional callback (for floating widget updates)
                    if (onUpdate && symbol === symbols[0]) {
                        onUpdate(symbol, tickerData);
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
