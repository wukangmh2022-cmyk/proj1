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
    const [sliderVal, setSliderVal] = useState(0); // 0-100 linear state for slider
    const [delayCandles, setDelayCandles] = useState(0);
    const [soundId, setSoundId] = useState(1); // Default Sound 1

    const [actions, setActions] = useState({
        toast: true,
        notification: true,
        vibration: 'once'
    });

    const [activeTab, setActiveTab] = useState('new');
    const [myAlerts, setMyAlerts] = useState([]);
    const [history, setHistory] = useState([]);
    const [editId, setEditId] = useState(null);

    // Drawings
    const [availableDrawings, setAvailableDrawings] = useState([]);

    useEffect(() => {
        loadData();
    }, [symbol]);

    const loadData = () => {
        setMyAlerts(getAlerts(symbol));
        setHistory(getAlertHistory().filter(h => h.symbol === symbol));

        // Load drawings for this symbol
        try {
            const saved = localStorage.getItem(`chart_drawings_${symbol}`);
            if (saved) {
                setAvailableDrawings(JSON.parse(saved));
            } else {
                setAvailableDrawings([]);
            }
        } catch (e) { console.error(e); }
    };

    const handleEdit = (alert) => {
        setEditId(alert.id);
        setTargetType(alert.targetType);
        setTargetValue(alert.targetValue);
        setDirection(alert.condition);
        if (alert.targetType === 'indicator') {
            // Extract indicatorType and indicatorPeriod from targetValue string
            if (alert.targetValue.startsWith('rsi')) {
                setIndicatorType('rsi');
                setIndicatorPeriod(parseInt(alert.targetValue.replace('rsi', '')));
                setTargetValue(alert.target); // For RSI, target is the threshold
            } else if (alert.targetValue.startsWith('fib')) {
                setIndicatorType('fib');
                setTargetValue(alert.targetValue.replace('fib_', '')); // For Fib, targetValue is the high_low_ratio string
            } else {
                // SMA/EMA
                const match = alert.targetValue.match(/([a-z]+)(\d+)/i);
                if (match) {
                    setIndicatorType(match[1].toLowerCase());
                    setIndicatorPeriod(parseInt(match[2]));
                }
            }
        }
        setConfirmation(alert.confirmation);
        if (alert.interval) setInterval(alert.interval);
        if (alert.interval) setInterval(alert.interval);
        setDelay(alert.delaySeconds || 10);
        // Sync slider
        const d = alert.delaySeconds || 10;
        setSliderVal(Math.round(Math.log(Math.max(10, d) / 10) / Math.log(1080) * 100));
        setDelayCandles(alert.delayCandles || 0);
        setDelayCandles(alert.delayCandles || 0);
        setSoundId(alert.soundId || 1);
        setActions(alert.actions);
        setActiveTab('new');
    };

    const handleCreate = () => {
        let finalTarget = null; // The actual numeric value to compare against (e.g., price, RSI threshold, calculated fib level)
        let finalTargetValue = null; // The string representation of the target (e.g., "100", "rsi7", "fib_100_90_0.618", "drawing_id")

        if (targetType === 'indicator') {
            if (indicatorType === 'rsi') {
                // targetValue is the threshold (e.g., "70")
                finalTargetValue = `rsi${indicatorPeriod}`;
                finalTarget = parseFloat(targetValue) || 70;
            } else if (indicatorType === 'fib') {
                // targetValue is the "high_low_ratio" string
                finalTargetValue = `fib_${targetValue}`;
                const parts = targetValue.split('_');
                if (parts.length >= 3) {
                    const high = parseFloat(parts[0]);
                    const low = parseFloat(parts[1]);
                    const ratio = parseFloat(parts[2]);
                    finalTarget = high - (high - low) * ratio;
                }
            } else {
                // SMA/EMA: targetValue is the indicator key (e.g., "sma7")
                const key = `${indicatorType.toLowerCase()}${indicatorPeriod}`;
                finalTarget = key; // For indicators like SMA/EMA, the target itself is the key string
                finalTargetValue = key;
            }
        } else if (targetType === 'drawing') {
            finalTargetValue = targetValue; // The Drawing ID
            finalTarget = 0; // Placeholder, actual comparison happens against drawing lines
        } else { // targetType === 'price'
            if (!targetValue) return;
            finalTarget = parseFloat(targetValue);
            finalTargetValue = finalTarget; // For price, target and targetValue are the same numeric value
        }

        const newAlert = {
            id: editId || crypto.randomUUID(),
            symbol,
            targetType,
            target: finalTarget,
            targetValue: finalTargetValue,
            condition: direction,
            confirmation,
            interval: (confirmation === 'candle_close' || confirmation === 'candle_delay' || targetType === 'indicator') ? interval : '1m',
            delaySeconds: confirmation === 'time_delay' ? parseInt(delay) : 0,
            delayCandles: confirmation === 'candle_delay' ? parseInt(delayCandles) : 0,
            soundId: parseInt(soundId),
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
        setIndicatorType('sma');
        setIndicatorPeriod(7);
        setInterval('1m');
        setDelay(10);
        setSliderVal(0);
        setDelayCandles(0);
        setActions({
            toast: true,
            notification: true,
            vibration: 'once'
        });
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
                                    <button className={targetType === 'indicator' ? 'active' : ''} onClick={() => setTargetType('indicator')}>📊 指标</button>
                                    <button className={targetType === 'drawing' ? 'active' : ''} onClick={() => setTargetType('drawing')}>🖍 图形</button>
                                </div>

                                {targetType === 'price' ? (
                                    <input
                                        type="number"
                                        className="form-input"
                                        placeholder={`当前价格: ${currentPrice}`}
                                        value={targetValue}
                                        onChange={e => setTargetValue(e.target.value)}
                                    />
                                ) : targetType === 'indicator' ? (
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

                                        {indicatorType === 'fib' && (() => {
                                            const fibParts = String(targetValue || '__0.618').split('_');
                                            const fibHigh = fibParts[0] || '';
                                            const fibLow = fibParts[1] || '';
                                            const fibRatio = fibParts[2] || '0.618';
                                            const fibLevel = fibHigh && fibLow ?
                                                (parseFloat(fibHigh) - (parseFloat(fibHigh) - parseFloat(fibLow)) * parseFloat(fibRatio)).toFixed(2) : '?';
                                            return (
                                                <>
                                                    {/* Fibonacci diagram */}
                                                    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '12px', marginTop: '12px' }}>
                                                        <svg width="100%" height="100" viewBox="0 0 200 100">
                                                            {/* Price scale */}
                                                            <line x1="20" y1="10" x2="20" y2="90" stroke="#444" strokeWidth="1" />

                                                            {/* High line */}
                                                            <line x1="20" y1="15" x2="180" y2="15" stroke="#00d68f" strokeWidth="2" strokeDasharray="4,2" />
                                                            <text x="25" y="12" fill="#00d68f" fontSize="10">高点 {fibHigh || '?'}</text>

                                                            {/* Fib level line */}
                                                            <line x1="20" y1="50" x2="180" y2="50" stroke="#fcd535" strokeWidth="2" />
                                                            <text x="25" y="47" fill="#fcd535" fontSize="10">{(parseFloat(fibRatio) * 100).toFixed(1)}% = {fibLevel}</text>

                                                            {/* Low line */}
                                                            <line x1="20" y1="85" x2="180" y2="85" stroke="#ff4757" strokeWidth="2" strokeDasharray="4,2" />
                                                            <text x="25" y="97" fill="#ff4757" fontSize="10">低点 {fibLow || '?'}</text>

                                                            {/* Price movement illustration */}
                                                            <path d="M 40 85 Q 80 85 100 15 Q 130 15 150 50" stroke="#888" strokeWidth="1.5" fill="none" />
                                                            <circle cx="150" cy="50" r="4" fill="#fcd535" />
                                                        </svg>
                                                    </div>
                                                    <div className="sub-option" style={{ marginTop: '12px' }}>
                                                        <label>高点价格</label>
                                                        <input type="number" className="form-input" placeholder="如 100000"
                                                            value={fibHigh}
                                                            onChange={e => setTargetValue(`${e.target.value}_${fibLow}_${fibRatio}`)} />
                                                    </div>
                                                    <div className="sub-option">
                                                        <label>低点价格</label>
                                                        <input type="number" className="form-input" placeholder="如 90000"
                                                            value={fibLow}
                                                            onChange={e => setTargetValue(`${fibHigh}_${e.target.value}_${fibRatio}`)} />
                                                    </div>
                                                    <div className="sub-option">
                                                        <label>回撤线</label>
                                                        <select value={fibRatio}
                                                            onChange={e => setTargetValue(`${fibHigh}_${fibLow}_${e.target.value}`)}>
                                                            <option value="0.236">23.6%</option>
                                                            <option value="0.382">38.2%</option>
                                                            <option value="0.5">50%</option>
                                                            <option value="0.618">61.8%</option>
                                                            <option value="0.786">78.6%</option>
                                                        </select>
                                                    </div>
                                                </>
                                            );
                                        })()}

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
                                ) : ( // targetType === 'drawing'
                                    <div className="indicator-row">
                                        {availableDrawings.length === 0 ? (
                                            <div style={{ color: '#888', padding: 10, textAlign: 'center', width: '100%' }}>
                                                暂无图形，请先在图表上绘制
                                            </div>
                                        ) : (
                                            <select value={targetValue} onChange={e => setTargetValue(e.target.value)} style={{ width: '100%' }}>
                                                <option value="">-- 选择图形 --</option>
                                                {availableDrawings.map(d => (
                                                    <option key={d.id} value={d.id}>
                                                        {d.type.toUpperCase()} ({d.id.substring(0, 8)})
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                                            {targetValue ? '提示: 将监控价格穿越该图形的任意线条' : ''}
                                        </div>
                                    </div>
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
                                    <button className={confirmation === 'candle_delay' ? 'active' : ''} onClick={() => setConfirmation('candle_delay')}>
                                        🔢 延迟K线 <span className="hint">连续N根</span>
                                    </button>
                                </div>

                                {/* Sub-options */}
                                {(confirmation === 'candle_close' || confirmation === 'candle_delay' || targetType === 'indicator') && (
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

                                {confirmation === 'candle_delay' && (
                                    <div className="sub-option">
                                        <label>连续满足根数 (当前: {delayCandles}根)</label>
                                        <div className="slider-row">
                                            <input
                                                type="range"
                                                min="1" max="10" step="1"
                                                value={delayCandles}
                                                onChange={e => setDelayCandles(parseInt(e.target.value))}
                                            />
                                        </div>
                                    </div>
                                )}

                                {confirmation === 'time_delay' && (
                                    <div className="sub-option">
                                        <label>延迟时间</label>
                                        <div className="slider-row">
                                            <input
                                                type="range"
                                                min="0" max="100" step="1"
                                                value={sliderVal}
                                                onChange={e => {
                                                    const p = parseInt(e.target.value);
                                                    setSliderVal(p); // Smooth update

                                                    let v = 10 * Math.pow(1080, p / 100);
                                                    // Smart stepping logic for business value
                                                    if (v < 60) v = Math.round(v / 5) * 5;
                                                    else if (v < 300) v = Math.round(v / 10) * 10;
                                                    else if (v < 3600) v = Math.round(v / 60) * 60;
                                                    else v = Math.round(v / 300) * 300;
                                                    setDelay(Math.min(10800, Math.max(10, v)));
                                                }}
                                            />
                                            <span className="slider-value" style={{ minWidth: '4.5em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                                {delay < 60 ? `${delay}秒`
                                                    : delay < 3600 ? `${Math.floor(delay / 60)}分${delay % 60 ? ` ${delay % 60}秒` : ''}`
                                                        : `${(delay / 3600).toFixed(1).replace('.0', '')}小时`}
                                            </span>
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
                                    <div className="checkbox-row">
                                        <input type="checkbox" checked={actions.vibration === 'once'} onChange={() => setActions({ ...actions, vibration: actions.vibration === 'once' ? 'none' : 'once' })} />
                                        <span>振动提醒</span>
                                    </div>

                                    <div className="sub-option" style={{ marginTop: '12px' }}>
                                        <label>🔔 提示音效</label>
                                        <select value={soundId} onChange={e => setSoundId(e.target.value)} style={{ width: '100%' }}>
                                            <option value="0">静音</option>
                                            <option value="1">Success (Major)</option>
                                            <option value="2">Danger (Siren)</option>
                                            <option value="3">Coin (Mario)</option>
                                            <option value="4">Laser (Drop)</option>
                                            <option value="5">Rise (Uplift)</option>
                                            <option value="6">Notification (Pop)</option>
                                            <option value="7">Tech (High)</option>
                                            <option value="8">Low Battery</option>
                                            <option value="9">Confirm (Beep)</option>
                                            <option value="10">Attention</option>
                                        </select>
                                    </div>
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
                                                {(() => {
                                                    if (alert.targetType === 'price') return `$${alert.target}`;
                                                    if (alert.targetType === 'drawing') return `图形 ${alert.targetValue}`;
                                                    if (alert.targetType === 'indicator') {
                                                        const t = alert.targetValue;
                                                        if (t.startsWith('rsi')) return `RSI${t.slice(3)} @ ${alert.target}`;
                                                        if (t.startsWith('sma')) return `SMA${t.slice(3)}`;
                                                        if (t.startsWith('ema')) return `EMA${t.slice(3)}`;
                                                        if (t.startsWith('fib')) return `Fib ${(alert.targetValue.split('_')[2] || '')}`;
                                                        return t.toUpperCase();
                                                    }
                                                    return alert.targetValue;
                                                })()}
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
        </div >
    );
}
