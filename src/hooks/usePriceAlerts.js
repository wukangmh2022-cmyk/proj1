import { useState, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Toast } from '@capacitor/toast';
import { getAlerts, saveAlert, addAlertHistory } from '../utils/alert_storage';
import { Capacitor } from '@capacitor/core';

export const usePriceAlerts = (tickers) => {
    const [alerts, setAlerts] = useState([]);
    const pendingAlertsRef = useRef({}); // Tracks delay timers: { alertId: { startTime, timerId } }

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

    // Check alerts whenever tickers update
    useEffect(() => {
        if (!tickers || Object.keys(tickers).length === 0) return;

        alerts.forEach(alert => {
            if (!alert.active) return;

            const ticker = tickers[alert.symbol];
            if (!ticker) return;

            const currentPrice = ticker.price;
            const targetPrice = parseFloat(alert.target);

            // Determine logic based on condition
            // If condition is 'crossing_up', we check if price >= target
            // If condition is 'crossing_down', we check if price <= target
            // We assume the alert was set when price was on the other side.

            let isConditionMet = false;
            if (alert.condition === 'crossing_up') {
                isConditionMet = currentPrice >= targetPrice;
            } else if (alert.condition === 'crossing_down') {
                isConditionMet = currentPrice <= targetPrice;
            }

            if (isConditionMet) {
                // If Delay is set (e.g. 5 sec), we verify persistence
                if (alert.delaySeconds > 0) {
                    if (!pendingAlertsRef.current[alert.id]) {
                        // Start timer
                        pendingAlertsRef.current[alert.id] = {
                            startTime: Date.now(),
                            timerId: setTimeout(() => {
                                triggerAlert(alert, currentPrice);
                                delete pendingAlertsRef.current[alert.id];
                            }, alert.delaySeconds * 1000)
                        };
                        console.log(`Alert ${alert.id} condition met. Waiting ${alert.delaySeconds}s...`);
                    }
                } else {
                    // Immediate trigger
                    triggerAlert(alert, currentPrice);
                }
            } else {
                // Condition NOT met (price reverted)
                if (pendingAlertsRef.current[alert.id]) {
                    // Cancel pending timer
                    console.log(`Alert ${alert.id} reverted. Cancelling...`);
                    clearTimeout(pendingAlertsRef.current[alert.id].timerId);
                    delete pendingAlertsRef.current[alert.id];
                }
            }
        });
    }, [tickers, alerts]);

    const triggerAlert = async (alert, currentPrice) => {
        // 1. Deactivate alert (one-time trigger)
        alert.active = false;
        saveAlert(alert);
        refreshAlerts();

        // 2. Log History
        const message = `${alert.symbol} ${alert.condition === 'crossing_up' ? 'rose above' : 'fell below'} ${alert.target}. Price: ${currentPrice}`;
        addAlertHistory({
            symbol: alert.symbol,
            message: message,
            target: alert.target,
            price: currentPrice
        });

        // 3. Native Actions
        if (Capacitor.isNativePlatform()) {
            if (alert.actions.toast) {
                await Toast.show({
                    text: message,
                    duration: 'long'
                });
            }

            if (alert.actions.notification) {
                await LocalNotifications.schedule({
                    notifications: [{
                        title: 'Binance Alert Triggered',
                        body: message,
                        id: Math.floor(Math.random() * 100000),
                        schedule: { at: new Date(Date.now() + 100) },
                        sound: null,
                        attachments: null,
                        actionTypeId: "",
                        extra: null
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
            if (alert.actions.toast) {
                alert(message);
            }
            console.log('Alert Triggered:', message);
        }
    };

    return { alerts, refreshAlerts };
};
