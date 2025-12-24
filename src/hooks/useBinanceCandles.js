import { useState, useEffect, useRef } from 'react';
import { SMA, EMA, RSI, BollingerBands } from 'technicalindicators';

const BINANCE_REST_URL = 'https://api.binance.com/api/v3/klines';
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

export const useBinanceCandles = (symbols, interval = '1m') => {
    const [candleData, setCandleData] = useState({}); // { BTCUSDT: { close: 100, sma7: 99, ... } }
    const wsRef = useRef(null);
    const historyLoadedRef = useRef(new Set());

    // Fetch initial history for indicator calculation
    useEffect(() => {
        symbols.forEach(symbol => {
            if (historyLoadedRef.current.has(`${symbol}_${interval}`)) return;

            fetch(`${BINANCE_REST_URL}?symbol=${symbol}&interval=${interval}&limit=100`)
                .then(res => res.json())
                .then(data => {
                    const closes = data.map(k => parseFloat(k[4]));
                    updateIndicators(symbol, closes, true, data[data.length - 1]);
                    historyLoadedRef.current.add(`${symbol}_${interval}`);
                })
                .catch(console.error);
        });
    }, [symbols, interval]);

    // WebSocket for real-time updates
    useEffect(() => {
        if (symbols.length === 0) return;

        if (wsRef.current) wsRef.current.close();

        const streams = symbols.map(s => `${s.toLowerCase()}@kline_${interval}`).join('/');
        const url = `${BINANCE_WS_URL}/${streams}`;

        wsRef.current = new WebSocket(url);

        wsRef.current.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.e === 'kline') {
                const { s: symbol, k } = msg;
                const close = parseFloat(k.c);
                const isClosed = k.x;

                // We need history to calculate indicators. 
                // For simplicity in this demo, we maintain a rolling list in state or ref.
                // Here, we'll assume we received history and just append/update.
                // Ideally, use a ref to store full history for calculation.

                updateIndicators(symbol, [close], false, k);
            }
        };

        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, [JSON.stringify(symbols), interval]);

    const historyRef = useRef({}); // { BTCUSDT: [c1, c2, ...] }

    const updateIndicators = (symbol, closes, isHistory, kline) => {
        if (!historyRef.current[symbol]) historyRef.current[symbol] = [];

        if (isHistory) {
            historyRef.current[symbol] = closes;
        } else {
            // Realtime update: update last candle or push new one
            // Simplified: We assume stream gives us ongoing value of current candle.
            // On k.x (close), we finalize it.
            // For indicators, we need closed prices usually.
            // We will use "rolling" calculation on the current tick for active alerts.

            const lastIdx = historyRef.current[symbol].length - 1;
            // If previous candle closed, push new. Else update last.
            // For simplicity, just maintain last 100.
            if (historyRef.current[symbol].length > 0) {
                historyRef.current[symbol][lastIdx] = closes[0];
                // Note: logic to distinguish new vs update is needed if strict.
                // But for alerts, we often want "current" value of indicator.
            }
        }

        const prices = historyRef.current[symbol];
        if (!prices || prices.length < 2) return;

        // Calculate Indicators
        // SMA 7, 25, 99
        // EMA 7, 25, 99
        // RSI 14

        const indicators = {
            close: prices[prices.length - 1],
            isClosed: kline ? kline.x : true,
            kline: kline,
            sma7: SMA.calculate({ period: 7, values: prices }).pop(),
            sma25: SMA.calculate({ period: 25, values: prices }).pop(),
            sma99: SMA.calculate({ period: 99, values: prices }).pop(),
            ema7: EMA.calculate({ period: 7, values: prices }).pop(),
            ema25: EMA.calculate({ period: 25, values: prices }).pop(),
            ema99: EMA.calculate({ period: 99, values: prices }).pop(),
            // rsi14: RSI.calculate({period: 14, values: prices}).pop(), // Requires 'technicalindicators' import
        };

        setCandleData(prev => ({
            ...prev,
            [symbol]: indicators
        }));
    };

    return candleData;
};
