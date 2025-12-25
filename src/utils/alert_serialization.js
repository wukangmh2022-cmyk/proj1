import { serializeDrawingAlert } from './drawing_alert_utils';

/**
 * Universal Alert Data Structure
 * 
 * Standardizes the configuration for all alert types (Price, Indicator, Drawing)
 * into a portable JSON format.
 */

export const serializeAlertConfig = (alert, allDrawings = []) => {
    if (!alert) return null;

    // 1. Alert Header
    const config = {
        id: alert.id,
        symbol: alert.symbol,
        active: alert.active,
        createdAt: alert.createdAt || Date.now(),
        meta: {
            message: alert.message || null
        }
    };

    // 2. Data Source (Left Hand Side)
    // What are we monitoring? Price? Indicator?
    if (alert.targetType === 'indicator') {
        config.source = {
            type: 'indicator',
            algo: alert.interval ? `kline_${alert.interval}` : 'kline_1m', // Simplified assumption
            key: alert.targetValue // e.g. "sma7", "rsi14"
        };
    } else {
        config.source = {
            type: 'price',
            algo: 'market_price',
            params: {
                interval: alert.interval || '1m' // Relevant for candle close confirmation
            }
        };
    }

    // 3. Target Threshold (Right Hand Side)
    // What are we comparing against? Static Value? Another Indicator? A Drawing?
    if (alert.targetType === 'drawing') {
        const drawing = allDrawings.find(d => d.id === alert.targetValue);
        if (drawing) {
            config.target = {
                type: 'drawing',
                ...serializeDrawingAlert(drawing) // Embeds geometric params
            };
        } else {
            config.target = { type: 'unknown_drawing', id: alert.targetValue };
        }
    } else if (alert.targetType === 'indicator') {
        // Comparing Indicator vs Indicator? 
        // Current UI might not support this fully, but structure allows it.
        // Assuming target IS the value we monitor, usually compared to static number?
        // Wait, current logic: targetType='indicator' means Source=Indicator? 
        // Let's re-read usePriceAlerts logic:
        // if (alert.targetType === 'indicator') -> Source = Indicator, Target = float(alert.target)?
        // No, look at `usePriceAlerts.js`:
        // if targetType == 'indicator', currentPrice = data[alert.targetValue].
        // AND THEN targetPrice = parseFloat(alert.target).
        // SO: Source=Indicator, Target=Static Number.

        config.target = {
            type: 'static_value',
            value: parseFloat(alert.target)
        };
    } else {
        // targetType='price' (Simple Alert) -> Source=Price, Target=Static Number
        config.target = {
            type: 'static_value',
            value: parseFloat(alert.target)
        };
    }

    // 4. Trigger Condition
    // How do we compare Source vs Target?
    config.trigger = {
        condition: alert.condition, // 'crossing_up', 'crossing_down'
        confirmation: alert.confirmation || 'realtime', // 'candle_close'
        delaySeconds: alert.delaySeconds || 0,
        delayCandles: alert.delayCandles || 0
    };

    // 5. Actions (Side Effects)
    config.actions = {
        notification: !!alert.actions?.notification,
        email: !!alert.actions?.email,
        webhook: alert.actions?.webhook || null
    };

    return config;
};

/**
 * Example Usage:
 * const fullConfig = serializeAlertConfig(myAlertObject, myDrawingsList);
 * sendToBackend(fullConfig);
 */
