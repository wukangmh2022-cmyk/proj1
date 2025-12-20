import { useState, useEffect, useRef } from 'react';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream';

export const useBinanceTickers = (symbols = []) => {
    const [tickers, setTickers] = useState({});
    const wsRef = useRef(null);

    useEffect(() => {
        if (symbols.length === 0) return;

        const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `${BINANCE_WS_URL}?streams=${streams}`;

        const connect = () => {
            wsRef.current = new WebSocket(url);

            wsRef.current.onopen = () => {
                console.log('Connected to Binance WS');
            };

            wsRef.current.onmessage = (event) => {
                const message = JSON.parse(event.data);
                // Message format: { stream: '...', data: { s: 'BTCUSDT', c: '12345.67' ... } }
                if (message.data) {
                    const { s: symbol, c: price, p: changePrice, P: changePercent } = message.data;
                    setTickers(prev => ({
                        ...prev,
                        [symbol]: {
                            price: parseFloat(price),
                            change: parseFloat(changePrice),
                            changePercent: parseFloat(changePercent)
                        }
                    }));
                }
            };

            wsRef.current.onclose = () => {
                console.log('Disconnected, reconnecting...');
                setTimeout(connect, 3000);
            };

            wsRef.current.onerror = (err) => {
                console.error('WS Error:', err);
                wsRef.current.close();
            };
        };

        connect();

        return () => {
            if (wsRef.current) {
                wsRef.current.onclose = null; // Prevent reconnect on unmount
                wsRef.current.close();
            }
        };
    }, [JSON.stringify(symbols)]);

    return tickers;
};
