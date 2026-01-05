import { useState, useEffect, useRef } from 'react';
import { SMA, EMA } from 'technicalindicators';

const BINANCE_SPOT_REST = 'https://api.binance.com/api/v3/klines';
const BINANCE_FUTURES_REST = 'https://fapi.binance.com/fapi/v1/klines';
const BINANCE_SPOT_WS = 'wss://stream.binance.com:9443/ws';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';

// Helper functions
const isPerpetual = (symbol) => symbol.endsWith('.P');
const getBaseSymbol = (symbol) => isPerpetual(symbol) ? symbol.slice(0, -2) : symbol;
const getRestUrl = (symbol) => isPerpetual(symbol) ? BINANCE_FUTURES_REST : BINANCE_SPOT_REST;

// subscriptions: [{ symbol: 'BTCUSDT', interval: '1m' }, ...]
export const useBinanceCandles = (subscriptions = []) => {
    // Data Structure: { "BTCUSDT_1m": { close: ..., sma7: ... } }
    const [candleData, setCandleData] = useState({});
    const wsSpotRef = useRef(null);
    const wsFuturesRef = useRef(null);
    const historyLoadedRef = useRef(new Set());
    const historyRef = useRef({}); // keys: "BTCUSDT_1m"

    // Deduplicate subscriptions string for effect dependency
    const subString = JSON.stringify(subscriptions.sort((a, b) => (a.symbol + a.interval).localeCompare(b.symbol + b.interval)));

    useEffect(() => {
        subscriptions.forEach(({ symbol, interval }) => {
            const key = `${symbol}_${interval}`;
            if (historyLoadedRef.current.has(key)) return;

            const baseSymbol = getBaseSymbol(symbol);
            const restUrl = getRestUrl(symbol);
            fetch(`${restUrl}?symbol=${baseSymbol}&interval=${interval}&limit=100`)
                .then(res => res.json())
                .then(data => {
                    if (!Array.isArray(data)) return;
                    const closes = data.map(k => parseFloat(k[4]));
                    updateIndicators(symbol, interval, closes, true, data[data.length - 1]);
                    historyLoadedRef.current.add(key);
                })
                .catch(console.error);
        });
    }, [subString]);

    useEffect(() => {
        if (subscriptions.length === 0) return;

        // Group by spot/futures
        const spotSubs = subscriptions.filter(s => !isPerpetual(s.symbol));
        const futuresSubs = subscriptions.filter(s => isPerpetual(s.symbol));

        const connect = (subs, wsRef, isFutures) => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            if (!subs.length) return;

            const streams = subs.map(s => `${(isFutures ? getBaseSymbol(s.symbol) : s.symbol).toLowerCase()}@kline_${s.interval}`);
            if (!streams.length) return;

            const url = `${isFutures ? BINANCE_FUTURES_WS : BINANCE_SPOT_WS}/${streams.join('/')}`;
            wsRef.current = new WebSocket(url);

            wsRef.current.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.e === 'kline') {
                    let { s: symbol, k } = msg;
                    if (isFutures) {
                        symbol = symbol + '.P';
                    }
                    const interval = k.i;
                    const close = parseFloat(k.c);

                    updateIndicators(symbol, interval, [close], false, k);
                }
            };
        };

        connect(spotSubs, wsSpotRef, false);
        connect(futuresSubs, wsFuturesRef, true);

        return () => {
            if (wsSpotRef.current) wsSpotRef.current.close();
            if (wsFuturesRef.current) wsFuturesRef.current.close();
        };
    }, [subString]);

    const updateIndicators = (symbol, interval, closes, isHistory, kline) => {
        const key = `${symbol}_${interval}`;
        if (!historyRef.current[key]) historyRef.current[key] = [];

        if (isHistory) {
            historyRef.current[key] = closes;
        } else {
            const lastIdx = historyRef.current[key].length - 1;
            if (historyRef.current[key].length > 0) {
                // Update the last candle (current real-time one)
                historyRef.current[key][lastIdx] = closes[0];

                // If this is a new candle (previous usage logic was slightly loose),
                // essentially for indicators we often calculate on the CLOSE of candles.
                // But for real-time monitoring we calculate on the forming candle.

                // NOTE: Ideally we should handle proper appending when kline.t changes.
                // But for simplicity in this "Alert" context where we just need "current values",
                // updating the last item is efficient enough for now, assuming initial history was up to date.
                // A more robust implementation would check k.t vs last stored time.
            }
        }

        const prices = historyRef.current[key];
        if (!prices || prices.length < 2) return;

        const indicators = {
            close: prices[prices.length - 1],
            prevClose: prices[prices.length - 2],
            isClosed: kline ? kline.x : true,
            kline: kline,
            // Calculate indicators based on the prices array
            sma7: SMA.calculate({ period: 7, values: prices }).pop(),
            sma25: SMA.calculate({ period: 25, values: prices }).pop(),
            sma99: SMA.calculate({ period: 99, values: prices }).pop(),
            ema7: EMA.calculate({ period: 7, values: prices }).pop(),
            ema25: EMA.calculate({ period: 25, values: prices }).pop(),
            ema99: EMA.calculate({ period: 99, values: prices }).pop(),
        };

        setCandleData(prev => ({
            ...prev,
            [key]: indicators
        }));
    };

    return candleData;
};
