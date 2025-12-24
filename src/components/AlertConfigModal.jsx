import { useState, useEffect } from 'react';
import { getAlerts, saveAlert, removeAlert, getAlertHistory } from '../utils/alert_storage';
import '../App.css'; // Reuse existing styles

export default function AlertConfigModal({ symbol, currentPrice, onClose }) {
    const [target, setTarget] = useState(currentPrice || '');
    const [delay, setDelay] = useState(0);
    const [actions, setActions] = useState({
        toast: true,
        notification: true,
        vibration: 'once' // none, once, continuous
    });

    const [activeTab, setActiveTab] = useState('new'); // 'new', 'list', 'history'
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
        if (!target) return;

        // Auto-determine direction
        const price = parseFloat(currentPrice);
        const targetVal = parseFloat(target);
        const condition = targetVal > price ? 'crossing_up' : 'crossing_down';

        const newAlert = {
            id: crypto.randomUUID(),
            symbol,
            target: targetVal,
            condition,
            delaySeconds: parseInt(delay),
            actions,
            active: true,
            createdAt: Date.now()
        };

        saveAlert(newAlert);
        loadData();
        setActiveTab('list');
        setTarget(currentPrice); // Reset input
    };

    const handleDelete = (id) => {
        removeAlert(id);
        loadData();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal alert-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>🔔 {symbol} Alerts</h2>
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
                            <div className="input-group">
                                <label>Target Price (Current: {currentPrice})</label>
                                <input type="number" value={target} onChange={e => setTarget(e.target.value)} />
                            </div>

                            <div className="input-group">
                                <label>Delay Confirmation (Seconds)</label>
                                <div className="range-wrap">
                                    <input
                                        type="range"
                                        min="0"
                                        max="60"
                                        step="5"
                                        value={delay}
                                        onChange={e => setDelay(e.target.value)}
                                    />
                                    <span>{delay}s</span>
                                </div>
                                <small>Alert only fires if price stays beyond target for {delay}s</small>
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
                                                {alert.condition === 'crossing_up' ? '↗️ Cross Above' : '↘️ Cross Below'}
                                            </span>
                                            <span className="target-price">${alert.target}</span>
                                            {alert.delaySeconds > 0 && <span className="badge-delay">⏳ {alert.delaySeconds}s</span>}
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
