import { useState, useEffect } from 'react';
import { getAlerts, saveAlert, removeAlert, getAlertHistory } from '../utils/alert_storage';
import './AlertConfigModal.css';

export default function AlertConfigModal({ symbol, currentPrice, onClose }) {
    const [targetType, setTargetType] = useState('price');
    const [targetValue, setTargetValue] = useState(currentPrice || '');
    const [direction, setDirection] = useState('crossing_up');
    const [indicatorType, setIndicatorType] = useState('sma');
    const [indicatorPeriod, setIndicatorPeriod] = useState(7);

    const [confirmation, setConfirmation] = useState('immediate');
    const [interval, setInterval] = useState('1m');
    const [delay, setDelay] = useState(10);
    const [delayCandles, setDelayCandles] = useState(0);

    const [actions, setActions] = useState({
        toast: true,
        notification: true,
        vibration: 'once'
    });

    const [activeTab, setActiveTab] = useState('new');
    const [myAlerts, setMyAlerts] = useState([]);
    const [history, setHistory] = useState([]);
    const [editId, setEditId] = useState(null);

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
        if (alert.targetType === 'indicator') {
            setIndicatorType(alert.targetValue.replace(/[0-9]/g, ''));
            setIndicatorPeriod(alert.targetValue.replace(/[a-z]/g, ''));
        }
        setConfirmation(alert.confirmation);
        if (alert.interval) setInterval(alert.interval);
        setDelay(alert.delaySeconds || 10);
        setDelayCandles(alert.delayCandles || 0);
        setActions(alert.actions);
        setActiveTab('new');
    };

    const handleCreate = () => {
        let finalTarget = targetValue;
        let finalTargetValue = targetValue;

        if (targetType === 'indicator') {
            if (indicatorType === 'rsi') {
                // RSI: targetValue is the threshold (70, 80, 30, 20)
                finalTargetValue = `rsi${indicatorPeriod}`;
                finalTarget = parseFloat(targetValue) || 70;
            } else if (indicatorType === 'fib') {
                // Fibonacci: targetValue is "high_low_ratio", target calculated from that
                finalTargetValue = `fib_${targetValue}`;
                const parts = targetValue.split('_');
                if (parts.length >= 3) {
                    const high = parseFloat(parts[0]);
                    const low = parseFloat(parts[1]);
                    const ratio = parseFloat(parts[2]);
                    finalTarget = high - (high - low) * ratio;
                }
            } else {
                // SMA/EMA: standard format
                const key = `${indicatorType.toLowerCase()}${indicatorPeriod}`;
                finalTarget = key;
                finalTargetValue = key;
            }
        } else {
            if (!targetValue) return;
            finalTarget = parseFloat(targetValue);
            finalTargetValue = finalTarget;
        }

        const newAlert = {
            id: editId || crypto.randomUUID(),
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
        setEditId(null);
        setActiveTab('list');
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
    };

    return (
        <div className="alert-overlay" onClick={onClose}>
            <div className="alert-panel" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="alert-header">
                    <span className="alert-symbol">🔔 {symbol}</span>
                    <button className="alert-close" onClick={onClose}>×</button>
                </div>

                {/* Tabs */}
                <div className="alert-tabs">
                    <button className={activeTab === 'new' ? 'active' : ''} onClick={() => { setActiveTab('new'); if (editId) resetForm(); }}>
                        {editId ? '编辑' : '新建'}
                    </button>
                    <button className={activeTab === 'list' ? 'active' : ''} onClick={() => setActiveTab('list')}>
                        预警 ({myAlerts.length})
                    </button>
                    <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
                        历史
                    </button>
                </div>

                {/* Content (Scrollable) */}
                <div className="alert-body">
                    {activeTab === 'new' && (
                        <div className="alert-form">
                            {/* Section: Target */}
                            <div className="form-section">
                                <div className="section-title">触发目标</div>
                                <div className="toggle-group">
                                    <button className={targetType === 'price' ? 'active' : ''} onClick={() => setTargetType('price')}>💲 价格</button>
                                    <button className={targetType === 'indicator' ? 'active' : ''} onClick={() => setTargetType('indicator')}>📊 技术指标</button>
                                </div>

                                {targetType === 'price' ? (
                                    <input
                                        type="number"
                                        className="form-input"
                                        placeholder={`当前价格: ${currentPrice}`}
                                        value={targetValue}
                                        onChange={e => setTargetValue(e.target.value)}
                                    />
                                ) : (
                                    <>
                                        <div className="indicator-row">
                                            <select value={indicatorType} onChange={e => setIndicatorType(e.target.value)}>
                                                <option value="sma">SMA 移动均线</option>
                                                <option value="ema">EMA 指数均线</option>
                                                <option value="rsi">RSI 相对强弱</option>
                                                <option value="fib">斐波那契回撤</option>
                                            </select>
                                            {(indicatorType === 'sma' || indicatorType === 'ema') && (
                                                <select value={indicatorPeriod} onChange={e => setIndicatorPeriod(e.target.value)}>
                                                    <option value="7">7</option>
                                                    <option value="25">25</option>
                                                    <option value="99">99</option>
                                                </select>
                                            )}
                                            {indicatorType === 'rsi' && (
                                                <select value={indicatorPeriod} onChange={e => setIndicatorPeriod(e.target.value)}>
                                                    <option value="7">7</option>
                                                    <option value="14">14</option>
                                                    <option value="21">21</option>
                                                </select>
                                            )}
                                        </div>

                                        {indicatorType === 'rsi' && (
                                            <div className="sub-option" style={{ marginTop: '12px' }}>
                                                <label>RSI 阈值</label>
                                                <select value={targetValue} onChange={e => setTargetValue(e.target.value)}>
                                                    <option value="70">超买 70</option>
                                                    <option value="80">超买 80</option>
                                                    <option value="30">超卖 30</option>
                                                    <option value="20">超卖 20</option>
                                                </select>
                                            </div>
                                        )}

                                        {indicatorType === 'fib' && (
                                            <>
                                                <div className="sub-option" style={{ marginTop: '12px' }}>
                                                    <label>高点价格</label>
                                                    <input type="number" className="form-input" placeholder="如 100000"
                                                        value={targetValue.split('_')[0] || ''}
                                                        onChange={e => setTargetValue(`${e.target.value}_${targetValue.split('_')[1] || ''}_${targetValue.split('_')[2] || '0.618'}`)} />
                                                </div>
                                                <div className="sub-option">
                                                    <label>低点价格</label>
                                                    <input type="number" className="form-input" placeholder="如 90000"
                                                        value={targetValue.split('_')[1] || ''}
                                                        onChange={e => setTargetValue(`${targetValue.split('_')[0] || ''}_${e.target.value}_${targetValue.split('_')[2] || '0.618'}`)} />
                                                </div>
                                                <div className="sub-option">
                                                    <label>回撤线</label>
                                                    <select value={targetValue.split('_')[2] || '0.618'}
                                                        onChange={e => setTargetValue(`${targetValue.split('_')[0] || ''}_${targetValue.split('_')[1] || ''}_${e.target.value}`)}>
                                                        <option value="0.236">23.6%</option>
                                                        <option value="0.382">38.2%</option>
                                                        <option value="0.5">50%</option>
                                                        <option value="0.618">61.8%</option>
                                                        <option value="0.786">78.6%</option>
                                                    </select>
                                                </div>
                                            </>
                                        )}

                                        <div className="sub-option" style={{ marginTop: '12px' }}>
                                            <label>K线周期</label>
                                            <select value={interval} onChange={e => setInterval(e.target.value)}>
                                                <option value="1m">1分钟</option>
                                                <option value="5m">5分钟</option>
                                                <option value="15m">15分钟</option>
                                                <option value="1h">1小时</option>
                                                <option value="4h">4小时</option>
                                                <option value="1d">1天</option>
                                            </select>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Section: Direction */}
                            <div className="form-section">
                                <div className="section-title">触发方向</div>
                                <div className="toggle-group">
                                    <button className={direction === 'crossing_up' ? 'active up' : ''} onClick={() => setDirection('crossing_up')}>📈 上穿</button>
                                    <button className={direction === 'crossing_down' ? 'active down' : ''} onClick={() => setDirection('crossing_down')}>📉 下穿</button>
                                </div>
                            </div>

                            {/* Section: Confirmation */}
                            <div className="form-section">
                                <div className="section-title">确认模式</div>
                                <div className="toggle-group vertical">
                                    <button className={confirmation === 'immediate' ? 'active' : ''} onClick={() => setConfirmation('immediate')}>
                                        ⚡ 立即 <span className="hint">触碰即报</span>
                                    </button>
                                    <button className={confirmation === 'time_delay' ? 'active' : ''} onClick={() => setConfirmation('time_delay')}>
                                        ⏳ 延迟 <span className="hint">防止插针</span>
                                    </button>
                                    <button className={confirmation === 'candle_close' ? 'active' : ''} onClick={() => setConfirmation('candle_close')}>
                                        🕯️ K线确认 <span className="hint">收盘确认</span>
                                    </button>
                                </div>

                                {/* Sub-options */}
                                {confirmation === 'candle_close' && targetType === 'price' && (
                                    <div className="sub-option">
                                        <label>K线周期</label>
                                        <select value={interval} onChange={e => setInterval(e.target.value)}>
                                            <option value="1m">1分钟</option>
                                            <option value="5m">5分钟</option>
                                            <option value="15m">15分钟</option>
                                            <option value="1h">1小时</option>
                                            <option value="4h">4小时</option>
                                            <option value="1d">1天</option>
                                        </select>
                                    </div>
                                )}

                                {confirmation === 'time_delay' && (
                                    <div className="sub-option">
                                        <label>延迟时间</label>
                                        <div className="slider-row">
                                            <input type="range" min="5" max="60" step="5" value={delay} onChange={e => setDelay(e.target.value)} />
                                            <span className="slider-value">{delay}秒</span>
                                        </div>
                                    </div>
                                )}

                                {confirmation === 'candle_close' && (
                                    <div className="sub-option">
                                        <label>延迟K根</label>
                                        <div className="stepper">
                                            <button onClick={() => setDelayCandles(Math.max(0, delayCandles - 1))}>−</button>
                                            <span>{delayCandles}</span>
                                            <button onClick={() => setDelayCandles(Math.min(10, delayCandles + 1))}>+</button>
                                        </div>
                                        <span className="hint-inline">0 = 本根收盘</span>
                                    </div>
                                )}
                            </div>

                            {/* Section: Actions */}
                            <div className="form-section">
                                <div className="section-title">触发后动作</div>
                                <div className="action-toggles">
                                    <label className={actions.toast ? 'checked' : ''}>
                                        <input type="checkbox" checked={actions.toast} onChange={e => setActions({ ...actions, toast: e.target.checked })} />
                                        <span>弹窗</span>
                                    </label>
                                    <label className={actions.notification ? 'checked' : ''}>
                                        <input type="checkbox" checked={actions.notification} onChange={e => setActions({ ...actions, notification: e.target.checked })} />
                                        <span>通知</span>
                                    </label>
                                </div>
                                <div className="vibration-row">
                                    <label>震动:</label>
                                    <select value={actions.vibration} onChange={e => setActions({ ...actions, vibration: e.target.value })}>
                                        <option value="none">无</option>
                                        <option value="once">短</option>
                                        <option value="continuous">长</option>
                                    </select>
                                </div>
                            </div>

                            {/* Submit Button */}
                            <button className="submit-btn" onClick={handleCreate}>
                                {editId ? '✓ 保存修改' : '+ 创建预警'}
                            </button>
                        </div>
                    )}

                    {activeTab === 'list' && (
                        <div className="alert-list">
                            {myAlerts.length === 0 ? (
                                <div className="empty-state">暂无预警，点击"新建"添加</div>
                            ) : (
                                myAlerts.map(alert => (
                                    <div key={alert.id} className="list-item" onClick={() => handleEdit(alert)}>
                                        <div className="item-main">
                                            <span className={`direction-tag ${alert.condition === 'crossing_up' ? 'up' : 'down'}`}>
                                                {alert.condition === 'crossing_up' ? '↑' : '↓'}
                                            </span>
                                            <span className="item-target">
                                                {alert.targetType === 'indicator' ? alert.targetValue.toUpperCase() : `$${alert.target}`}
                                            </span>
                                        </div>
                                        <div className="item-meta">
                                            {alert.confirmation === 'candle_close'
                                                ? `${alert.interval} 收盘`
                                                : alert.delaySeconds > 0 ? `${alert.delaySeconds}秒` : '即时'}
                                        </div>
                                        <button className="item-delete" onClick={(e) => handleDelete(alert.id, e)}>×</button>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="history-list-v2">
                            {history.length === 0 ? (
                                <div className="empty-state">暂无历史记录</div>
                            ) : (
                                history.map((log, i) => (
                                    <div key={i} className="history-item-v2">
                                        <span className="history-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                        <span className="history-msg">{log.message}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
