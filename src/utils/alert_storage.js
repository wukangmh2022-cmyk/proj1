const ALERTS_KEY = 'binance_alerts';
const ALERT_HISTORY_KEY = 'binance_alert_history';

// Get all alerts, optionally filtered by symbol
export const getAlerts = (symbol = null) => {
    const stored = localStorage.getItem(ALERTS_KEY);
    let alerts = [];
    if (stored) {
        try {
            alerts = JSON.parse(stored);
        } catch {
            alerts = [];
        }
    }
    if (symbol) {
        return alerts.filter(a => a.symbol === symbol);
    }
    return alerts;
};

// Save a new alert or update existing
export const saveAlert = (alert) => {
    const alerts = getAlerts();
    const index = alerts.findIndex(a => a.id === alert.id);
    if (index >= 0) {
        alerts[index] = alert;
    } else {
        alerts.push(alert);
    }
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    return alerts;
};

// Remove an alert by ID
export const removeAlert = (id) => {
    let alerts = getAlerts();
    alerts = alerts.filter(a => a.id !== id);
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    return alerts;
};

// History Management
export const getAlertHistory = () => {
    const stored = localStorage.getItem(ALERT_HISTORY_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch {
            return [];
        }
    }
    return [];
};

export const addAlertHistory = (log) => {
    const history = getAlertHistory();
    // Add new log to beginning
    history.unshift({
        ...log,
        timestamp: Date.now()
    });
    // Keep last 50 logs
    if (history.length > 50) {
        history.length = 50;
    }
    localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(history));
    return history;
};

export const clearAlertHistory = () => {
    localStorage.removeItem(ALERT_HISTORY_KEY);
    return [];
};
