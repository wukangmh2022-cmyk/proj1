import { useState, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics } from '@capacitor/haptics';
import { Toast } from '@capacitor/toast';
import { getAlerts, saveAlert, addAlertHistory } from '../utils/alert_storage';
import { Capacitor } from '@capacitor/core';
import { useBinanceCandles } from './useBinanceCandles';
import { serializeDrawingAlert, checkAlertTargets } from '../utils/drawing_alert_utils';

export const usePriceAlerts = (tickers) => {
    const [alerts, setAlerts] = useState([]);
    const pendingAlertsRef = useRef({}); // Tracks time delay timers: { alertId: { timerId } }
    const pendingCandleWaitRef = useRef({}); // Tracks candle wait: { alertId: { remainingCandles: k } }
    const lastProcessedCandleRef = useRef({}); // Tracks processed candle times { alertId: timestamp }

    // 1. Identify subscriptions needed
    const subscriptions = alerts
        .filter(a => a.active && (a.targetType === 'indicator' || a.confirmation === 'candle_close'))
        .map(a => ({
            symbol: a.symbol,
            interval: a.interval || '1m' // Default to 1m if missing
        }));

    // Deduplicate
    const uniqueSubs = subscriptions.filter((v, i, a) => a.findIndex(t => t.symbol === v.symbol && t.interval === v.interval) === i);

    // 2. Fetch Candle Data
    const candleData = useBinanceCandles(uniqueSubs);

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
        return checkAlertTargets(config, time);
    };

    const refreshAlerts = () => {
        setAlerts(getAlerts());
    };

    // Check alerts logic
    useEffect(() => {
        alerts.forEach(alert => {
            if (!alert.active) return;

            const symbol = alert.symbol;
            let currentPrice, targetPrice, isConditionMet = false;
            let shouldCheck = true;
            let dataKey = null;

            // --- DATA SOURCE SELECTION ---
            if (alert.targetType === 'indicator' || alert.confirmation === 'candle_close') {
                const interval = alert.interval || '1m';
                dataKey = `${symbol}_${interval}`;
                const data = candleData[dataKey];

                if (!data) return; // Wait for data

                currentPrice = data.close;

                if (alert.targetType === 'indicator') {
                    // targetValue string acts as key, e.g. 'sma7'
                    targetPrice = data[alert.targetValue];
                    if (!targetPrice) return;
                } else if (alert.targetType === 'drawing') {
                    // Load Drawings
                    const allDrawings = getDrawings(symbol);
                    const d = allDrawings.find(x => x.id === alert.targetValue);
                    if (!d) return;

                    // Calculate target based on Candle Time (Current/Latest)
                    // data.kline.t is open time? data.t is time?
                    // useBinanceCandles usually provides formatted data?
                    // raw kline is in data.kline
                    const t = data.kline ? data.kline.t / 1000 : Date.now() / 1000; // time in seconds (as used in drawing)

                    targetPrice = getDrawingTarget(d, t);
                    // targetPrice could be number, array, or null
                    if (targetPrice === null) return;
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
                targetPrice = parseFloat(alert.target);
            }

            if (!shouldCheck) return;

            // --- CONDITION CHECK ---
            const check = (t) => {
                if (alert.condition === 'crossing_up') return currentPrice >= t;
                if (alert.condition === 'crossing_down') return currentPrice <= t;
                return false;
            };

            if (Array.isArray(targetPrice)) {
                // If any of the lines are crossed
                isConditionMet = targetPrice.some(tp => check(tp));
                // Optimization: store WHICH line was crossed for message?
                // For now just trigger.
                // We might want to use the crossed line as the recorded 'target' in history.
                // But strict bool is enough.
            } else {
                isConditionMet = check(targetPrice);
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

    const triggerAlert = async (alert, currentPrice, targetPrice) => {
        // 1. Deactivate alert (one-time trigger)
        alert.active = false;
        saveAlert(alert);
        refreshAlerts();

        // 2. Log History
        const targetStr = alert.targetType === 'indicator' ? alert.targetValue.toUpperCase() : targetPrice;
        // Localized message logic could go here or in UI. Storing raw string for now.
        const conditionStr = alert.condition === 'crossing_up' ? '上穿' : '下穿'; // Localized
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

    return { alerts, refreshAlerts };
};
