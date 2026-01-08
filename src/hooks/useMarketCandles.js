import { useBinanceCandles } from './useBinanceCandles';
import { useHyperliquidCandles } from './useHyperliquidCandles';
import { Capacitor } from '@capacitor/core';

/**
 * Unified candles hook for alerts/indicators.
 * Returns a map keyed by `${symbol}_${interval}` with:
 * { close, prevClose, isClosed, kline, sma7/sma25/sma99, ema7/ema25/ema99 }
 */
export const useMarketCandles = (provider, subscriptions = []) => {
    const safeProvider = provider === 'hyperliquid' ? 'hyperliquid' : 'binance';
    const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

    // Android alerts are handled by native service; avoid extra WS load here.
    const shouldLoad = !isAndroidNative;
    const binance = useBinanceCandles(shouldLoad && safeProvider === 'binance' ? subscriptions : []);
    const hyper = useHyperliquidCandles(shouldLoad && safeProvider === 'hyperliquid' ? subscriptions : []);

    return safeProvider === 'hyperliquid' ? hyper : binance;
};

