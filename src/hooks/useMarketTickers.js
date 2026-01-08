import { useMemo } from 'react';
import { useBinanceTickers } from './useBinanceTickers';
import { useHyperliquidTickers } from './useHyperliquidTickers';

const toHyperliquidMarketName = (symbol) => {
    if (!symbol) return null;
    const s = String(symbol).toUpperCase();
    const base = s.endsWith('.P') ? s.slice(0, -2) : s;
    // Common case: Binance-style XXXUSDT
    if (base.endsWith('USDT')) return base.slice(0, -4);
    if (base.endsWith('USD')) return base.slice(0, -3);
    return base;
};

/**
 * Unified tickers hook.
 * Returns a map keyed by the *input symbols* shape: { [symbol]: { price, change, changePercent } }
 */
export const useMarketTickers = (provider, symbols = []) => {
    const safeProvider = provider === 'hyperliquid' ? 'hyperliquid' : 'binance';
    const key = useMemo(() => symbols.filter(Boolean).join(','), [symbols]);

    const binanceTickers = useBinanceTickers(safeProvider === 'binance' ? symbols : []);

    const hyperMarkets = useMemo(() => {
        if (safeProvider !== 'hyperliquid') return [];
        const set = new Set();
        symbols.forEach(s => {
            const name = toHyperliquidMarketName(s);
            if (name) set.add(name);
        });
        return Array.from(set);
    }, [safeProvider, key]);

    const hyperTickersByMarket = useHyperliquidTickers(hyperMarkets);

    return useMemo(() => {
        if (safeProvider === 'binance') return binanceTickers;
        const out = {};
        symbols.forEach(sym => {
            const m = toHyperliquidMarketName(sym);
            const t = m ? hyperTickersByMarket[m] : null;
            if (t) out[sym] = t;
        });
        return out;
    }, [safeProvider, key, binanceTickers, hyperTickersByMarket]);
};

