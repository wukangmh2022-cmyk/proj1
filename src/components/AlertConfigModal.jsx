import { useState, useEffect } from 'react';
import { getAlerts, saveAlert, removeAlert, getAlertHistory } from '../utils/alert_storage';
import '../App.css';

export default function AlertConfigModal({ symbol, currentPrice, onClose }) {
    const [targetType, setTargetType] = useState('price'); // 'price' or 'indicator'
    const [targetValue, setTargetValue] = useState(currentPrice || ''); // For price: "95000", For indicator: "sma7"
    const [indicatorType, setIndicatorType] = useState('sma');
    const [indicatorPeriod, setIndicatorPeriod] = useState(7);

    const [confirmation, setConfirmation] = useState('immediate'); // 'immediate', 'time_delay', 'candle_close'
    const [delay, setDelay] = useState(0);

    const [actions, setActions] = useState({
        toast: true,
        notification: true,
        vibration: 'once'
    });

    const [activeTab, setActiveTab] = useState('new');
    const [myAlerts, setMyAlerts] = useState([]);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        loadData();
    }, [symbol]);

    const loadData = () => {
        setMyAlerts(getAlerts(symbol));
        setHistory(getAlertHistory().filter(h => h.symbol === symbol));
    };

    const handleCreate = () => {
        // Construct target key 
        let finalTarget = targetValue;
        let finalTargetValue = targetValue;

        // Construct indicator key if needed
        if (targetType === 'indicator') {
            const key = `${indicatorType.toLowerCase()}${indicatorPeriod}`;
            finalTarget = key; // Display Name / Logic Key
            finalTargetValue = key;
        } else {
            if (!targetValue) return;
            finalTarget = parseFloat(targetValue);
            finalTargetValue = finalTarget;
        }

        // Auto-determine direction
        let condition = 'crossing_up';
        if (targetType === 'price' && currentPrice > finalTarget) {
            condition = 'crossing_down';
        }

        // Create Alert Object
        const newAlert = {
            id: crypto.randomUUID(),
            symbol,
            targetType, // 'price' or 'indicator'
            target: finalTarget, // "95000" or "sma7"
            targetValue: finalTargetValue, // same
            condition,
            confirmation, // 'immediate', 'time_delay', 'candle_close'
            delaySeconds: confirmation === 'time_delay' ? parseInt(delay) : 0,
            actions,
            active: true,
            createdAt: Date.now()
        };

        saveAlert(newAlert);
        loadData();
        setActiveTab('list');
    };

    const handleDelete = (id) => {
        removeAlert(id);
        loadData();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal alert-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>🔔 {symbol} Pro Alerts</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="tabs">
                    <button className={activeTab === 'new' ? 'active' : ''} onClick={() => setActiveTab('new')}>New</button>
                    <button className={activeTab === 'list' ? 'active' : ''} onClick={() => setActiveTab('list')}>Active ({myAlerts.length})</button>
                    <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>History</button>
                </div>

                <div className="modal-content">
                    {activeTab === 'new' && (
                        <div className="new-alert-form">

                            {/* Target Config */}
                            <div className="input-group">
                                <label>Trigger Target</label>
                                <div className="radio-group" style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center' }}>
                                        <input type="radio" checked={targetType === 'price'} onChange={() => setTargetType('price')} /> Price
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center' }}>
                                        <input type="radio" checked={targetType === 'indicator'} onChange={() => setTargetType('indicator')} /> Indicator
                                    </label>
                                </div>

                                {targetType === 'price' ? (
                                    <input
                                        type="number"
                                        placeholder={`Current: ${currentPrice}`}
                                        value={targetValue}
                                        onChange={e => setTargetValue(e.target.value)}
                                    />
                                ) : (
                                    <div className="indicator-config" style={{ display: 'flex', gap: '10px' }}>
                                        <select value={indicatorType} onChange={e => setIndicatorType(e.target.value)} style={{ flex: 1, padding: '8px', background: '#333', color: 'white', border: 'none' }}>
                                            <option value="sma">SMA</option>
                                            <option value="ema">EMA</option>
                                        </select>
                                        <select value={indicatorPeriod} onChange={e => setIndicatorPeriod(e.target.value)} style={{ flex: 1, padding: '8px', background: '#333', color: 'white', border: 'none' }}>
                                            <option value="7">7</option>
                                            <option value="25">25</option>
                                            <option value="99">99</option>
                                        </select>
                                    </div>
                                )}
                            </div>

                            {/* Confirmation Config */}
                            <div className="input-group">
                                <label>Confirmation Mode</label>
                                <select value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ width: '100%', padding: '10px', background: '#333', color: 'white', marginBottom: '8px' }}>
                                    <option value="immediate">Immediate (Touch)</option>
                                    <option value="time_delay">Time Delay (Seconds)</option>
                                    <option value="candle_close">Candle Close (1m)</option>
                                </select>

                                {confirmation === 'time_delay' && (
                                    <div className="range-wrap">
                                        <input
                                            type="range"
                                            min="5"
                                            max="60"
                                            step="5"
                                            value={delay}
                                            onChange={e => setDelay(e.target.value)}
                                        />
                                        <span>{delay}s</span>
                                    </div>
                                )}
                            </div>

                            <div className="actions-config">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={actions.toast}
                                        onChange={e => setActions({ ...actions, toast: e.target.checked })}
                                    /> Toast Popup
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={actions.notification}
                                        onChange={e => setActions({ ...actions, notification: e.target.checked })}
                                    /> Banner Notification
                                </label>

                                <div className="vibration-select">
                                    <label>Vibration:</label>
                                    <select value={actions.vibration} onChange={e => setActions({ ...actions, vibration: e.target.value })}>
                                        <option value="none">None</option>
                                        <option value="once">Once (Short)</option>
                                        <option value="continuous">Continuous (Long)</option>
                                    </select>
                                </div>
                            </div>

                            <button className="btn btn-primary full-width" onClick={handleCreate}>Create Alert</button>
                        </div>
                    )}

                    {activeTab === 'list' && (
                        <div className="alert-list">
                            {myAlerts.length === 0 ? <p className="empty-state">No active alerts</p> :
                                myAlerts.map(alert => (
                                    <div key={alert.id} className="alert-item">
                                        <div className="alert-info">
                                            <span className="condition">
                                                {alert.targetType === 'indicator' ? `📈 ${alert.targetValue.toUpperCase()}` : `💲 ${alert.target}`}
                                            </span>
                                            <span className="target-price" style={{ fontSize: '12px', color: '#888' }}>
                                                {alert.confirmation === 'candle_close' ? '🕯️ On Close' : alert.delaySeconds > 0 ? `⏳ ${alert.delaySeconds}s` : '⚡ Immediate'}
                                            </span>
                                        </div>
                                        <button className="btn-delete" onClick={() => handleDelete(alert.id)}>🗑️</button>
                                    </div>
                                ))
                            }
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="history-list">
                            {history.length === 0 ? <p className="empty-state">No history</p> :
                                history.map((log, i) => (
                                    <div key={i} className="history-item">
                                        <div className="time">{new Date(log.timestamp).toLocaleTimeString()}</div>
                                        <div className="msg">{log.message}</div>
                                    </div>
                                ))
                            }
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
