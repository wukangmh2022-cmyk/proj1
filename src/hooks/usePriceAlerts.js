import { useState, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics } from '@capacitor/haptics';
import { Toast } from '@capacitor/toast';
import { getAlerts, saveAlert, addAlertHistory } from '../utils/alert_storage';
import { Capacitor } from '@capacitor/core';
import { useMarketCandles } from './useMarketCandles';
import { serializeDrawingAlert, checkAlertTargets } from '../utils/drawing_alert_utils';

export const usePriceAlerts = (tickers, marketProvider = 'binance') => {
    const [alerts, setAlerts] = useState([]);
    const pendingAlertsRef = useRef({}); // Tracks time delay timers: { alertId: { timerId } }
    const pendingCandleWaitRef = useRef({}); // Tracks candle wait: { alertId: { remainingCandles: k } }
    const lastProcessedCandleRef = useRef({}); // Tracks processed candle times { alertId: timestamp }
    const lastTickerPriceRef = useRef({}); // { [symbol]: lastPrice }

    // Android alerting is handled by native `FloatingWindowService` (background-capable).
    const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

    const normalizeConditions = (condition) => {
        const list = Array.isArray(condition) ? condition : (condition ? [condition] : []);
        const ordered = [];
        if (list.includes('crossing_up')) ordered.push('crossing_up');
        if (list.includes('crossing_down')) ordered.push('crossing_down');
        return ordered.length ? ordered : ['crossing_up'];
    };

    const getConditionLabel = (condition) => {
        const list = normalizeConditions(condition);
        const up = list.includes('crossing_up');
        const down = list.includes('crossing_down');
        if (up && down) return '上下穿';
        if (up) return '上穿';
        if (down) return '下穿';
        return '穿越';
    };

    // 1. Identify subscriptions needed
    const subscriptions = alerts
        .filter(a => a.active && (a.targetType === 'indicator' || a.targetType === 'drawing' || a.confirmation === 'candle_close'))
        .map(a => ({
            symbol: a.symbol,
            interval: a.interval || '1m' // Default to 1m if missing
        }));

    // Deduplicate
    const uniqueSubs = subscriptions.filter((v, i, a) => a.findIndex(t => t.symbol === v.symbol && t.interval === v.interval) === i);

    // 2. Fetch Candle Data
    const candleData = useMarketCandles(marketProvider, uniqueSubs);

    // Load alerts on mount
    useEffect(() => {
        setAlerts(getAlerts());
        if (Capacitor.isNativePlatform()) {
            LocalNotifications.requestPermissions();
        }
    }, []);

    const getDrawings = (symbol) => {
        try {
            const s = localStorage.getItem(`chart_drawings_${symbol}`);
            return s ? JSON.parse(s) : [];
        } catch { return []; }
    };

    // Helper to calculate target price from drawing at specific time
    const getDrawingTarget = (drawing, time) => {
        if (!drawing || !drawing.points) return null;
        const config = serializeDrawingAlert(drawing);
        if (!config) return null;
        return { algo: config.algo, targets: checkAlertTargets(config, time) };
    };

    const refreshAlerts = () => {
        setAlerts(getAlerts());
    };

    const triggerAlert = async (alert, currentPrice, targetPrice) => {
        const now = Date.now();

        // Repeat gating (web/iOS). Android is handled by native service.
        const repeatMode = alert.repeatMode || 'once';
        const repeatIntervalSec = parseInt(alert.repeatIntervalSec || 0);
        const lastTriggeredAt = parseInt(alert.lastTriggeredAt || 0);
        if (repeatMode === 'repeat' && repeatIntervalSec > 0 && now - lastTriggeredAt < repeatIntervalSec * 1000) {
            return;
        }

        // 1. Update alert state
        if (repeatMode === 'repeat') {
            alert.lastTriggeredAt = now;
        } else {
            alert.active = false;
        }
        saveAlert(alert);
        refreshAlerts();

        // 2. Log History
        let targetStr;
        if (alert.targetType === 'indicator') {
            targetStr = alert.targetValue?.toUpperCase?.() || '';
        } else if (targetPrice && typeof targetPrice === 'object' && Array.isArray(targetPrice.targets)) {
            const targets = targetPrice.targets;
            if (targetPrice.algo === 'rect_zone' && targets.length >= 2) {
                const high = Math.max(...targets);
                const low = Math.min(...targets);
                targetStr = `[${low} ~ ${high}]`;
            } else {
                targetStr = `[${targets.join(', ')}]`;
            }
        } else {
            targetStr = targetPrice;
        }
        const conditionStr = getConditionLabel(alert.conditions || alert.condition);
        const message = `${alert.symbol} ${conditionStr} ${targetStr}. 价格: ${currentPrice}`;

        addAlertHistory({
            symbol: alert.symbol,
            message: message,
            target: targetStr,
            price: currentPrice
        });

        // 3. Native Actions
        if (Capacitor.isNativePlatform()) {
            if (alert.actions.toast) {
                await Toast.show({ text: message, duration: 'long' });
            }

            if (alert.actions.notification) {
                await LocalNotifications.schedule({
                    notifications: [{
                        title: '行情预警',
                        body: message,
                        id: Math.floor(Math.random() * 100000),
                        schedule: { at: new Date(Date.now() + 100) },
                        sound: null
                    }]
                });
            }

            if (alert.actions.vibration === 'continuous') {
                for (let i = 0; i < 3; i++) {
                    await Haptics.vibrate({ duration: 1000 });
                    await new Promise(r => setTimeout(r, 1200));
                }
            } else if (alert.actions.vibration === 'once') {
                await Haptics.vibrate({ duration: 500 });
            }
        }
    };

    // Check alerts logic
    useEffect(() => {
        if (isAndroidNative) return;

        const didCrossUp = (prev, curr, t) => prev < t && curr >= t;
        const didCrossDown = (prev, curr, t) => prev > t && curr <= t;

        alerts.forEach(alert => {
            if (!alert.active) return;

            const symbol = alert.symbol;
            let currentPrice, targetPrice, isConditionMet = false;
            let prevPrice;
            let shouldCheck = true;
            let dataKey = null;

            // --- DATA SOURCE SELECTION ---
            if (alert.targetType === 'indicator' || alert.confirmation === 'candle_close') {
                const interval = alert.interval || '1m';
                dataKey = `${symbol}_${interval}`;
                const data = candleData[dataKey];

                if (!data) return; // Wait for data

                currentPrice = data.close;
                prevPrice = data.prevClose;

                if (alert.targetType === 'indicator') {
                    // targetValue string acts as key, e.g. 'sma7'
                    targetPrice = data[alert.targetValue];
                    if (!targetPrice) return;
                } else if (alert.targetType === 'drawing') {
                    // Load Drawings
                    const allDrawings = getDrawings(symbol);
                    const targetIds = Array.isArray(alert.targetValues)
                        ? alert.targetValues
                        : (Array.isArray(alert.targetValue) ? alert.targetValue : [alert.targetValue]).filter(Boolean);
                    if (targetIds.length === 0) return;

                    // Calculate target based on Candle Time (Current/Latest)
                    // data.kline.t is open time? data.t is time?
                    // useBinanceCandles usually provides formatted data?
                    // raw kline is in data.kline
                    const t = data.kline ? data.kline.t / 1000 : Date.now() / 1000; // time in seconds (as used in drawing)

                    const targetPrices = [];
                    let drawingAlgo = null;
                    targetIds.forEach(id => {
                        const d = allDrawings.find(x => x.id === id);
                        if (!d) return;
                        const res = getDrawingTarget(d, t);
                        if (!res || res.targets === null || res.targets === undefined) return;
                        if (!drawingAlgo) drawingAlgo = res.algo;
                        const tp = res.targets;
                        if (Array.isArray(tp)) targetPrices.push(...tp);
                        else targetPrices.push(tp);
                    });
                    if (targetPrices.length === 0) return;
                    targetPrice = { algo: drawingAlgo, targets: targetPrices };
                } else {
                    targetPrice = parseFloat(alert.target);
                }

                // Candle Confirmation Logic
                if (alert.confirmation === 'candle_close') {
                    // Only check logic when candle CLOSES
                    if (!data.isClosed) {
                        shouldCheck = false;
                    } else {
                        // Check if we already processed this specific candle timestamp for this alert
                        const lastTime = lastProcessedCandleRef.current[alert.id];
                        if (lastTime === data.kline.t) {
                            shouldCheck = false;
                        }
                    }
                }

            } else {
                // Simple Price Alert (MiniTicker)
                const ticker = tickers[symbol];
                if (!ticker) return;
                currentPrice = ticker.price;
                prevPrice = lastTickerPriceRef.current[symbol];
                lastTickerPriceRef.current[symbol] = currentPrice;
                targetPrice = parseFloat(alert.target);
            }

            if (!shouldCheck) return;
            if (prevPrice === null || prevPrice === undefined || Number.isNaN(prevPrice)) return;

            // --- CONDITION CHECK ---
            const conditions = normalizeConditions(alert.conditions || alert.condition);
            const checkCrossing = (t) => {
                if (conditions.includes('crossing_up') && didCrossUp(prevPrice, currentPrice, t)) return true;
                if (conditions.includes('crossing_down') && didCrossDown(prevPrice, currentPrice, t)) return true;
                return false;
            };

            if (targetPrice && typeof targetPrice === 'object' && Array.isArray(targetPrice.targets)) {
                const algo = targetPrice.algo;
                const targets = targetPrice.targets;

                if (algo === 'rect_zone' && targets.length >= 2) {
                    const high = Math.max(...targets);
                    const low = Math.min(...targets);
                    if (conditions.includes('crossing_up') && didCrossUp(prevPrice, currentPrice, high)) isConditionMet = true;
                    else if (conditions.includes('crossing_down') && didCrossDown(prevPrice, currentPrice, low)) isConditionMet = true;
                } else {
                    // If any of the lines are crossed
                    isConditionMet = targets.some(tp => checkCrossing(tp));
                }
                // Optimization: store WHICH line was crossed for message?
                // For now just trigger.
                // We might want to use the crossed line as the recorded 'target' in history.
                // But strict bool is enough.
            } else {
                isConditionMet = checkCrossing(targetPrice);
            }

            // --- TRIGGER LOGIC ---
            if (alert.confirmation === 'candle_close') {
                // If we are here, candle JUST closed.
                const candleTime = candleData[dataKey]?.kline?.t;

                // If waiting for K candles
                if (pendingCandleWaitRef.current[alert.id]) {
                    // Decrement count
                    pendingCandleWaitRef.current[alert.id].remaining--;

                    // Mark this candle as processed
                    lastProcessedCandleRef.current[alert.id] = candleTime;

                    if (pendingCandleWaitRef.current[alert.id].remaining <= 0) {
                        // Wait over. Check condition again? 
                        // Usually "Wait K candles" means "Confirm signal stays valid" OR "Just delay action".
                        // Assuming simple delay: Trigger now.
                        // Ideally we check condition met AGAIN on this candle.
                        if (isConditionMet) {
                            triggerAlert(alert, currentPrice, targetPrice);
                            delete pendingCandleWaitRef.current[alert.id];
                        } else {
                            // Signal lost? Cancel wait.
                            delete pendingCandleWaitRef.current[alert.id];
                        }
                    }
                    return;
                }

                if (isConditionMet) {
                    // Condition met on close.
                    const kDelay = alert.delayCandles || 0;
                    if (kDelay === 0) {
                        triggerAlert(alert, currentPrice, targetPrice);
                        lastProcessedCandleRef.current[alert.id] = candleTime;
                    } else {
                        // Start waiting
                        pendingCandleWaitRef.current[alert.id] = { remaining: kDelay };
                        lastProcessedCandleRef.current[alert.id] = candleTime;
                        console.log(`Alert ${alert.id} condition met. Waiting ${kDelay} candles.`);
                    }
                }

            } else {
                // Realtime (Immediate or Time Delay)
                if (isConditionMet) {
                    if (alert.delaySeconds > 0) {
                        if (!pendingAlertsRef.current[alert.id]) {
                            pendingAlertsRef.current[alert.id] = {
                                timerId: setTimeout(() => {
                                    triggerAlert(alert, currentPrice, targetPrice);
                                    delete pendingAlertsRef.current[alert.id];
                                }, alert.delaySeconds * 1000)
                            };
                        }
                    } else {
                        triggerAlert(alert, currentPrice, targetPrice);
                    }
                } else {
                    // Condition NOT met (Reset timer)
                    if (pendingAlertsRef.current[alert.id]) {
                        clearTimeout(pendingAlertsRef.current[alert.id].timerId);
                        delete pendingAlertsRef.current[alert.id];
                    }
                }
            }
        });
    }, [tickers, candleData, alerts]);

    return { alerts, refreshAlerts };
};
