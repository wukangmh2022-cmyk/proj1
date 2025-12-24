import { useState, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics } from '@capacitor/haptics';
import { Toast } from '@capacitor/toast';
import { getAlerts, saveAlert, addAlertHistory } from '../utils/alert_storage';
import { Capacitor } from '@capacitor/core';
import { useBinanceCandles } from './useBinanceCandles';

export const usePriceAlerts = (tickers) => {
    const [alerts, setAlerts] = useState([]);
    const pendingAlertsRef = useRef({}); // Tracks delay timers
    const lastProcessedCandleRef = useRef({}); // Tracks processed candle times to avoid duplicate triggers

    // 1. Identify symbols that need K-line data (Pro alerts)
    const activeProSymbols = alerts
        .filter(a => a.active && (a.targetType === 'indicator' || a.confirmation === 'candle_close'))
        .map(a => a.symbol);

    const uniqueProSymbols = [...new Set(activeProSymbols)];

    // 2. Fetch Candle Data for Pro Alerts (Default 1m for now, ideally dynamic)
    const candleData = useBinanceCandles(uniqueProSymbols, '1m');

    // Load alerts on mount
    useEffect(() => {
        setAlerts(getAlerts());

        // Request notification permissions
        if (Capacitor.isNativePlatform()) {
            LocalNotifications.requestPermissions();
        }
    }, []);

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

            // --- DATA SOURCE SELECTION ---
            if (alert.targetType === 'indicator' || alert.confirmation === 'candle_close') {
                // Use Candle Data
                const data = candleData[symbol];
                if (!data) return; // Wait for data

                currentPrice = data.close;

                if (alert.targetType === 'indicator') {
                    // targetValue string acts as key, e.g. 'sma7'
                    targetPrice = data[alert.targetValue];
                    if (!targetPrice) return; // Indicator not ready
                } else {
                    targetPrice = parseFloat(alert.target);
                }

                // Candle Confirmation Logic
                if (alert.confirmation === 'candle_close') {
                    // Only check if candle just closed
                    if (!data.isClosed) {
                        shouldCheck = false;
                    } else {
                        // Avoid double trigger for same candle
                        const lastTime = lastProcessedCandleRef.current[alert.id];
                        if (lastTime === data.kline.t) {
                            shouldCheck = false;
                        } else {
                            // Mark this candle as processed for this alert
                            lastProcessedCandleRef.current[alert.id] = data.kline.t;
                        }
                    }
                }

            } else {
                // simple miniTicker data
                const ticker = tickers[symbol];
                if (!ticker) return;
                currentPrice = ticker.price;
                targetPrice = parseFloat(alert.target);
            }

            if (!shouldCheck) return;

            // --- CONDITION CHECK ---
            if (alert.condition === 'crossing_up') {
                isConditionMet = currentPrice >= targetPrice;
            } else if (alert.condition === 'crossing_down') {
                isConditionMet = currentPrice <= targetPrice;
            }

            // --- TRIGGER LOGIC ---
            if (isConditionMet) {
                // If Delay is set (and not using candle close which is instant)
                if (alert.delaySeconds > 0 && alert.confirmation !== 'candle_close') {
                    if (!pendingAlertsRef.current[alert.id]) {
                        pendingAlertsRef.current[alert.id] = {
                            startTime: Date.now(),
                            timerId: setTimeout(() => {
                                triggerAlert(alert, currentPrice, targetPrice);
                                delete pendingAlertsRef.current[alert.id];
                            }, alert.delaySeconds * 1000)
                        };
                        console.log(`Alert ${alert.id} waiting ${alert.delaySeconds}s...`);
                    }
                } else {
                    // Immediate trigger (or Candle Close trigger)
                    triggerAlert(alert, currentPrice, targetPrice);
                }
            } else {
                // Condition NOT met
                if (pendingAlertsRef.current[alert.id]) {
                    clearTimeout(pendingAlertsRef.current[alert.id].timerId);
                    delete pendingAlertsRef.current[alert.id];
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
        const conditionStr = alert.condition === 'crossing_up' ? 'rose above' : 'fell below';
        const message = `${alert.symbol} ${conditionStr} ${targetStr}. Price: ${currentPrice}`;

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
                        title: 'Binance Alert',
                        body: message,
                        id: Math.floor(Math.random() * 100000),
                        schedule: { at: new Date(Date.now() + 100) },
                        sound: null
                    }]
                });
            }

            if (alert.actions.vibration === 'continuous') {
                // Simulate continuous by repeating 3 times
                for (let i = 0; i < 3; i++) {
                    await Haptics.vibrate({ duration: 1000 });
                    await new Promise(r => setTimeout(r, 1200));
                }
            } else if (alert.actions.vibration === 'once') {
                await Haptics.vibrate({ duration: 500 });
            }
        } else {
            // Web fallback
            console.log('Alert Triggered:', message);
            if (alert.actions.toast) alert(message);
        }
    };

    return { alerts, refreshAlerts };
};
