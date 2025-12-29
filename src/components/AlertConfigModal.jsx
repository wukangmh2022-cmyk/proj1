import { useState, useEffect } from 'react';
import { getAlerts, saveAlert, removeAlert, getAlertHistory } from '../utils/alert_storage';
import FloatingWidget from '../plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';
import './AlertConfigModal.css';

const CustomSelect = ({ value, onChange, options, placeholder = '请选择', style = {} }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectedOpt = options.find(o => String(o.value) === String(value));

    return (
        <div style={{ position: 'relative', width: '100%', ...style }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '12px 14px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: `1px solid ${isOpen ? '#fcd535' : 'rgba(255, 255, 255, 0.1)'}`,
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    minHeight: '45px'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedOpt ? selectedOpt.label : <span style={{ color: '#888' }}>{placeholder}</span>}
                </div>
                <span style={{ fontSize: '10px', color: '#888', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </div>

            {isOpen && (
                <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }} onClick={() => setIsOpen(false)} />
                    <div style={{
                        position: 'absolute',
                        top: '100%', left: 0, right: 0,
                        marginTop: '4px',
                        background: '#1e222d',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        maxHeight: '240px',
                        overflowY: 'auto',
                        zIndex: 3001,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                    }}>
                        {options.map(opt => (
                            <div
                                key={opt.value}
                                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                                style={{
                                    padding: '12px 16px',
                                    color: String(opt.value) === String(value) ? '#fcd535' : '#ccc',
                                    background: String(opt.value) === String(value) ? 'rgba(252, 213, 53, 0.1)' : 'transparent',
                                    cursor: 'pointer',
                                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    fontSize: '14px'
                                }}
                            >
                                {opt.label}
                                {String(opt.value) === String(value) && <span>✓</span>}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

// Web Sound Fallback - Refined Synthesis (4-5s Duration)
const playWebSound = (id) => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const ctx = new AudioContext();
        const now = ctx.currentTime;

        // Master Gain
        const masterGain = ctx.createGain();
        masterGain.connect(ctx.destination);
        masterGain.gain.setValueAtTime(0.3, now);

        const createOsc = (type, freq, detune = 0) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            osc.detune.value = detune;
            osc.connect(gain);
            gain.connect(masterGain);
            return { osc, gain };
        };

        const applyEnvelope = (gainNode, attack, decay, sustainVol, holdTime, release) => {
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(1, now + attack);
            gainNode.gain.exponentialRampToValueAtTime(sustainVol, now + attack + decay);
            gainNode.gain.setValueAtTime(sustainVol, now + attack + decay + holdTime);
            gainNode.gain.linearRampToValueAtTime(0, now + attack + decay + holdTime + release);
        };

        // Standard 4-5s duration logic
        const TOTAL_DURATION = 4.5;

        switch (id) {
            case 1: { // Success (Dreamy Chime) - Long Tail
                const freqs = [523.25, 659.25, 783.99, 1046.50]; // C Major
                freqs.forEach((f, i) => {
                    const { osc, gain } = createOsc('triangle', f);
                    const start = now + i * 0.15; // Slow strum
                    osc.start(start);
                    osc.stop(now + TOTAL_DURATION);

                    // Long ringing tail
                    gain.gain.setValueAtTime(0, start);
                    gain.gain.linearRampToValueAtTime(0.2, start + 0.05);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + TOTAL_DURATION - 0.5);
                });
                break;
            }
            case 2: { // Danger (Siren) - 3 Cycles
                const { osc, gain } = createOsc('sawtooth', 400);
                const { osc: osc2, gain: gain2 } = createOsc('square', 405); // Detuned

                osc.start(now); osc2.start(now);
                osc.stop(now + TOTAL_DURATION); osc2.stop(now + TOTAL_DURATION);

                // Slow modulation (1.5s per cycle, 3 cycles = 4.5s)
                const cycle = 1.5;
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.linearRampToValueAtTime(1200, now + cycle / 2);
                osc.frequency.linearRampToValueAtTime(600, now + cycle);
                osc.frequency.linearRampToValueAtTime(1200, now + cycle * 1.5);
                osc.frequency.linearRampToValueAtTime(600, now + cycle * 2);
                osc.frequency.linearRampToValueAtTime(1200, now + cycle * 2.5);
                osc.frequency.linearRampToValueAtTime(600, now + cycle * 3);

                osc2.frequency.setValueAtTime(605, now);
                osc2.frequency.linearRampToValueAtTime(1205, now + cycle / 2);
                // ... same pattern for osc2 simplified
                osc2.frequency.linearRampToValueAtTime(605, now + cycle * 3);

                applyEnvelope(gain, 0.5, 0, 0.8, 3.5, 0.5);
                applyEnvelope(gain2, 0.5, 0, 0.5, 3.5, 0.5);
                break;
            }
            case 3: { // Coin (Triple Coin + Shimmy)
                // Play 3 times
                [0, 1, 2].forEach(i => {
                    const t = now + i * 0.8;
                    const { osc, gain } = createOsc('sine', 987); // B5
                    const { osc: osc2, gain: gain2 } = createOsc('square', 1318); // E6
                    osc.start(t); osc2.start(t + 0.05);
                    osc.stop(t + 0.6); osc2.stop(t + 0.6);

                    gain.gain.setValueAtTime(0, t);
                    gain.gain.linearRampToValueAtTime(0.2, t + 0.05);
                    gain.gain.linearRampToValueAtTime(0, t + 0.4);

                    gain2.gain.setValueAtTime(0, t + 0.05);
                    gain2.gain.linearRampToValueAtTime(0.1, t + 0.08);
                    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
                });
                break;
            }
            case 4: { // Laser (Rapid Fire)
                // 5 shots
                for (let i = 0; i < 5; i++) {
                    const t = now + i * 0.6;
                    const { osc, gain } = createOsc('sawtooth', 0);
                    osc.frequency.setValueAtTime(1500, t);
                    osc.frequency.exponentialRampToValueAtTime(100, t + 0.4);
                    osc.start(t); osc.stop(t + 0.5);

                    gain.gain.setValueAtTime(0.2, t);
                    gain.gain.linearRampToValueAtTime(0, t + 0.4);
                }
                break;
            }
            case 5: { // Rise (Slow Uplift)
                const { osc, gain } = createOsc('triangle', 220);
                osc.start(now); osc.stop(now + TOTAL_DURATION);
                // Rise over 4s
                osc.frequency.exponentialRampToValueAtTime(1760, now + 4.0);
                applyEnvelope(gain, 1.0, 0, 0.8, 2.5, 1.0);
                break;
            }
            case 6: { // Pop (Bubbles)
                // Many pops
                for (let i = 0; i < 8; i++) {
                    const t = now + i * 0.5 + Math.random() * 0.1;
                    const f = 600 + Math.random() * 200;
                    const { osc, gain } = createOsc('sine', f);
                    osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
                    osc.start(t); osc.stop(t + 0.2);
                    gain.gain.setValueAtTime(0.2, t);
                    gain.gain.linearRampToValueAtTime(0, t + 0.15);
                }
                break;
            }
            case 7: { // Tech (Computer Calculation)
                const { osc, gain } = createOsc('square', 880);
                osc.start(now); osc.stop(now + TOTAL_DURATION);

                // Randomish melody loop
                const step = 0.15;
                let steps = Math.floor(TOTAL_DURATION / step);
                for (let i = 0; i < steps; i++) {
                    const freq = 440 * Math.pow(2, Math.floor(Math.random() * 12) / 12);
                    osc.frequency.setValueAtTime(freq, now + i * step);
                }
                applyEnvelope(gain, 0.1, 0, 0.3, 3.5, 0.5);
                break;
            }
            case 8: { // Low Battery (Slow Pulse)
                const { osc, gain } = createOsc('sawtooth', 100);
                const { osc: osc2, gain: gain2 } = createOsc('sine', 100);
                osc.start(now); osc2.start(now);
                osc.stop(now + TOTAL_DURATION); osc2.stop(now + TOTAL_DURATION);

                // LFO effect manually
                for (let i = 0; i < 5; i++) {
                    gain.gain.setValueAtTime(0.3, now + i);
                    gain.gain.linearRampToValueAtTime(0.1, now + i + 0.5);
                    gain.gain.linearRampToValueAtTime(0.3, now + i + 1.0);
                }
                gain2.gain.setValueAtTime(0.2, now);
                gain2.gain.linearRampToValueAtTime(0, now + TOTAL_DURATION);
                break;
            }
            case 9: { // Confirm (Scan + Beep)
                const { osc, gain } = createOsc('sine', 440);
                osc.start(now); osc.stop(now + 4.0);

                // Scanner
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.linearRampToValueAtTime(880, now + 1.5);
                osc.frequency.setValueAtTime(880, now + 1.5); // Hold
                osc.frequency.setValueAtTime(1760, now + 2.0); // Confirm Ping

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.2, now + 0.5);
                gain.gain.linearRampToValueAtTime(0.2, now + 1.5);
                gain.gain.setValueAtTime(0, now + 1.55); // Silence gap
                gain.gain.setValueAtTime(0.3, now + 2.0); // Ping
                gain.gain.exponentialRampToValueAtTime(0.001, now + 4.0);
                break;
            }
            case 10: { // Attention (Annoying Beep x 4)
                const { osc, gain } = createOsc('square', 660);
                osc.start(now); osc.stop(now + TOTAL_DURATION);

                // Beep Beep Beep Beep
                for (let i = 0; i < 4; i++) {
                    gain.gain.setValueAtTime(0.2, now + i);
                    gain.gain.setValueAtTime(0.2, now + i + 0.5);
                    gain.gain.setValueAtTime(0, now + i + 0.51);
                }
                break;
            }
            default: break;
        }

    } catch (e) {
        console.error("Web audio failed", e);
    }
};


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
    const [soundRepeat, setSoundRepeat] = useState('once'); // 'once' | 'loop'
    const [soundDuration, setSoundDuration] = useState(10); // Seconds (Total loop time)
    const [loopPause, setLoopPause] = useState(1); // Seconds (Pause between loops)

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
        setSoundRepeat(alert.soundRepeat || 'once');
        setSoundDuration(alert.soundDuration || 10);
        setLoopPause(alert.loopPause || 1);
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
            soundRepeat,
            soundDuration: parseInt(soundDuration),
            loopPause: parseInt(loopPause),
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
                                            <CustomSelect
                                                value={indicatorType}
                                                onChange={setIndicatorType}
                                                options={[
                                                    { value: 'sma', label: 'SMA 移动均线' },
                                                    { value: 'ema', label: 'EMA 指数均线' },
                                                    { value: 'rsi', label: 'RSI 相对强弱' },
                                                    { value: 'fib', label: '斐波那契回撤' }
                                                ]}
                                            />
                                            {(indicatorType === 'sma' || indicatorType === 'ema') && (
                                                <CustomSelect
                                                    value={indicatorPeriod}
                                                    onChange={setIndicatorPeriod}
                                                    options={[
                                                        { value: 7, label: '7' },
                                                        { value: 25, label: '25' },
                                                        { value: 99, label: '99' }
                                                    ]}
                                                />
                                            )}
                                            {indicatorType === 'rsi' && (
                                                <CustomSelect
                                                    value={indicatorPeriod}
                                                    onChange={setIndicatorPeriod}
                                                    options={[
                                                        { value: 7, label: '7' },
                                                        { value: 14, label: '14' },
                                                        { value: 21, label: '21' }
                                                    ]}
                                                />
                                            )}
                                        </div>

                                        {indicatorType === 'rsi' && (
                                            <div className="sub-option" style={{ marginTop: '12px' }}>
                                                <label>RSI 阈值</label>
                                                <CustomSelect
                                                    value={targetValue}
                                                    onChange={setTargetValue}
                                                    options={[
                                                        { value: '70', label: '超买 70' },
                                                        { value: '80', label: '超买 80' },
                                                        { value: '30', label: '超卖 30' },
                                                        { value: '20', label: '超卖 20' }
                                                    ]}
                                                />
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
                                                        <CustomSelect
                                                            value={fibRatio}
                                                            onChange={val => setTargetValue(`${fibHigh}_${fibLow}_${val}`)}
                                                            options={[
                                                                { value: '0.236', label: '23.6%' },
                                                                { value: '0.382', label: '38.2%' },
                                                                { value: '0.5', label: '50%' },
                                                                { value: '0.618', label: '61.8%' },
                                                                { value: '0.786', label: '78.6%' }
                                                            ]}
                                                        />
                                                    </div>
                                                </>
                                            );
                                        })()}

                                        <div className="sub-option" style={{ marginTop: '12px' }}>
                                            <label>K线周期</label>
                                            <CustomSelect
                                                value={interval}
                                                onChange={setInterval}
                                                options={[
                                                    { value: '1m', label: '1分钟' },
                                                    { value: '5m', label: '5分钟' },
                                                    { value: '15m', label: '15分钟' },
                                                    { value: '1h', label: '1小时' },
                                                    { value: '4h', label: '4小时' },
                                                    { value: '1d', label: '1天' }
                                                ]}
                                            />
                                        </div>
                                    </>
                                ) : ( // targetType === 'drawing'
                                    <div className="indicator-row">
                                        {availableDrawings.length === 0 ? (
                                            <div style={{ color: '#888', padding: 10, textAlign: 'center', width: '100%' }}>
                                                暂无图形，请先在图表上绘制
                                            </div>
                                        ) : (
                                            <CustomSelect
                                                value={targetValue}
                                                onChange={setTargetValue}
                                                placeholder="-- 选择图形 --"
                                                options={[
                                                    { value: '', label: '-- 选择图形 --' },
                                                    ...availableDrawings.map(d => ({
                                                        value: d.id,
                                                        label: `${d.type.toUpperCase()} (${d.id.substring(0, 8)})`
                                                    }))
                                                ]}
                                            />
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
                                        <CustomSelect
                                            value={interval}
                                            onChange={setInterval}
                                            options={[
                                                { value: '1m', label: '1分钟' },
                                                { value: '5m', label: '5分钟' },
                                                { value: '15m', label: '15分钟' },
                                                { value: '1h', label: '1小时' },
                                                { value: '4h', label: '4小时' },
                                                { value: '1d', label: '1天' }
                                            ]}
                                        />
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

                                {/* Top Row: 3 Toggle Buttons */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                                    <button
                                        onClick={() => setActions({ ...actions, toast: !actions.toast })}
                                        className={`toggle-btn ${actions.toast ? 'active' : ''}`}
                                        style={{
                                            padding: '12px',
                                            background: actions.toast ? 'rgba(252, 213, 53, 0.15)' : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${actions.toast ? '#fcd535' : 'rgba(255,255,255,0.1)'}`,
                                            borderRadius: '12px',
                                            color: actions.toast ? '#fcd535' : '#888',
                                            cursor: 'pointer',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                            fontSize: '12px', fontWeight: '500'
                                        }}
                                    >
                                        <span style={{ fontSize: '20px' }}>💬</span>
                                        弹窗通知
                                    </button>

                                    <button
                                        onClick={() => setActions({ ...actions, vibration: actions.vibration === 'none' ? 'once' : 'none' })}
                                        className={`toggle-btn ${actions.vibration !== 'none' ? 'active' : ''}`}
                                        style={{
                                            padding: '12px',
                                            background: actions.vibration !== 'none' ? 'rgba(252, 213, 53, 0.15)' : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${actions.vibration !== 'none' ? '#fcd535' : 'rgba(255,255,255,0.1)'}`,
                                            borderRadius: '12px',
                                            color: actions.vibration !== 'none' ? '#fcd535' : '#888',
                                            cursor: 'pointer',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                            fontSize: '12px', fontWeight: '500'
                                        }}
                                    >
                                        <span style={{ fontSize: '20px' }}>📳</span>
                                        振动反馈
                                    </button>

                                    <button
                                        onClick={() => setSoundId(soundId === 0 ? 1 : 0)}
                                        className={`toggle-btn ${soundId !== 0 ? 'active' : ''}`}
                                        style={{
                                            padding: '12px',
                                            background: soundId !== 0 ? 'rgba(252, 213, 53, 0.15)' : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${soundId !== 0 ? '#fcd535' : 'rgba(255,255,255,0.1)'}`,
                                            borderRadius: '12px',
                                            color: soundId !== 0 ? '#fcd535' : '#888',
                                            cursor: 'pointer',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                            fontSize: '12px', fontWeight: '500'
                                        }}
                                    >
                                        <span style={{ fontSize: '20px' }}>🔊</span>
                                        声音提醒
                                    </button>
                                </div>

                                {/* Vibration Config Panel */}
                                {actions.vibration !== 'none' && (
                                    <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
                                        <label style={{ fontSize: '12px', color: '#888', marginBottom: '8px', display: 'block' }}>振动模式</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={() => setActions({ ...actions, vibration: 'once' })}
                                                style={{
                                                    flex: 1, padding: '8px', borderRadius: '8px', fontSize: '13px',
                                                    background: actions.vibration === 'once' ? '#fcd535' : 'rgba(255,255,255,0.1)',
                                                    color: actions.vibration === 'once' ? '#000' : '#888',
                                                    border: 'none', cursor: 'pointer'
                                                }}
                                            >短震动 (一次)</button>
                                            <button
                                                onClick={() => setActions({ ...actions, vibration: 'continuous' })}
                                                style={{
                                                    flex: 1, padding: '8px', borderRadius: '8px', fontSize: '13px',
                                                    background: actions.vibration === 'continuous' ? '#fcd535' : 'rgba(255,255,255,0.1)',
                                                    color: actions.vibration === 'continuous' ? '#000' : '#888',
                                                    border: 'none', cursor: 'pointer'
                                                }}
                                            >长震动 (持续)</button>
                                        </div>
                                    </div>
                                )}

                                {/* Sound Config Panel */}
                                {parseInt(soundId) > 0 && (
                                    <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
                                        <label style={{ fontSize: '12px', color: '#888', marginBottom: '8px', display: 'block' }}>音效选择</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <CustomSelect
                                                value={soundId}
                                                onChange={setSoundId}
                                                options={[
                                                    { value: 1, label: 'Success (Major)' },
                                                    { value: 2, label: 'Danger (Siren)' },
                                                    { value: 3, label: 'Coin (Mario)' },
                                                    { value: 4, label: 'Laser (Drop)' },
                                                    { value: 5, label: 'Rise (Uplift)' },
                                                    { value: 6, label: 'Notification (Pop)' },
                                                    { value: 7, label: 'Tech (High)' },
                                                    { value: 8, label: 'Low Battery' },
                                                    { value: 9, label: 'Confirm (Beep)' },
                                                    { value: 10, label: 'Attention' }
                                                ]}
                                                style={{ flex: 1 }}
                                            />
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation(); // Prevent modal interactions
                                                    if (Capacitor.getPlatform() === 'web') {
                                                        playWebSound(parseInt(soundId));
                                                    } else {
                                                        FloatingWidget.previewSound({ soundId: parseInt(soundId) }).catch(err => console.error(err));
                                                    }
                                                }}
                                                style={{
                                                    width: '45px',
                                                    height: '45px',
                                                    borderRadius: '12px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    border: '1px solid rgba(255,255,255,0.1)',
                                                    color: '#fcd535',
                                                    fontSize: '18px',
                                                    cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0
                                                }}
                                            >
                                                ▶
                                            </button>
                                        </div>

                                        <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ fontSize: '12px', color: '#888', marginBottom: '6px', display: 'block' }}>播放模式</label>
                                                <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '8px' }}>
                                                    <button
                                                        onClick={() => setSoundRepeat('once')}
                                                        style={{
                                                            flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px',
                                                            background: soundRepeat === 'once' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                            color: soundRepeat === 'once' ? '#fff' : '#666',
                                                            border: 'none', cursor: 'pointer'
                                                        }}
                                                    >单次</button>
                                                    <button
                                                        onClick={() => setSoundRepeat('loop')}
                                                        style={{
                                                            flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px',
                                                            background: soundRepeat === 'loop' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                            color: soundRepeat === 'loop' ? '#fff' : '#666',
                                                            border: 'none', cursor: 'pointer'
                                                        }}
                                                    >循环</button>
                                                </div>
                                            </div>

                                            {soundRepeat === 'loop' && (
                                                <div style={{ flex: 1.5 }}>
                                                    <label style={{ fontSize: '12px', color: '#888', marginBottom: '6px', display: 'block' }}>时长 {soundDuration}s</label>
                                                    <div className="slider-row" style={{ marginTop: 0 }}>
                                                        <input
                                                            type="range" min="5" max="60" step="5"
                                                            value={soundDuration} onChange={e => setSoundDuration(e.target.value)}
                                                            style={{ width: '100%', height: '4px' }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
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
