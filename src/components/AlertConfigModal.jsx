import { useState, useEffect } from 'react';
import { getAlerts, saveAlert, removeAlert, getAlertHistory } from '../utils/alert_storage';
import '../App.css';

export default function AlertConfigModal({ symbol, currentPrice, onClose }) {
    const [targetType, setTargetType] = useState('price'); // 'price' or 'indicator'
    const [targetValue, setTargetValue] = useState(currentPrice || '');
    const [direction, setDirection] = useState('crossing_up'); // 'crossing_up', 'crossing_down'
    const [indicatorType, setIndicatorType] = useState('sma');
    const [indicatorPeriod, setIndicatorPeriod] = useState(7);

    const [confirmation, setConfirmation] = useState('immediate'); // 'immediate', 'time_delay', 'candle_close'
    const [interval, setInterval] = useState('1m'); // New: 1m, 5m, etc.
    const [delay, setDelay] = useState(0); // For time delay (seconds)
    const [delayCandles, setDelayCandles] = useState(0); // For candle delay (count)

    const [actions, setActions] = useState({
        toast: true,
        notification: true,
        vibration: 'once'
    });

    const [activeTab, setActiveTab] = useState('new');
    const [myAlerts, setMyAlerts] = useState([]);
    const [history, setHistory] = useState([]);
    const [editId, setEditId] = useState(null); // ID of alert being edited

    useEffect(() => {
        loadData();
    }, [symbol]);

    const loadData = () => {
        setMyAlerts(getAlerts(symbol));
        setHistory(getAlertHistory().filter(h => h.symbol === symbol));
    };

    const handleEdit = (alert) => {
        setEditId(alert.id);
        setTargetType(alert.targetType);
        setTargetValue(alert.targetValue);
        setDirection(alert.condition);

        // Parse target if indicator
        if (alert.targetType === 'indicator') {
            // e.g. sma7
            const type = alert.targetValue.replace(/[0-9]/g, '');
            const period = alert.targetValue.replace(/[a-z]/g, '');
            setIndicatorType(type);
            setIndicatorPeriod(period);
        }

        setConfirmation(alert.confirmation);
        if (alert.interval) setInterval(alert.interval);
        setDelay(alert.delaySeconds || 0);
        setDelayCandles(alert.delayCandles || 0);
        setActions(alert.actions);

        setActiveTab('new');
    };

    const handleCreate = () => {
        let finalTarget = targetValue;
        let finalTargetValue = targetValue;

        if (targetType === 'indicator') {
            const key = `${indicatorType.toLowerCase()}${indicatorPeriod}`;
            finalTarget = key;
            finalTargetValue = key;
        } else {
            if (!targetValue) return;
            finalTarget = parseFloat(targetValue);
            finalTargetValue = finalTarget;
        }

        const newAlert = {
            id: editId || crypto.randomUUID(), // Use existing ID if editing
            symbol,
            targetType,
            target: finalTarget,
            targetValue: finalTargetValue,
            condition: direction,
            confirmation,
            interval: confirmation === 'candle_close' || targetType === 'indicator' ? interval : null,
            delaySeconds: confirmation === 'time_delay' ? parseInt(delay) : 0,
            delayCandles: confirmation === 'candle_close' ? parseInt(delayCandles) : 0,
            actions,
            active: true,
            createdAt: editId ? (myAlerts.find(a => a.id === editId)?.createdAt || Date.now()) : Date.now()
        };

        saveAlert(newAlert);
        loadData();
        setEditId(null); // Reset edit mode
        setActiveTab('list');

        // Reset form for next use (optional, but good UX)
        if (!editId) {
            // Only reset if it was a new creation, or fully reset? 
            // Let's keep values as previous for convenience or reset? 
            // Let's reset ID at least.
        }
    };

    const handleDelete = (id, e) => {
        e.stopPropagation();
        removeAlert(id);
        if (editId === id) setEditId(null);
        loadData();
    };

    const resetForm = () => {
        setEditId(null);
        setTargetType('price');
        setTargetValue(currentPrice || '');
        setDirection('crossing_up');
        setConfirmation('immediate');
        // ... reset others if needed
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal alert-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>🔔 {symbol} 预警配置</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="tabs">
                    <button className={activeTab === 'new' ? 'active' : ''} onClick={() => { setActiveTab('new'); if (editId) resetForm(); }}>
                        {editId ? '编辑中' : '新建'}
                    </button>
                    <button className={activeTab === 'list' ? 'active' : ''} onClick={() => setActiveTab('list')}>列表 ({myAlerts.length})</button>
                    <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>历史</button>
                </div>

                <div className="modal-content">
                    {activeTab === 'new' && (
                        <div className="new-alert-form">
                            {/* Target Config */}
                            <div className="input-group">
                                <label>触发目标</label>
                                <div className="radio-group" style={{ display: 'flex', gap: '15px', marginBottom: '10px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <input type="radio" checked={targetType === 'price'} onChange={() => setTargetType('price')} /> 价格
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <input type="radio" checked={targetType === 'indicator'} onChange={() => setTargetType('indicator')} /> 技术指标
                                    </label>
                                </div>

                                {targetType === 'price' ? (
                                    <input
                                        type="number"
                                        placeholder={`当前: ${currentPrice}`}
                                        value={targetValue}
                                        onChange={e => setTargetValue(e.target.value)}
                                    />
                                ) : (
                                    <div className="indicator-config" style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                        <select value={indicatorType} onChange={e => setIndicatorType(e.target.value)} style={{ flex: 1 }}>
                                            <option value="sma">SMA (移动平均)</option>
                                            <option value="ema">EMA (指数平均)</option>
                                        </select>
                                        <select value={indicatorPeriod} onChange={e => setIndicatorPeriod(e.target.value)} style={{ width: '80px' }}>
                                            <option value="7">7</option>
                                            <option value="25">25</option>
                                            <option value="99">99</option>
                                        </select>
                                    </div>
                                )}
                            </div>

                            {/* Direction Config */}
                            <div className="input-group">
                                <label>触发方向</label>
                                <div className="radio-group" style={{ display: 'flex', gap: '15px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <input type="radio" checked={direction === 'crossing_up'} onChange={() => setDirection('crossing_up')} /> 📈 上穿 (涨破)
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <input type="radio" checked={direction === 'crossing_down'} onChange={() => setDirection('crossing_down')} /> 📉 下穿 (跌破)
                                    </label>
                                </div>
                            </div>

                            {/* Confirmation Config */}
                            <div className="input-group">
                                <label>确认模式</label>
                                <select value={confirmation} onChange={e => setConfirmation(e.target.value)} style={{ width: '100%', marginBottom: '10px' }}>
                                    <option value="immediate">⚡ 立即触发 (触碰即报)</option>
                                    <option value="time_delay">⏳ 时间延迟 (防止插针)</option>
                                    <option value="candle_close">🕯️ K线收盘确认 (稳健)</option>
                                </select>

                                {/* Sub-settings: Interval */}
                                {(confirmation === 'candle_close' || targetType === 'indicator') && (
                                    <div style={{ marginBottom: '10px' }}>
                                        <label style={{ fontSize: '12px', color: '#888' }}>K线周期</label>
                                        <select value={interval} onChange={e => setInterval(e.target.value)} style={{ width: '100%' }}>
                                            <option value="1m">1 分钟</option>
                                            <option value="5m">5 分钟</option>
                                            <option value="15m">15 分钟</option>
                                            <option value="1h">1 小时</option>
                                            <option value="4h">4 小时</option>
                                            <option value="1d">1 天</option>
                                        </select>
                                    </div>
                                )}

                                {/* Sub-settings: Time Delay */}
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
                                        <span>{delay}秒</span>
                                    </div>
                                )}

                                {/* Sub-settings: Candle Delay */}
                                {confirmation === 'candle_close' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <label style={{ fontSize: '12px', color: '#888', flex: 1 }}>延迟确认 (根K线)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="10"
                                            value={delayCandles}
                                            onChange={e => setDelayCandles(e.target.value)}
                                            style={{ width: '60px', padding: '5px' }}
                                        />
                                        <span style={{ fontSize: '12px', color: '#666' }}>0=本根收盘</span>
                                    </div>
                                )}
                            </div>

                            <div className="actions-config">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={actions.toast}
                                        onChange={e => setActions({ ...actions, toast: e.target.checked })}
                                    /> 弹窗提示 (Toast)
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={actions.notification}
                                        onChange={e => setActions({ ...actions, notification: e.target.checked })}
                                    /> 通知栏推送
                                </label>

                                <div className="vibration-select">
                                    <label>震动反馈:</label>
                                    <select value={actions.vibration} onChange={e => setActions({ ...actions, vibration: e.target.value })}>
                                        <option value="none">无</option>
                                        <option value="once">短震动 (一次)</option>
                                        <option value="continuous">长震动 (持续)</option>
                                    </select>
                                </div>
                            </div>

                            <button className="btn btn-primary full-width" onClick={handleCreate}>
                                {editId ? '保存修改' : '创建预警'}
                            </button>
                        </div>
                    )}

                    {activeTab === 'list' && (
                        <div className="alert-list">
                            {myAlerts.length === 0 ? <p className="empty-state">暂无激活的预警</p> :
                                myAlerts.map(alert => (
                                    <div key={alert.id} className="alert-item" onClick={() => handleEdit(alert)}>
                                        <div className="alert-info">
                                            <span className="condition">
                                                {alert.condition === 'crossing_up' ? '📈 上穿' : '📉 下穿'} {alert.targetType === 'indicator' ? alert.targetValue.toUpperCase() : alert.target}
                                            </span>
                                            <span className="target-price" style={{ fontSize: '12px', color: '#888' }}>
                                                {alert.confirmation === 'candle_close'
                                                    ? `🕯️ ${alert.interval} 收盘${alert.delayCandles > 0 ? ` +${alert.delayCandles}根` : ''}`
                                                    : alert.delaySeconds > 0 ? `⏳ 延迟 ${alert.delaySeconds}秒` : '⚡ 立即'}
                                            </span>
                                        </div>
                                        <button className="btn-delete" onClick={(e) => handleDelete(alert.id, e)}>🗑️</button>
                                    </div>
                                ))
                            }
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="history-list">
                            {history.length === 0 ? <p className="empty-state">暂无历史记录</p> :
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
