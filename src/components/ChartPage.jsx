import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { getSymbols } from '../utils/storage';
import { useBinanceTickers } from '../hooks/useBinanceTickers';
import '../App.css';

const DRAW_MODES = { NONE: 'none', TRENDLINE: 'trendline', CHANNEL: 'channel', RECT: 'rect', HLINE: 'hline', FIB: 'fib' };
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.382, 1.618, 2.618, 3.618];
const LABEL_PREFIX = { hline: 'h', trendline: 't', rect: 'r', channel: 'c', fib: 'f' };

// Helper to parse interval to seconds
const parseInterval = (int) => {
    if (!int) return 60;
    const unit = int.slice(-1);
    const val = parseInt(int);
    if (unit === 'm') return val * 60;
    if (unit === 'h') return val * 3600;
    if (unit === 'd') return val * 86400;
    if (unit === 'w') return val * 604800;
    if (unit === 'M') return val * 2592000;
    return 60;
};

export default function ChartPage() {
    const { symbol } = useParams();
    const navigate = useNavigate();
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const seriesRef = useRef(null);
    const labelsInitializedRef = useRef(false);

    const getPrefix = (type) => LABEL_PREFIX[type] || 'd';

    const collectUsedLabels = (draws) => {
        const used = new Set();
        draws.forEach(d => {
            if (d.id) used.add(d.id);
            if (d.label) used.add(d.label);
        });
        return used;
    };

    const allocLabel = (type, usedSet) => {
        const used = usedSet || collectUsedLabels(drawings);
        const prefix = getPrefix(type);
        let n = 1;
        while (used.has(`${prefix}${n}`)) n++;
        const label = `${prefix}${n}`;
        used.add(label);
        return { label, used };
    };

    const [interval, setIntervalState] = useState(() => {
        const saved = localStorage.getItem(`chart_interval_${symbol}`);
        // Fix for corrupted localStorage from previous bug
        if (saved && !saved.includes('object') && parseInterval(saved) !== 60) {
            return saved;
        }
        return '1h';
    });
    const [drawMode, setDrawModeState] = useState(DRAW_MODES.NONE);
    // Lazy init drawings to avoid empty state overwriting storage
    const [drawings, setDrawings] = useState(() => {
        const s = localStorage.getItem(`chart_drawings_${symbol}`);
        return s ? JSON.parse(s) : [];
    });

    // Initialize label counters from existing drawings (once)
    useEffect(() => {
        if (labelsInitializedRef.current) return;
        const used = collectUsedLabels(drawings);
        let changed = false;
        const updated = drawings.map(d => {
            if (!d) return d;

            // Normalize Fib visibility defaults (hide >1 by default)
            let next = d;
            if (d.type === 'fib') {
                const defaultVis = {
                    0: true, 0.236: true, 0.382: true, 0.5: true, 0.618: true, 0.786: true, 1: true,
                    1.382: false, 1.618: false, 2.618: false, 3.618: false
                };
                const mergedVis = { ...defaultVis, ...(d.fibVisible || {}) };
                // Only mark changed if any value differs
                const hasDiff = Object.keys(defaultVis).some(k => (d.fibVisible || {})[k] !== mergedVis[k]);
                if (hasDiff || !d.fibVisible) {
                    changed = true;
                    next = { ...next, fibVisible: mergedVis };
                }
            }

            if (next.label) {
                used.add(next.label);
                return next;
            }
            const prefix = getPrefix(next.type);
            const m = next.id?.match(new RegExp(`^${prefix}\\d+$`, 'i'));
            if (m) {
                used.add(m[0]);
                changed = true;
                return { ...next, label: m[0] };
            }
            const { label } = allocLabel(next.type, used);
            changed = true;
            return { ...next, label };
        });
        if (changed) setDrawings(updated);
        labelsInitializedRef.current = true;
    }, [drawings]);
    const [screenDrawings, setScreenDrawings] = useState([]);
    const [loadingStage, setLoadingStage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [isLandscape, setIsLandscape] = useState(false);
    const tapCandidateRef = useRef(null); // { id, x, y }
    // Orientation toggle removed per latest request (rely on system auto-rotate)

    // Config Menu State
    const [menu, setMenu] = useState(null); // { x, y, type, id, data }
    const [showSymbolMenu, setShowSymbolMenu] = useState(false);
    const [symbolPrices, setSymbolPrices] = useState({});
    const inDrawMode = drawMode !== DRAW_MODES.NONE;

    // Use dynamic tickers for symbol menu and other UI
    // Ensure we start with all symbols
    const [allSymbols] = useState(() => getSymbols());
    const liveTickers = useBinanceTickers(allSymbols);


    // Enhanced Indicator State
    const [showAddMenu, setShowAddMenu] = useState(false);
    const DEFAULT_INDICATORS = {
        ma1: { name: 'MA', period: 7, color: '#fcd535', width: 1, visible: true },
        ma2: { name: 'MA', period: 25, color: '#ff9f43', width: 1, visible: true },
        ma3: { name: 'MA', period: 99, color: '#a855f7', width: 1, visible: true },
        vol: { name: 'VOL', period: 20, color: '#26a69a', downColor: '#ef5350', visible: true },
    };
    const [indicators, setIndicators] = useState(() => {
        const saved = localStorage.getItem(`chart_indicators_v2_${symbol}`);
        return saved ? { ...DEFAULT_INDICATORS, ...JSON.parse(saved) } : DEFAULT_INDICATORS;
    });
    const indicatorsRef = useRef(indicators); // Sync ref for callbacks

    const [subIndicator, setSubIndicator] = useState(() => {
        const saved = localStorage.getItem(`chart_subIndicator_${symbol}`);
        return saved || 'NONE';
    }); // NONE, RSI, MACD, KDJ
    const [showSubMenu, setShowSubMenu] = useState(false);
    const subSeriesRefs = useRef({}); // To store sub-chart series objects

    // Save indicators when changed
    useEffect(() => {
        indicatorsRef.current = indicators; // Keep ref in sync
        localStorage.setItem(`chart_indicators_v2_${symbol}`, JSON.stringify(indicators));
        if (allDataRef.current.length > 0) updateIndicators(allDataRef.current);
    }, [indicators, symbol]);

    // Drawing state: pendingPoints = confirmed points, activePoint = point being positioned
    const [pendingPoints, setPendingPoints] = useState([]);
    const [activePoint, setActivePoint] = useState(null); // { time, price, x, y }
    const [cursor, setCursor] = useState(null);
    const [legendValues, setLegendValues] = useState({});
    const [customCrosshair, setCustomCrosshair] = useState(null); // { x, y } for long-press crosshair
    const screenDrawingsRef = useRef([]);

    const drawModeRef = useRef(DRAW_MODES.NONE);

    // Helpers (Hoisted for Drag Interaction)
    const estimatedStep = parseInterval(interval); // Simple memo not needed for primitive, but okay.

    const getLogic = useCallback((time) => {
        const data = allDataRef.current;
        if (data.length === 0) return null; // Return null instead of 0 to avoid zeroing
        // Binary search for closest time
        let l = 0, r = data.length - 1;
        while (l <= r) {
            const mid = (l + r) >> 1;
            const midTime = data[mid].time;
            if (midTime === time) return mid;
            if (midTime < time) l = mid + 1;
            else r = mid - 1;
        }
        // Interpolate
        if (l === 0) {
            const diff = data[0].time - time;
            const step = data[1] ? data[1].time - data[0].time : estimatedStep;
            return -diff / step;
        }
        if (l >= data.length) {
            const last = data[data.length - 1];
            const prev = data[data.length - 2] || { time: last.time - estimatedStep };
            const step = last.time - prev.time;
            return (data.length - 1) + (time - last.time) / step;
        }
        const idx = l - 1;
        const t1 = data[idx].time;
        const t2 = data[idx + 1].time;
        const ratio = (time - t1) / (t2 - t1);
        return idx + ratio;
    }, [estimatedStep]);

    const getTime = useCallback((logic) => {
        const data = allDataRef.current;
        if (!data || !data.length) return 0;
        const idx = Math.floor(logic);
        const ratio = logic - idx;
        if (idx < 0) return data[0].time + logic * (data[1] ? data[1].time - data[0].time : estimatedStep);
        if (idx >= data.length - 1) return data[data.length - 1].time + (logic - (data.length - 1)) * (data[data.length - 1].time - (data[data.length - 2]?.time || data[data.length - 1].time - estimatedStep));
        return data[idx].time + (data[idx + 1].time - data[idx].time) * ratio;
    }, [estimatedStep]);

    // Track which interval the loaded data corresponds to (for drawing projection)
    const dataIntervalRef = useRef(interval);

    // Drag Logic
    const [dragState, setDragState] = useState(null); // { id, index }
    const [activeHandle, setActiveHandle] = useState(null); // { id, index } - For Indirect Drag
    const [subMenuPos, setSubMenuPos] = useState(null); // { x, y, isBottom }
    const activeTouchIdsRef = useRef(new Set());
    const suppressDrawingInteractionRef = useRef(false);

    // Unified Chart Interaction Sync (Lock pan/zoom during drag or custom crosshair)
    useEffect(() => {
        if (!chartRef.current) return;
        const isLocked = !!customCrosshair || !!dragState;
        chartRef.current.applyOptions({
            handleScroll: !isLocked,
            handleScale: !isLocked,
            kineticScroll: { touch: !isLocked, mouse: !isLocked }
        });
    }, [customCrosshair, dragState]);

    // Track multitouch to avoid accidental selection when pinching/panning
    useEffect(() => {
        const onPD = (ev) => {
            if (ev.pointerType !== 'touch') return;
            activeTouchIdsRef.current.add(ev.pointerId);
            if (activeTouchIdsRef.current.size >= 2) suppressDrawingInteractionRef.current = true;
        };
        const onPU = (ev) => {
            if (ev.pointerType !== 'touch') return;
            activeTouchIdsRef.current.delete(ev.pointerId);
            if (activeTouchIdsRef.current.size < 2) suppressDrawingInteractionRef.current = false;
        };
        window.addEventListener('pointerdown', onPD, { passive: true });
        window.addEventListener('pointerup', onPU, { passive: true });
        window.addEventListener('pointercancel', onPU, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', onPD);
            window.removeEventListener('pointerup', onPU);
            window.removeEventListener('pointercancel', onPU);
        };
    }, []);

    const handleDragStart = (e, id, index = 0) => {
        e.stopPropagation();
        e.preventDefault();

        if (suppressDrawingInteractionRef.current) return; // ignore when pinching with two fingers

        // 未选中时先选中，不直接进入拖拽（避免从图形起点直接触发拖拽，需先选中再拖）
        if (selectedId !== id) {
            setSelectedId(id);
            return;
        }

        if (!chartRef.current || !seriesRef.current || !containerRef.current) return;

        const isWhole = index === -1;
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const mouseLogic = chartRef.current.timeScale().coordinateToLogical(mouseX);
        const mousePrice = seriesRef.current.coordinateToPrice(mouseY);

        // If we are starting a drag from background (Indirect Drag)
        // logicOffset should be calculated based on the CURRENT POINT POSITION vs MOUSE
        // This is handled below.

        const drawing = drawings.find(d => d.id === id);
        if (!drawing) return;

        logInteract('drag start', { id, index, isWhole, mouseLogic, mousePrice });

        if (isWhole) {
            const pts = drawing.points || [];
            const pointLogics = pts.map(p => getLogic(p.time));
            const startLogic = mouseLogic !== null ? mouseLogic : (pointLogics[0] ?? 0);
            const startPrice = mousePrice ?? (drawing.type === 'hline' ? drawing.price : pts[0]?.price ?? 0);

            chartRef.current.applyOptions({ handleScale: false, handleScroll: false });

            setDragState({
                id,
                index: -1,
                isWhole: true,
                startLogic,
                startPrice,
                pointLogics,
                origPoints: pts.map(p => ({ ...p })), // shallow clone
                hlinePrice: drawing.price
            });
        } else {
            let anchorPoint = null;
            if (drawing.type === 'hline') {
                const anchorTime = mouseLogic !== null ? getTime(mouseLogic) : (allDataRef.current?.[0]?.time || 0);
                anchorPoint = { time: anchorTime, price: drawing.price };
            } else if (drawing.points && drawing.points.length) {
                anchorPoint = drawing.points[index];
            }

            if (!anchorPoint) return;

            const pointLogic = anchorPoint.time !== undefined ? getLogic(anchorPoint.time) : null;

            const logicOffset = (pointLogic !== null && mouseLogic !== null) ? pointLogic - mouseLogic : 0;
            const priceOffset = anchorPoint.price - (mousePrice ?? anchorPoint.price);

            chartRef.current.applyOptions({ handleScale: false, handleScroll: false });

            setDragState({
                id,
                index,
                logicOffset,
                priceOffset,
                anchorTime: anchorPoint.time ?? null,
                anchorPrice: anchorPoint.price ?? null,
                isWhole: false
            });
        }

        // Sync Active Handle and Selection
        setActiveHandle({ id, index: isWhole ? -1 : index });
        setSelectedId(id);
    };

    const rafRef = useRef(null);
    const passthroughRef = useRef(null);

    const logInteract = (...args) => console.log('[interact]', ...args);

    const forwardPointerToChart = (type, srcEvent) => {
        const canvas = containerRef.current?.querySelector('canvas');
        if (!canvas) return;
        const evt = new PointerEvent(type, {
            bubbles: false,
            cancelable: false,
            pointerId: srcEvent.pointerId,
            pointerType: srcEvent.pointerType,
            clientX: srcEvent.clientX,
            clientY: srcEvent.clientY,
            screenX: srcEvent.screenX,
            screenY: srcEvent.screenY,
            buttons: srcEvent.buttons,
            ctrlKey: srcEvent.ctrlKey,
            shiftKey: srcEvent.shiftKey,
            altKey: srcEvent.altKey,
            metaKey: srcEvent.metaKey
        });
        canvas.dispatchEvent(evt);
    };

    const startPassthrough = (e) => {
        // Allow chart pan/zoom/crosshair even if a drawing is under the pointer (when not selected)
        const target = e.currentTarget;
        logInteract('passthrough start', { x: e.clientX, y: e.clientY });
        forwardPointerToChart('pointerdown', e);

        const move = (ev) => forwardPointerToChart('pointermove', ev);
        const up = (ev) => {
            forwardPointerToChart('pointerup', ev);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            passthroughRef.current = null;
        };

        passthroughRef.current = { target, move, up };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    useEffect(() => {
        const move = (e) => {
            if (!dragState || !containerRef.current) return;

            // Extract coordinates synchronously
            const clientX = e.clientX;
            const clientY = e.clientY;

            // Throttle: Only schedule if no frame is pending
            if (rafRef.current) return;

            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null; // Reset lock

                if (!containerRef.current || !chartRef.current || !seriesRef.current) return;
                const rect = containerRef.current.getBoundingClientRect();
                const x = clientX - rect.left;
                const y = clientY - rect.top;

                const rawLogic = chartRef.current.timeScale().coordinateToLogical(x);
                const rawPrice = seriesRef.current.coordinateToPrice(y);

                const targetLogic = rawLogic !== null ? rawLogic + (dragState.logicOffset || 0) : null;
                const targetPrice = rawPrice !== null ? rawPrice + (dragState.priceOffset || 0) : null;

                const time = targetLogic !== null ? getTime(targetLogic) : null;

                setDrawings(prev => prev.map(d => {
                    if (d.id !== dragState.id) return d;

                    if (dragState.isWhole) {
                        const baseLogicShift = (rawLogic ?? dragState.startLogic ?? 0) - (dragState.startLogic ?? 0);
                        const basePriceShift = (rawPrice ?? dragState.startPrice ?? 0) - (dragState.startPrice ?? 0);

                        if (d.type === 'hline') {
                            const basePrice = dragState.hlinePrice ?? d.price ?? 0;
                            return { ...d, price: basePrice + basePriceShift };
                        }

                        const origPoints = dragState.origPoints || d.points || [];
                        const pointLogics = dragState.pointLogics || [];

                        const newPoints = origPoints.map((p, i) => {
                            const pl = pointLogics[i] ?? getLogic(p.time) ?? 0;
                            const newLogic = pl + baseLogicShift;
                            const newTime = getTime(newLogic) ?? p.time;
                            return { ...p, time: newTime, price: p.price + basePriceShift };
                        });
                        logInteract('drag move whole', { id: d.id, baseLogicShift, basePriceShift, pts: newPoints.length });
                        return { ...d, points: newPoints };
                    }

                    // For HLine, only price matters
                    if (d.type === 'hline' && targetPrice !== null) return { ...d, price: targetPrice };
                    if (targetLogic === null || targetPrice === null) return d;

                    const newPoints = [...d.points];
                    if (newPoints[dragState.index]) {
                        // Update specific point
                        newPoints[dragState.index] = { ...newPoints[dragState.index], time, price: targetPrice };
                    }
                    logInteract('drag move anchor', { id: d.id, idx: dragState.index, time, price: targetPrice });
                    return { ...d, points: newPoints };
                }));
            });
        };
        const up = () => {
            // Restore chart pan/zoom
            if (chartRef.current) {
                chartRef.current.applyOptions({ handleScale: true, handleScroll: true });
            }
            logInteract('drag end', dragState?.id);
            setDragState(null);
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };

        if (dragState) {
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        }
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [dragState, getTime]);
    const pendingPointsRef = useRef([]);
    const lastCursorRef = useRef(null);
    const allDataRef = useRef([]);
    const isFetchingHistoryRef = useRef(false);
    const activePointRef = useRef(null);

    // Indicators Refs (Dynamic access or fixed slots? Fixed slots for now to keep it simple)
    const maSeriesRefs = useRef({}); // { ma1: series, ma2: series ... }

    const setInterval = (v) => { setIntervalState(v); localStorage.setItem(`chart_interval_${symbol}`, v); };

    // Start drawing mode - immediately create first point at cursor or center
    const startDrawMode = (mode) => {
        if (drawModeRef.current === mode) {
            // Toggle off
            setDrawModeState(DRAW_MODES.NONE);
            drawModeRef.current = DRAW_MODES.NONE;
            setPendingPoints([]);
            pendingPointsRef.current = [];
            setActivePoint(null);
            return;
        }

        setDrawModeState(mode);
        drawModeRef.current = mode;
        setPendingPoints([]);
        pendingPointsRef.current = [];

        // Create initial active point at last cursor position or center
        if (chartRef.current && seriesRef.current && containerRef.current) {
            let x, y, logic, price;
            if (lastCursorRef.current) {
                x = lastCursorRef.current.x;
                y = lastCursorRef.current.y;
                price = lastCursorRef.current.price;
                // Convert x to logic
                logic = chartRef.current.timeScale().coordinateToLogical(x);
                // IF logic is null, try to infer? No, it should be valid if onscreen.
                if (logic === null) logic = 0; // Fallback
                const p = { logic, price, x, y };
                setActivePoint(p);
                activePointRef.current = p;
            } else {
                // Always start at center for TradingView-style "Virtual Cursor"
                const x = containerRef.current.clientWidth / 2;
                const y = containerRef.current.clientHeight / 2;
                const logic = chartRef.current.timeScale().coordinateToLogical(x);
                const price = seriesRef.current.coordinateToPrice(y);
                const p = { logic, price, x, y };
                setActivePoint(p);
                activePointRef.current = p;
            }
        }
    };

    // Data <-> Screen
    const lastLogicalRangeRef = useRef(null);

    const logicToScreen = useCallback((logic, price) => {
        if (!chartRef.current || !seriesRef.current || logic === null || isNaN(logic)) return null;

        const timeScale = chartRef.current.timeScale();
        const range = timeScale.getVisibleLogicalRange() || lastLogicalRangeRef.current;
        let x = timeScale.logicalToCoordinate(logic);

        // Robust extrapolation and clamping fix
        if (range) {
            const { from, to } = range;
            const width = timeScale.width() || containerRef.current?.clientWidth || 0;
            const rangeSize = to - from;
            if (rangeSize > 0 && width > 0) {
                const pxPerLogic = width / rangeSize;
                const linearX = (logic - from) * pxPerLogic;
                const outOfView = logic < from || logic > to;
                const badX = x === null || !isFinite(x) || x <= 0 || x >= width;
                if (outOfView || badX) {
                    x = linearX;
                }
            }
        }

        const y = seriesRef.current.priceToCoordinate(price);
        return (x !== null && y !== null) ? { x, y } : null;
    }, []);

    // NOTE: keep time->logic conversion near the data helpers to avoid interval drift

    // Recalculate indicators on state change
    useEffect(() => {
        if (allDataRef.current.length > 0) updateIndicators(allDataRef.current);
    }, [indicators]);

    const updateScreenDrawings = useCallback(() => {
        if (!allDataRef.current.length) return;
        // Prevent mixing old data interval with new interval
        if (dataIntervalRef.current !== interval) return;
        const prevMap = Object.fromEntries((screenDrawingsRef.current || []).map(d => [d.id, d]));
        const data = allDataRef.current;
        const estimatedStep = parseInterval(interval);

        const getLogic = (time) => {
            // Debug Log
            // console.log(`[getLogic] Time: ${time}, Interval: ${interval}, EstStep: ${estimatedStep}`);

            if (data.length === 0) return null; // Return null instead of 0 to avoid zeroing
            // Binary search for closest time
            let l = 0, r = data.length - 1;
            while (l <= r) {
                const mid = (l + r) >> 1;
                const midTime = data[mid].time;
                if (midTime === time) return mid;
                if (midTime < time) l = mid + 1;
                else r = mid - 1;
            }

            // Not found exact, interpolate
            if (l === 0) {
                const diff = data[0].time - time;
                const step = data[1] ? data[1].time - data[0].time : estimatedStep; // Use interval-aware step
                const res = -diff / step;
                console.log(`[getLogic] PRE-DATA: Time=${time} First=${data[0].time} Diff=${diff} Step=${step} Res=${res}`);
                return res;
            }
            if (l >= data.length) {
                const last = data[data.length - 1];
                const prev = data[data.length - 2] || { time: last.time - estimatedStep };
                const step = last.time - prev.time;
                const res = (data.length - 1) + (time - last.time) / step;
                console.log(`[getLogic] PAST-DATA: Time=${time} Last=${last.time} Step=${step} Res=${res}`);
                return res;
            }

            // Interpolate between idx and idx+1
            const idx = l - 1;
            const t1 = data[idx].time;
            const t2 = data[idx + 1].time;
            const ratio = (time - t1) / (t2 - t1);
            if (ratio < 0 || ratio > 1) console.warn(`[getLogic] INTERP ODD: Ratio=${ratio} T1=${t1} T2=${t2} Time=${time}`);
            return idx + ratio;
        };

        // Filter hidden drawings
        const result = drawings.filter(d => d.visible !== false).map(d => {
            const prevEntry = prevMap[d.id];
            if (d.type === 'hline') {
                const p = (d.points && d.points[0]) ? d.points[0].price : d.price;
                if (p === undefined) return null;
                const y = seriesRef.current?.priceToCoordinate(p);
                if (y !== null) return { ...d, screenY: y };
                return prevEntry || null;
            }

            if (d.points && d.points.some(ppp => !ppp.time)) return null;

            if (d.points) {
                const sp = d.points.map(p => timeToScreen(p.time, p.price)).filter(Boolean);

                // DEBUG: Check for off-screen points to left
                // DEBUG: Check for off-screen points to left
                if (chartRef.current && window.userDebugMode !== false && debugLogTriggerRef.current) {
                    debugLogTriggerRef.current = false; // Reset trigger

                    console.groupCollapsed(`[Drawings Debug] ${new Date().toLocaleTimeString()} ID=${d.id}`);
                    d.points.forEach((p, i) => {
                        const l = getLogic(p.time);
                        const proj = timeToScreen(p.time, p.price);
                        const x = proj ? proj.x : 'NULL';
                        const y = proj ? proj.y : 'NULL';
                        const pDate = new Date(p.time * 1000).toLocaleString();

                        console.log(`Point ${i}:`, {
                            time: p.time,
                            readableTime: pDate,
                            price: p.price,
                            logicIndex: l !== null ? l.toFixed(2) : 'null',
                            screenX: typeof x === 'number' ? x.toFixed(2) : x,
                            screenY: typeof y === 'number' ? y.toFixed(2) : y
                        });
                    });
                    console.groupEnd();
                }

                // Debug Geometry Enchanced
                if (d.type === 'channel' || d.id === selectedId) {
                    console.log(`[ScreenPoints] ID=${d.id} Interval=${interval} Type=${d.type}`);
                    d.points.forEach((p, i) => {
                        const l = getLogic(p.time);
                        const s = sp[i];
                        console.log(`  P${i}: Time=${p.time} Price=${p.price} Logic=${l.toFixed(2)} ScreenX=${s?.x.toFixed(1)} ScreenY=${s?.y.toFixed(1)}`);
                    });
                }
                if (sp.length === d.points.length) return { ...d, screenPoints: sp };
                const prev = prevMap[d.id];
                if (prev && prev.screenPoints && prev.screenPoints.length === d.points.length) {
                    return { ...d, screenPoints: prev.screenPoints };
                }
                // Keep previous entry if available to avoid flicker/disappear
                if (prevEntry) return prevEntry;
                return null;
            }
            return null;
        }).filter(Boolean);
        setScreenDrawings(result);
        screenDrawingsRef.current = result;
    }, [drawings, logicToScreen, interval]); // Added interval dependency

    useEffect(() => {
        if (!chartRef.current || !seriesRef.current) return;

        let frameId;
        let prevTimeState = null;
        let prevPriceState = null;

        const checkSync = () => {
            const chart = chartRef.current;
            const series = seriesRef.current;
            if (!chart || !series) return;

            // Check Time Scale
            const timeRange = chart.timeScale().getVisibleLogicalRange();
            const timeState = timeRange ? `${timeRange.from.toFixed(2)},${timeRange.to.toFixed(2)}` : null;

            // Check Price Scale (by mapping fixed price points)
            // We use two distinct prices to detect translation and scaling
            const y1 = series.priceToCoordinate(seriesRef.current.coordinateToPrice(0) || 0);
            // Using dynamic reference might be better: get visible range
            // But coordinateToPrice(0) gives price at top? No.
            // Better: just use top and bottom pixel coordinates and check their prices? 
            // Actually, we want to know if the mapping changed.
            // Let's use the chart height to get two prices and check their coords? 
            // The simplest robust way: priceToCoordinate of the current top/bottom prices of the view?
            // No, getting mapped coords of fixed values is best.
            // Let's us 0 and 1000? No, crypto prices vary. 
            // Let's use the first visible candle's open/close?
            // Actually, we can just map 0 and 1000000. If scale changes, their Y changes.
            const tY1 = series.priceToCoordinate(100);
            const tY2 = series.priceToCoordinate(100000);
            const priceState = `${tY1},${tY2}`;

            if (timeState !== prevTimeState || priceState !== prevPriceState) {
                prevTimeState = timeState;
                prevPriceState = priceState;
                updateScreenDrawings();

                // Sync Sticky Crosshair Position during chart pan/zoom
                if (customCrosshairRef.current) {
                    const ch = customCrosshairRef.current;
                    const newX = chart.timeScale().logicalToCoordinate(ch.logic);
                    const newY = series.priceToCoordinate(ch.price);

                    if (newX !== null && newY !== null) {
                        // Only update if moved significantly (prevent jitter loops)
                        if (Math.abs(newX - ch.x) > 0.5 || Math.abs(newY - ch.y) > 0.5) {
                            setCustomCrosshair(prev => ({ ...prev, x: newX, y: newY }));
                        }
                    } else {
                        // Off screen? could hide it or remove it. Let's remove it if totally off?
                        // Or just keep it. It might come back.
                        // Setting x,y to null might break render. 
                        // Let's just update even if it's off-canvas coordinates.
                        // Actually coordinate functions might return null.
                        if (newX !== null) setCustomCrosshair(prev => ({ ...prev, x: newX })); // Partial update? No, usually distinct.
                        // If null, it means off screen probably.
                    }
                }
            }

            frameId = requestAnimationFrame(checkSync);
        };

        checkSync();

        return () => cancelAnimationFrame(frameId);
    }, [drawings, updateScreenDrawings]);

    // Chart init
    useEffect(() => {
        if (!containerRef.current) return;
        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth, height: containerRef.current.clientHeight,
            layout: { background: { color: '#0d1117' }, textColor: '#d1d5db' },
            grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
            crosshair: { mode: 1 },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
            timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true },
        });

        // Removed premature config
        const series = chart.addSeries(CandlestickSeries, {
            upColor: '#00d68f', downColor: '#ff4757', borderDownColor: '#ff4757',
            borderUpColor: '#00d68f', wickDownColor: '#ff4757', wickUpColor: '#00d68f'
        });

        // Add Indicator Series
        Object.entries(indicators).forEach(([key, cfg]) => {
            let s;
            if (key === 'vol') {
                s = chart.addSeries(HistogramSeries, {
                    color: cfg.color,
                    priceFormat: { type: 'volume' },
                    priceScaleId: 'vol',
                    visible: cfg.visible,
                });
                chart.priceScale('vol').applyOptions({
                    scaleMargins: { top: 0.8, bottom: 0 },
                    borderVisible: false,
                });
            } else {
                s = chart.addSeries(LineSeries, {
                    color: cfg.color,
                    lineWidth: cfg.width,
                    visible: cfg.visible,
                    crosshairMarkerVisible: false,
                    priceLineVisible: false,
                    lastValueVisible: false
                });
            }
            maSeriesRefs.current[key] = s;
        });

        // Initialize Sub-Indicator Series if any (should be NONE initially but good for hot reload)
        // Actually, we'll handle sub-indicator changes in a separate useEffect or inside updateIndicators
        // But we need to handle the initial render or state change. 
        // Let's rely on a separate useEffect for subIndicator management to keep this init clean.

        chartRef.current = chart;
        seriesRef.current = series;

        // Crosshair move - update active point position & legend
        chart.subscribeCrosshairMove((p) => {
            if (!p.point) { setCursor(null); setLegendValues({}); return; }
            const price = series.coordinateToPrice(p.point.y);
            // Default volume to empty if not found, but we can't get it from coordinateToPrice easily
            // We rely on seriesData

            const c = { x: p.point.x, y: p.point.y, price, time: p.time };
            setCursor(c);
            lastCursorRef.current = c;

            // Update Legend Values
            if (p.seriesData) {
                const v = {};
                Object.entries(maSeriesRefs.current).forEach(([key, s]) => {
                    const val = p.seriesData.get(s);
                    if (val && val.value) v[key] = val.value;
                });
                setLegendValues(v);
            }

            // If in draw mode, we handle activePoint manually via virtual cursor layer
            // So we DO NOT update it here to avoid conflicts
            if (drawModeRef.current !== DRAW_MODES.NONE) {
                // no-op
            }
        });

        // Click on background to deselect
        chart.subscribeClick((param) => {
            if (param.point === undefined || !param.hoveredSeries) {
                // Clicked on empty space
                setSelectedId(null);
                setMenu(null);
            }
        });

        const resize = () => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
                updateScreenDrawings();
            }
        };
        window.addEventListener('resize', resize);
        return () => { window.removeEventListener('resize', resize); chart.remove(); };
    }, []);

    // Disable native crosshair completely - we'll implement our own
    useEffect(() => {
        if (!chartRef.current) return;
        const isDrawing = drawMode !== DRAW_MODES.NONE;
        chartRef.current.applyOptions({
            crosshair: {
                mode: 0, // Normal mode for drag-to-pan
                vertLine: { visible: false, labelVisible: false },
                horzLine: { visible: false, labelVisible: false },
            }
        });
    }, [drawMode]);

    // Indicators Logic
    const calSMA = (data, count) => {
        const avg = (d) => d.reduce((a, b) => a + b, 0) / d.length;
        let result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < count - 1) continue;
            const slice = data.slice(i - count + 1, i + 1).map(d => d.close);
            result.push({ time: data[i].time, value: avg(slice) });
        }
        return result;
    };

    const calRSI = (data, period = 14) => {
        let result = [];
        let gains = 0, losses = 0;
        for (let i = 0; i < data.length; i++) {
            if (i < 1) continue;
            const change = data[i].close - data[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;

            if (i === period) {
                // Initial average
                let sumGain = 0, sumLoss = 0;
                for (let j = 1; j <= period; j++) {
                    const chg = data[j].close - data[j - 1].close;
                    sumGain += chg > 0 ? chg : 0;
                    sumLoss += chg < 0 ? -chg : 0;
                }
                gains = sumGain / period;
                losses = sumLoss / period;
                const rs = gains / losses;
                result.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
            } else if (i > period) {
                gains = (gains * (period - 1) + gain) / period;
                losses = (losses * (period - 1) + loss) / period;
                const rs = gains / losses;
                result.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
            } else {

            }
        }
        return result;
    };

    const calMACD = (data, fast = 12, slow = 26, signal = 9) => {
        // EMA helper
        const ema = (src, p) => {
            const k = 2 / (p + 1);
            let res = [];
            let prev = src[0] ? src[0].value || src[0].close : 0; // handle simple or object array
            src.forEach(d => {
                const val = d.value !== undefined ? d.value : d.close;
                const next = val * k + prev * (1 - k);
                res.push({ time: d.time, value: next });
                prev = next;
            });
            return res;
        }

        // We need complete data for EMA. Simple EMA implementation
        // Real MACD usually starts with SMA, but pure EMA is fine for approx
        const closeSeries = data.map(d => ({ time: d.time, value: d.close }));
        if (closeSeries.length === 0) return { diff: [], dea: [], hist: [] };

        // Initial SMA for EMA seed is better but let's stick to simple recursive EMA for stability
        // Actually, let's do a quick loop calc
        let emaFast = [], emaSlow = [], diff = [], dea = [], hist = [];

        let kF = 2 / (fast + 1);
        let kS = 2 / (slow + 1);
        let kSig = 2 / (signal + 1);

        let lastFast = data[0].close, lastSlow = data[0].close, lastDea = 0;

        data.forEach((d, i) => {
            lastFast = d.close * kF + lastFast * (1 - kF);
            lastSlow = d.close * kS + lastSlow * (1 - kS);
            const df = lastFast - lastSlow;

            // Signal (DEA) is EMA of Diff
            if (i === 0) lastDea = df;
            else lastDea = df * kSig + lastDea * (1 - kSig);

            const h = df - lastDea;

            diff.push({ time: d.time, value: df });
            dea.push({ time: d.time, value: lastDea });
            hist.push({ time: d.time, value: h, color: h >= 0 ? '#26a69a' : '#ef5350' });
        });

        return { diff, dea, hist };
    };

    const calKDJ = (data, p = 9, m1 = 3, m2 = 3) => {
        let k = 50, d = 50, j = 50;
        let resK = [], resD = [], resJ = [];

        data.forEach((item, i) => {
            if (i < p - 1) return;

            // Find RSV
            let low = item.low, high = item.high;
            for (let x = 0; x < p; x++) {
                if (data[i - x].low < low) low = data[i - x].low;
                if (data[i - x].high > high) high = data[i - x].high;
            }

            const rsv = (high === low) ? 50 : (item.close - low) / (high - low) * 100;

            k = (1 * rsv + (m1 - 1) * k) / m1;
            d = (1 * k + (m2 - 1) * d) / m2;
            j = 3 * k - 2 * d;

            resK.push({ time: item.time, value: k });
            resD.push({ time: item.time, value: d });
            resJ.push({ time: item.time, value: j });
        });

        return { k: resK, d: resD, j: resJ };
    };


    // Calc Indicators
    const updateIndicators = (data) => {
        // const calSMA = (d, p) => { // This was the old calSMA, now replaced by the new one above
        //     const res = [];
        //     for (let i = 0; i < d.length; i++) {
        //         if (i < p - 1) { res.push({ time: d[i].time, value: NaN }); continue; }
        //         let sum = 0;
        //         for (let j = 0; j < p; j++) sum += d[i - j].close;
        //         res.push({ time: d[i].time, value: sum / p });
        //     }
        //     return res.filter(x => !isNaN(x.value));
        // };

        Object.entries(indicatorsRef.current).forEach(([key, cfg]) => {
            if (maSeriesRefs.current[key]) {
                const s = maSeriesRefs.current[key];
                if (key === 'vol') {
                    s.applyOptions({ visible: cfg.visible });
                    const volData = data.map(d => ({
                        time: d.time,
                        value: d.volume,
                        color: d.close >= d.open ? '#26a69a' : '#ef5350'
                    }));
                    s.setData(volData);
                } else {
                    s.applyOptions({ color: cfg.color, lineWidth: cfg.width, visible: cfg.visible });
                    s.setData(calSMA(data, cfg.period));
                }
            }
        });

        // Update Sub Indicator
        if (chartRef.current && subIndicator !== 'NONE') {
            const chart = chartRef.current;
            // Ensure series exist / match type
            // Heavily simplified: Re-create if needed or just update data
            // To prevent flickering, we only recreate if checking existing refs fails

            // For simplicity in this step, let's just update data if refs exist, or create if not.
            // Better approach: separate useEffect manages Series Creation/Removal, this only pushes data.
            // But we need data to push.

            if (subIndicator === 'RSI' && subSeriesRefs.current.rsi) {
                subSeriesRefs.current.rsi.setData(calRSI(data));
            } else if (subIndicator === 'MACD' && subSeriesRefs.current.hist) {
                const m = calMACD(data);
                subSeriesRefs.current.diff.setData(m.diff);
                subSeriesRefs.current.dea.setData(m.dea);
                subSeriesRefs.current.hist.setData(m.hist);
            } else if (subIndicator === 'KDJ' && subSeriesRefs.current.k) {
                const k = calKDJ(data);
                subSeriesRefs.current.k.setData(k.k);
                subSeriesRefs.current.d.setData(k.d);
                subSeriesRefs.current.j.setData(k.j);
            }
        }
    };

    // Sub-Indicator Series Management
    useEffect(() => {
        if (!chartRef.current) return;
        const chart = chartRef.current;

        // Cleanup old
        Object.values(subSeriesRefs.current).filter(s => s).forEach(s => {
            try {
                chart.removeSeries(s);
            } catch (e) {
                console.warn('Failed to remove series:', e);
            }
        });
        subSeriesRefs.current = {};

        if (subIndicator === 'RSI') {
            // Main Chart occupies top 55%
            chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } });
            // Vol occupies 55%-70% (middle band)
            chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.55, bottom: 0.30 } });

            const s = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 2, priceScaleId: 'sub' });
            subSeriesRefs.current = { rsi: s };
            // Sub Chart occupies bottom 25%
            chart.priceScale('sub').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, position: 'left' });

        } else if (subIndicator === 'MACD') {
            chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } });
            chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.55, bottom: 0.30 } });

            const h = chart.addSeries(HistogramSeries, { priceScaleId: 'sub' });
            const diff = chart.addSeries(LineSeries, { color: '#fcd535', lineWidth: 1, priceScaleId: 'sub' });
            const dea = chart.addSeries(LineSeries, { color: '#ff9f43', lineWidth: 1, priceScaleId: 'sub' });
            subSeriesRefs.current = { hist: h, diff, dea };
            chart.priceScale('sub').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, position: 'left' });

        } else if (subIndicator === 'KDJ') {
            chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } });
            chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.55, bottom: 0.30 } });

            const k = chart.addSeries(LineSeries, { color: '#ffffff', lineWidth: 1, priceScaleId: 'sub' });
            const d = chart.addSeries(LineSeries, { color: '#fcd535', lineWidth: 1, priceScaleId: 'sub' });
            const j = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, priceScaleId: 'sub' });
            subSeriesRefs.current = { k, d, j };
            chart.priceScale('sub').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, position: 'left' });

        } else {
            // Reset Main Chart and Vol to default layout (No Sub-Chart)
            chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.20 } });
            chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } });
        }

        // Trigger data update
        if (allDataRef.current && subIndicator !== 'NONE') {
            updateIndicators(allDataRef.current);
        }

    }, [subIndicator]);

    // Persist subIndicator
    useEffect(() => {
        localStorage.setItem(`chart_subIndicator_${symbol}`, subIndicator);
    }, [subIndicator, symbol]);

    // Resume Data Gap Fill logic removed as per user request (handled by backend/other commit)


    // Load data & Infinite Scroll
    useEffect(() => {
        if (!seriesRef.current || !chartRef.current) return;
        let stageTimer;

        // Save interval preference
        localStorage.setItem(`chart_interval_${symbol}`, interval);

        // Clear data ref immediately to avoid interval mismatch corruption (e.g. 1h data + 1d websocket update)
        allDataRef.current = [];
        setScreenDrawings([]); // Clear visuals immediately
        setIsLoading(true);
        setLoadingStage('连接中...');

        const isPerpetual = symbol.endsWith('.P');
        const baseSymbol = isPerpetual ? symbol.slice(0, -2) : symbol;
        const apiBase = isPerpetual ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
        const wsBase = isPerpetual ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws';

        // Initial Load
        const load = async () => {
            try {
                const res = await fetch(`${apiBase}/klines?symbol=${baseSymbol}&interval=${interval}&limit=500`);
                const data = await res.json();
                setLoadingStage('数据处理中...');
                const formatted = data.map(d => ({ time: d[0] / 1000, open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] }));

                allDataRef.current = formatted;
                seriesRef.current.setData(formatted);
                dataIntervalRef.current = interval; // mark data interval
                lastLogicalRangeRef.current = chartRef.current.timeScale().getVisibleLogicalRange() || lastLogicalRangeRef.current;
                updateIndicators(formatted);
                // Force redraw drawings with new data time-scale, using rAF to ensure TimeScale is ready
                requestAnimationFrame(() => updateScreenDrawings());

                // Restore Range logic
                // Restore Range logic
                const savedRange = localStorage.getItem(`chart_range_${symbol}_${interval}`);
                let restored = false;
                if (savedRange && formatted.length > 0) {
                    try {
                        const range = JSON.parse(savedRange);
                        if (range && typeof range.from === 'number' && typeof range.to === 'number') {
                            const total = formatted.length;
                            // Check if valid. Allow small buffer for whitespace
                            if (range.to < total + 100) {
                                chartRef.current.timeScale().setVisibleLogicalRange(range);
                                restored = true;
                            } else {
                                // Data mismatch. Restore Zoom Level (Span) but Align to Right Edge
                                const span = range.to - range.from;
                                chartRef.current.timeScale().setVisibleLogicalRange({
                                    from: total - span,
                                    to: total
                                });
                                restored = true;
                            }
                        }
                    } catch (e) { console.error(e); }
                }

                if (!restored) {
                    chartRef.current.timeScale().fitContent();
                }

            } catch (e) { console.error(e); setLoadingStage('加载失败'); }
            setIsLoading(false);
            // Clear stage shortly after finishing to avoid stale text
            stageTimer = setTimeout(() => setLoadingStage(''), 300);
        };
        load();

        // WebSocket
        const ws = new WebSocket(`${wsBase}/${baseSymbol.toLowerCase()}@kline_${interval}`);
        ws.onmessage = (e) => {
            // Guard: don't update if initial load hasn't finished (prevent mixing intervals)
            if (allDataRef.current.length === 0) return;

            const m = JSON.parse(e.data);
            if (m.k) {
                const k = { time: m.k.t / 1000, open: +m.k.o, high: +m.k.h, low: +m.k.l, close: +m.k.c, volume: +m.k.v };
                seriesRef.current.update(k);
                // Sync allDataRef
                const last = allDataRef.current[allDataRef.current.length - 1];
                if (last && last.time === k.time) {
                    allDataRef.current[allDataRef.current.length - 1] = k;
                } else {
                    allDataRef.current.push(k);
                }
                updateIndicators(allDataRef.current);
            }
        };

        // Infinite Scroll Handler
        const handleScroll = async (newRange) => {
            // Persistence: Save Range
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
                lastLogicalRangeRef.current = logicalRange;
                if (saveRangeTimerRef.current) clearTimeout(saveRangeTimerRef.current);
                saveRangeTimerRef.current = setTimeout(() => {
                    localStorage.setItem(`chart_range_${symbol}_${interval}`, JSON.stringify(logicalRange));
                }, 500);
            }

                // Recompute drawing screen positions when view changes
                requestAnimationFrame(() => updateScreenDrawings());

            if (newRange && newRange.from < 20 && !isFetchingHistoryRef.current && allDataRef.current.length > 0) {
                const oldestTime = allDataRef.current[0].time * 1000;
                isFetchingHistoryRef.current = true;
                try {
                    const res = await fetch(`${apiBase}/klines?symbol=${baseSymbol}&interval=${interval}&limit=500&endTime=${oldestTime - 1}`);
                    const raw = await res.json();
                    if (Array.isArray(raw) && raw.length > 0) {
                        const newData = raw.map(d => ({ time: d[0] / 1000, open: +d[1], high: +d[2], low: +d[3], close: +d[4], volume: +d[5] }));
                        // Filter to avoid overlaps
                        const uniqueNew = newData.filter(d => d.time < allDataRef.current[0].time);
                        if (uniqueNew.length > 0) {
                            const merged = [...uniqueNew, ...allDataRef.current];
                            allDataRef.current = merged;
                            seriesRef.current.setData(merged);
                            updateIndicators(merged);

                            // No shift needed for drawings now! They use time.
                        }
                    }
                } catch (err) { console.error(err); }
                finally { isFetchingHistoryRef.current = false; }
            }
        };

        chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handleScroll);

        return () => {
            ws.close();
            if (chartRef.current) chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(handleScroll);
            if (stageTimer) clearTimeout(stageTimer);
        };
    }, [symbol, interval]);

    // Resize chart on orientation/viewport changes
    useEffect(() => {
        const resizeChart = () => {
            if (!containerRef.current || !chartRef.current) return;
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            if (w > 0 && h > 0) {
                try { chartRef.current.resize(w, h); } catch (e) { }
            }
        };
        window.addEventListener('resize', resizeChart);
        window.addEventListener('orientationchange', resizeChart);
        resizeChart();
        return () => {
            window.removeEventListener('resize', resizeChart);
            window.removeEventListener('orientationchange', resizeChart);
        };
    }, []);



    // Helpers for Time <-> Logic interpolation
    const getLogicFromTime = (time) => {
        if (!allDataRef.current || allDataRef.current.length === 0) return null;
        const data = allDataRef.current;
        const estimatedStep = parseInterval(interval);

        // Binary search for closest candle
        let l = 0, r = data.length - 1;
        while (l <= r) {
            const mid = (l + r) >> 1;
            const midTime = data[mid].time;
            if (midTime === time) return mid;
            if (midTime < time) l = mid + 1;
            else r = mid - 1;
        }
        // Not found exact, interpolate
        if (l === 0) {
            const diff = data[0].time - time;
            return -diff / estimatedStep;
        }
        if (l >= data.length) {
            const last = data[data.length - 1];
            return (data.length - 1) + (time - last.time) / estimatedStep;
        }
        const t1 = data[l - 1].time;
        const t2 = data[l].time;
        return (l - 1) + (time - t1) / (t2 - t1);
    };

    const timeToScreen = useCallback((time, price) => {
        if (!chartRef.current || !seriesRef.current) return null;
        const ts = chartRef.current.timeScale();
        let x = ts.timeToCoordinate(time);
        if (x === null) {
            // If timeScale can't place it (e.g., outside range), fall back to logical mapping with extrapolation
            const logic = getLogicFromTime(time);
            if (logic !== null) return logicToScreen(logic, price);
        }
        const y = seriesRef.current.priceToCoordinate(price);
        return (x !== null && y !== null) ? { x, y } : null;
    }, [logicToScreen, interval]);

    const getTimeFromLogic = (logic) => {
        if (!allDataRef.current || allDataRef.current.length === 0) return null;
        const data = allDataRef.current;
        const estimatedStep = parseInterval(interval);

        const idx = Math.floor(logic);
        const ratio = logic - idx;
        if (idx < 0) {
            return data[0].time + logic * estimatedStep;
        }
        if (idx >= data.length - 1) {
            const last = data[data.length - 1];
            return last.time + (logic - (data.length - 1)) * estimatedStep;
        }
        const t1 = data[idx].time;
        const t2 = data[idx + 1].time;
        return t1 + (t2 - t1) * ratio;
    };

    // Expose helpers via refs or similar? No, used in render loop.
    // Actually, logicToScreen needs access to this.
    // Let's attach them to a ref or move logicToScreen inside?
    // Better: Define them at top level but they need allDataRef.
    // Or keep logicToScreen simple and do conversion in updateScreenDrawings.

    // Back
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        const l = CapacitorApp.addListener('backButton', () => navigate('/'));
        return () => { l.then(r => r.remove()); };
    }, [navigate]);

    // Persist
    useEffect(() => {
        if (drawings.length) localStorage.setItem(`chart_drawings_${symbol}`, JSON.stringify(drawings));
        else localStorage.removeItem(`chart_drawings_${symbol}`);
        screenDrawingsRef.current = screenDrawings;
    }, [drawings, symbol, screenDrawings]);
    // Load effect removed (Handled by lazy init + key remount)

    // Long-press crosshair detection
    const longPressTimerRef = useRef(null);
    const saveRangeTimerRef = useRef(null); // For range persistence
    const isLongPressingRef = useRef(false);
    const toolbarRef = useRef(null); // For toolbar scroll
    const toolbarDragRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
    const intervalRef = useRef(null);
    const intervalDragRef = useRef({ isDragging: false, startX: 0, scrollLeft: 0 });
    const startCoordRef = useRef({ x: 0, y: 0 });
    const lastCoordRef = useRef({ x: 0, y: 0 });
    const customCrosshairRef = useRef(null);

    // State checking refs (to avoid re-binding effect and killing timer on re-render)
    const stateRefs = useRef({ drawMode, activeHandle, dragState });

    // Debug Logging Trigger
    const debugLogTriggerRef = useRef(false);
    useEffect(() => {
        debugLogTriggerRef.current = true;
    }, [interval]);

    useEffect(() => { stateRefs.current = { drawMode, activeHandle, dragState }; }, [drawMode, activeHandle, dragState]);
    useEffect(() => { customCrosshairRef.current = customCrosshair; }, [customCrosshair]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handlePointerDown = (e) => {
            // Check latest state from ref
            const { drawMode, activeHandle, dragState } = stateRefs.current;
            const isDrawing = drawMode !== DRAW_MODES.NONE;

            // If in draw mode or dragging a handle, don't enable this custom interaction
            if (isDrawing || dragState) return;

            // Only handle left button / primary touch
            if (e.button !== undefined && e.button !== 0) return;
            // Ignore click on UI buttons/controls
            if (e.target.closest('button') || e.target.closest('.mini-toolbar') || e.target.closest('.interval-selector')) return;

            // IMPORTANT: Check if clicking on a control point (anchor)
            // If so, we want to prioritize dragging over long-press crosshair
            // But if we are just selecting a shape (not anchor), we MIGHT want long press to work?
            // User requirement: "Adding a shape... stable nothing happens".
            // If we click a shape, it gets selected -> re-render. Since we removed deps, timer should stay.
            // But we should act conservatively: if hitting an anchor, DEFINITELY return.
            const isControlPoint = e.target.tagName === 'circle' && parseFloat(e.target.getAttribute('r')) >= 5;
            if (isControlPoint) return;

            // Force Clear Active Handle if clicking blank
            if (activeHandle) {
                setActiveHandle(null);
                // If not clicking a shape, clear selection too
                const isShape = ['line', 'rect', 'path', 'g'].includes(e.target.tagName);
                if (!isShape) {
                    setSelectedId(null);
                    setMenu(null);
                }
                return;
            }

            const clientX = e.clientX;
            const clientY = e.clientY;

            startCoordRef.current = { x: clientX, y: clientY };
            lastCoordRef.current = { x: clientX, y: clientY };
            isLongPressingRef.current = false;

            if (customCrosshairRef.current) {
                // Mode: Virtual Drag (Crosshair already active)
                try { container.setPointerCapture(e.pointerId); } catch (err) { }
            } else {
                // Mode: Idle (Try to detect long press)

                const rect = container.getBoundingClientRect();
                const localX = clientX - rect.left;
                const localY = clientY - rect.top;

                if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = setTimeout(() => {
                    isLongPressingRef.current = true;

                    // Trigger Crosshair
                    if (chartRef.current && seriesRef.current) {
                        const logic = chartRef.current.timeScale().coordinateToLogical(localX);
                        const price = seriesRef.current.coordinateToPrice(localY);
                        setCustomCrosshair({ x: localX, y: localY, logic, price });
                        // We must re-instantiate capture here because it might have been lost
                        try { container.setPointerCapture(e.pointerId); } catch (err) { }
                    }
                }, 800);
            }
        };

        const handlePointerMove = (e) => {
            const clientX = e.clientX;
            const clientY = e.clientY;
            const dx = clientX - lastCoordRef.current.x;
            const dy = clientY - lastCoordRef.current.y;
            lastCoordRef.current = { x: clientX, y: clientY };

            if (customCrosshairRef.current && !isLongPressingRef.current) {
                // Virtual Drag: Move crosshair by delta
                setCustomCrosshair(prev => {
                    if (!prev) return null;
                    const newX = prev.x + dx;
                    const newY = prev.y + dy;
                    if (chartRef.current && seriesRef.current) {
                        const logic = chartRef.current.timeScale().coordinateToLogical(newX);
                        const price = seriesRef.current.coordinateToPrice(newY);
                        return { ...prev, x: newX, y: newY, logic, price };
                    }
                    return { ...prev, x: newX, y: newY };
                });
                return;
            }

            // Long Press Cancel Logic
            if (longPressTimerRef.current && !customCrosshairRef.current) {
                const totalDx = Math.abs(clientX - startCoordRef.current.x);
                const totalDy = Math.abs(clientY - startCoordRef.current.y);
                if (totalDx > 10 || totalDy > 10) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
            }

            // Initial positioning during long press
            if (isLongPressingRef.current) {
                const rect = container.getBoundingClientRect();
                const localX = clientX - rect.left;
                const localY = clientY - rect.top;
                if (chartRef.current && seriesRef.current) {
                    const logic = chartRef.current.timeScale().coordinateToLogical(localX);
                    const price = seriesRef.current.coordinateToPrice(localY);
                    setCustomCrosshair({ x: localX, y: localY, logic, price });
                }
            }
        };

        const handlePointerUp = (e) => {
            // Cancel Timer
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }

            if (customCrosshairRef.current && !isLongPressingRef.current) {
                // Click check
                const totalDx = Math.abs(e.clientX - startCoordRef.current.x);
                const totalDy = Math.abs(e.clientY - startCoordRef.current.y);
                if (totalDx < 5 && totalDy < 5) {
                    setCustomCrosshair(null);
                }
            }

            try { container.releasePointerCapture(e.pointerId); } catch (err) { }
            isLongPressingRef.current = false;
        };

        const handlePointerCancel = (e) => {
            handlePointerUp(e);
        };

        // Use Capture for pointerdown to detect presses even on drawings
        container.addEventListener('pointerdown', handlePointerDown, { capture: true });
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);

        return () => {
            container.removeEventListener('pointerdown', handlePointerDown, { capture: true });
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        };
    }, []); // Empty dependency array! Robust against re-renders!

    const deleteSelected = () => { setDrawings(p => p.filter(d => d.id !== selectedId)); setSelectedId(null); };
    const clearAll = () => { setDrawings([]); setSelectedId(null); };
    // Virtual Cursor Interaction Logic
    const lastTouchRef = useRef(null);
    const onInteractStart = (e) => {
        lastTouchRef.current = { x: e.clientX, y: e.clientY };
    };

    const onInteractMove = (e) => {
        if (!activePointRef.current || !chartRef.current || !seriesRef.current) return;

        let dx = 0, dy = 0;
        if (lastTouchRef.current) {
            dx = e.clientX - lastTouchRef.current.x;
            dy = e.clientY - lastTouchRef.current.y;
        }
        lastTouchRef.current = { x: e.clientX, y: e.clientY };

        const newX = activePointRef.current.x + dx;
        const newY = activePointRef.current.y + dy;

        // Clamp to container
        if (!containerRef.current) return;
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        const clampedX = Math.max(0, Math.min(newX, width));
        const clampedY = Math.max(0, Math.min(newY, height));

        const logic = chartRef.current.timeScale().coordinateToLogical(clampedX);
        const price = seriesRef.current.coordinateToPrice(clampedY);

        if (logic !== null && price !== null) {
            const newP = { x: clampedX, y: clampedY, logic, price };
            activePointRef.current = newP; // Update Sync Ref
            setActivePoint(newP); // Trigger Render
        }
    };

    const confirmPoint = () => {
        if (!activePointRef.current) return;
        const { logic, price } = activePointRef.current;

        const pointsNeeded = { hline: 1, trendline: 2, rect: 2, channel: 3, fib: 3 };
        const newPoint = { logic, price };
        const newPending = [...pendingPointsRef.current, newPoint];
        const needed = pointsNeeded[drawModeRef.current] || 2;

        if (newPending.length >= needed) {
            let drawing;
            // getTime is now component-level

            const type = drawModeRef.current;
            if (type === 'hline') {
                const { label } = allocLabel('hline');
                drawing = { id: label, label, type: 'hline', price: newPending[0].price, width: 1 };
            } else {
                // Unified: All time-based drawings use 'points'
                const { label } = allocLabel(type);
                const base = { id: label, label, type, points: newPending.map(p => ({ ...p, time: getTime(p.logic) })), width: 1 };
                if (type === 'fib') {
                    base.fibVisible = {
                        0: true, 0.236: true, 0.382: true, 0.5: true, 0.618: true, 0.786: true, 1: true,
                        1.382: false, 1.618: false, 2.618: false, 3.618: false
                    };
                }
                drawing = base;
            }
            setDrawings(prev => [...prev, drawing]);
            setPendingPoints([]);
            pendingPointsRef.current = [];
            setDrawModeState(DRAW_MODES.NONE);
            drawModeRef.current = DRAW_MODES.NONE;
            setActivePoint(null);
            activePointRef.current = null;
        } else {
            setPendingPoints(newPending);
            pendingPointsRef.current = newPending;
        }
    };

    const getColor = (t, d) => (d && d.color) ? d.color : ({ trendline: '#00d68f', channel: '#ff9f43', rect: '#a855f7', fib: '#fcd535', hline: '#fcd535' }[t] || '#fff');

    const ptLineDist = (px, py, x1, y1, x2, y2) => {
        const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
        const dot = A * C + B * D, len = C * C + D * D;
        const t = len ? Math.max(0, Math.min(1, dot / len)) : 0;
        return Math.hypot(px - (x1 + t * C), py - (y1 + t * D));
    };

    const hitTestDrawing = useCallback((x, y) => {
        for (const d of screenDrawings) {
            if (!d) continue;
            if (d.type === 'hline') {
                if (Math.abs(y - d.screenY) <= 12) return d.id;
            } else if ((d.type === 'trendline' || d.type === 'fib' || d.type === 'channel') && d.screenPoints && d.screenPoints.length >= 2) {
                const pts = d.screenPoints;
                for (let i = 0; i < pts.length - 1; i++) {
                    const a = pts[i], b = pts[i + 1];
                    if (ptLineDist(x, y, a.x, a.y, b.x, b.y) <= 12) return d.id;
                }
            } else if (d.type === 'rect' && d.screenPoints && d.screenPoints.length >= 2) {
                const [p1, p2] = d.screenPoints;
                const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
                const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) return d.id;
            }
        }
        return null;
    }, [screenDrawings, ptLineDist]);

    const render3Pt = (d, isFib) => {
        if (!d.screenPoints || d.screenPoints.length < 3) return null;
        const [p0, p1, p2] = d.screenPoints;
        const color = getColor(d.type, d), sel = d.id === selectedId;
        const handlers = {
            onClick: (e) => {
                e.stopPropagation();
                const rect = containerRef.current.getBoundingClientRect();
                setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, type: 'drawing', id: d.id });
                setSelectedId(d.id);
            },
            onPointerDown: (e) => {
                if (selectedId !== d.id) return; // allow chart pan when not selected
                e.stopPropagation();
                handleDragStart(e, d.id, -1);
            }
        };

        const anchorHandlers = (idx) => ({
            onPointerDown: (e) => handleDragStart(e, d.id, idx),
            onClick: (e) => {
                e.stopPropagation();
                if (activeHandle && activeHandle.id === d.id && activeHandle.index === idx) {
                    setActiveHandle(null);
                } else {
                    setActiveHandle({ id: d.id, index: idx });
                    setSelectedId(d.id);
                }
            }
        });

        // Channel: Parallelogram logic
        if (!isFib) {
            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            // p3 is the calculated 4th point of the parallelogram (opposite to p1)
            const p3 = { x: p2.x - dx, y: p2.y - dy };
            // p4 is the user-placed 3rd point (p2)
            const p4 = { x: p2.x, y: p2.y };

            // For hit areas, we can reuse p3/p4 coordinates but variable names might need adjustment in hit area code if they used lx1 etc.
            // Looking at lines 1018-1021:
            // <line x1={lx1} y1={ly1} ... 
            // So we need to update those lines too or map them.
            // Let's update the hit areas to use p3/p4 as well.

            return (<g key={d.id}>
                {/* Hit Areas - 4 sides */}
                <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="transparent" strokeWidth="20" cursor="pointer" pointerEvents="all" {...handlers} />
                <line x1={p3.x} y1={p3.y} x2={p4.x} y2={p4.y} stroke="transparent" strokeWidth="20" cursor="pointer" pointerEvents="all" {...handlers} />
                {/* Connectors (optional hit area) */}
                <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} stroke="transparent" strokeWidth="20" cursor="pointer" pointerEvents="all" {...handlers} />
                <line x1={p1.x} y1={p1.y} x2={p4.x} y2={p4.y} stroke="transparent" strokeWidth="20" cursor="pointer" pointerEvents="all" {...handlers} />

                {/* Main line */}
                <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={color} strokeWidth={d.width || 2} pointerEvents="none" />
                {/* Parallel line */}
                <line x1={p3.x} y1={p3.y} x2={p4.x} y2={p4.y} stroke={color} strokeWidth={d.width || 2} pointerEvents="none" />
                {/* Center dotted line */}
                <line x1={(p0.x + p3.x) / 2} y1={(p0.y + p3.y) / 2} x2={(p1.x + p4.x) / 2} y2={(p1.y + p4.y) / 2} stroke={color} strokeWidth="1" strokeDasharray="4,2" pointerEvents="none" />
                {/* Connector dotted lines */}
                <line x1={p0.x} y1={p0.y} x2={p3.x} y2={p3.y} stroke={color} strokeWidth="1" strokeDasharray="2,2" opacity="0.5" pointerEvents="none" />
                <line x1={p1.x} y1={p1.y} x2={p4.x} y2={p4.y} stroke={color} strokeWidth="1" strokeDasharray="2,2" opacity="0.5" pointerEvents="none" />

                {sel && d.screenPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="6" fill={activeHandle?.id === d.id && activeHandle?.index === i ? "#fff" : color} stroke={activeHandle?.id === d.id && activeHandle?.index === i ? color : "#fff"} strokeWidth="2" cursor="crosshair" pointerEvents="all" {...anchorHandlers(i)} />)}
                <text x={p0.x} y={p0.y - 10} fill={color} fontSize="10" pointerEvents="auto" onClick={(e) => { e.stopPropagation(); setSelectedId(d.id); }}>{d.label || d.id}</text>
            </g>);
        }

        // Fib: Shift Vector Logic
        if (isFib) {
            const shiftX = p2.x - p1.x;
            const shiftY = p2.y - p1.y;
            return (<g key={d.id}>
                {FIB_RATIOS.map((r, i) => {
                    const isVisible = d.fibVisible ? d.fibVisible[r] !== false : (r <= 1);
                    if (!isVisible) return null;
                    const fx1 = p0.x + shiftX * r;
                    const fy1 = p0.y + shiftY * r;
                    const fx2 = p1.x + shiftX * r;
                    const fy2 = p1.y + shiftY * r;
                    // Custom Fib Color
                    const levelColor = (d.fibColors && d.fibColors[r]) ? d.fibColors[r] : color;

                    const minX = Math.min(fx1, fx2);
                    const maxX = Math.max(fx1, fx2);
                    const minY = Math.min(fy1, fy2);
                    const maxY = Math.max(fy1, fy2);

                            return (<g key={i}>
                                {/* Hit Area aligned to line */}
                                <line
                                    x1={fx1}
                                    y1={fy1}
                                    x2={fx2}
                                    y2={fy2}
                                    stroke="transparent"
                                    strokeWidth="20"
                                    cursor="pointer"
                                    pointerEvents="all"
                                    onPointerDown={(e) => {
                                        if (selectedId !== d.id) {
                                            setSelectedId(d.id);
                                            return;
                                        }
                                        e.stopPropagation();
                                        logInteract('fib pointerDown', d.id, e.pointerType);
                                        handleDragStart(e, d.id, -1);
                                    }}
                                    {...handlers}
                                />
                        {/* Visual */}
                        <line x1={fx1} y1={fy1} x2={fx2} y2={fy2} stroke={levelColor} strokeWidth={d.width || 2} opacity={sel ? 1 : 0.8} pointerEvents="none" />
                        <text x={fx2 + 5} y={fy2} fill={levelColor} fontSize="9" pointerEvents="auto" onClick={(e) => { e.stopPropagation(); setSelectedId(d.id); }}>{r}</text>
                    </g>);
                })}
                {/* Trendline (Diagonal) */}
                <line x1={p0.x} y1={p0.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth="1" strokeDasharray="4,2" opacity="0.5" pointerEvents="none" />
                {sel && d.screenPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="6" fill={activeHandle?.id === d.id && activeHandle?.index === i ? "#fff" : color} stroke={activeHandle?.id === d.id && activeHandle?.index === i ? color : "#fff"} strokeWidth="2" cursor="crosshair" pointerEvents="all" {...anchorHandlers(i)} />)}
            </g>);
        }
        return null; // Should be handled by channel block
    };

    const intervals = '1m,5m,15m,30m,1h,2h,4h,8h,1d,3d,1w,1M'.split(',');
    const pointsNeeded = { hline: 1, trendline: 2, rect: 2, channel: 3, fib: 3 };
    const currentNeeded = pointsNeeded[drawMode] || 0;

    return (
        <div className="chart-page" style={{ minHeight: '100vh' }}>
            <div className="chart-header" style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '0', padding: '0', background: '#161a25' }}>
                <div style={{ position: 'relative', width: '100%', padding: '10px 0 5px 0', minHeight: '40px' }}>
                    <button className="back-btn" onClick={() => navigate('/')} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '24px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, zIndex: 10 }}>←</button>
                    <h2 onClick={() => setShowSymbolMenu(true)} style={{ margin: 0, fontSize: '16px', color: '#fff', fontWeight: 'bold', textAlign: 'center', width: '100%', cursor: 'pointer', userSelect: 'none' }}>{symbol}</h2>
                </div>
                <div className="interval-selector"
                    ref={intervalRef}
                    onPointerDown={(e) => {
                        intervalDragRef.current = { isDragging: false, startX: e.pageX, scrollLeft: e.currentTarget.scrollLeft };
                        e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                        if (e.pointerType === 'mouse' && e.buttons !== 1) return;
                        const drag = intervalDragRef.current;
                        const walk = e.pageX - drag.startX;
                        if (Math.abs(walk) > 5) drag.isDragging = true;
                        if (drag.isDragging) {
                            e.currentTarget.scrollLeft = drag.scrollLeft - walk;
                            e.preventDefault();
                        }
                    }}
                    onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
                    onClickCapture={(e) => {
                        if (intervalDragRef.current.isDragging) {
                            e.stopPropagation();
                            e.preventDefault();
                            intervalDragRef.current.isDragging = false;
                        }
                    }}
                    style={{
                        display: 'flex', flexWrap: 'nowrap', gap: '8px', overflowX: 'auto',
                        whiteSpace: 'nowrap', scrollbarWidth: 'none', msOverflowStyle: 'none',
                        touchAction: 'none', userSelect: 'none', cursor: 'grab',
                        width: '100%', padding: '0 10px 10px 10px', alignItems: 'center', boxSizing: 'border-box'
                    }}
                >
                    <style>{`.interval-selector::-webkit-scrollbar { display: none; }`}</style>
                    {intervals.map(i => <button key={i} className={interval === i ? 'active' : ''} onClick={() => setInterval(i)} style={{ flexShrink: 0 }}>{i}</button>)}
                </div>
            </div>

            <div ref={containerRef} className="chart-container"
                style={{
                    position: 'relative',
                    cursor: inDrawMode ? 'crosshair' : 'default',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none'
                }}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDownCapture={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    if (e.pointerType === 'touch' && e.touches && e.touches.length > 1) return;
                    if (dragState) return; // do not change selection during chart drag
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const hitId = hitTestDrawing(x, y);
                    if (hitId) {
                        tapCandidateRef.current = { id: hitId, x: e.clientX, y: e.clientY };
                    } else {
                        tapCandidateRef.current = null;
                    }
                }}
                onPointerMoveCapture={(e) => {
                    const cand = tapCandidateRef.current;
                    if (!cand) return;
                    const dx = Math.abs(e.clientX - cand.x);
                    const dy = Math.abs(e.clientY - cand.y);
                    // if movement is significant, treat as pan and cancel selection
                    if (dx > 8 || dy > 8) tapCandidateRef.current = null;
                }}
                onPointerUpCapture={() => {
                    if (dragState) { tapCandidateRef.current = null; return; }
                    if (tapCandidateRef.current) {
                        setSelectedId(tapCandidateRef.current.id);
                    }
                    tapCandidateRef.current = null;
                }}
                onClick={(e) => {
                    // Clear selection only when clicking empty space (no hit)
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (!rect) {
                        setSelectedId(null); setMenu(null); setActiveHandle(null); return;
                    }
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const hitId = hitTestDrawing(x, y);
                    if (!hitId) {
                        setSelectedId(null);
                        setMenu(null);
                        setActiveHandle(null);
                    }
                }}>

                {/* Legend */}
                <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 30, display: 'flex', gap: '10px', fontSize: '12px', fontFamily: 'monospace', flexWrap: 'wrap' }}>
                    {Object.entries(indicators).map(([key, cfg]) => (
                        <div key={key}
                            style={{ color: cfg.visible ? cfg.color : '#555', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setMenu({
                                    type: 'indicator',
                                    id: key,
                                    x: rect.left,
                                    y: rect.bottom + 5,
                                    data: cfg
                                });
                            }}>
                            <span style={{ marginRight: 4 }}>{cfg.name}{cfg.period}</span>
                            {cfg.visible && legendValues[key] !== undefined && <span>{legendValues[key].toFixed(2)}</span>}
                            {!cfg.visible && <span style={{ fontSize: '10px', opacity: 0.5 }}>OFF</span>}
                        </div>
                    ))}
                    <div style={{ color: '#888', cursor: 'pointer' }} onClick={() => alert('Add Indicator feature coming soon')}>+</div>
                </div>

                {/* Config Menu */}
                {menu && (() => {
                    // Render Mini Toolbar or Settings Modal
                    const isSettings = menu.type.includes('_settings');
                    const isIndicator = menu.type.startsWith('indicator');
                    const targetId = menu.id;

                    // Common Actions
                    const close = () => { setMenu(null); setSelectedId(null); };
                    const del = () => {
                        if (isIndicator) setIndicators(p => ({ ...p, [targetId]: { ...p[targetId], visible: false } }));
                        else setDrawings(p => p.filter(d => d.id !== targetId));
                        close();
                    };
                    const toggleVis = () => {
                        if (isIndicator) setIndicators(p => ({ ...p, [targetId]: { ...p[targetId], visible: !p[targetId].visible } }));
                        else setDrawings(p => p.map(d => d.id === targetId ? { ...d, visible: !(d.visible !== false) } : d));
                    };
                    const openSettings = () => setMenu({ ...menu, type: isIndicator ? 'indicator_settings' : 'drawing_settings' });

                    if (isSettings) {
                        // Centered Modal
                        return (
                            <div style={{
                                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200,
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }} onClick={close}>
                                <div style={{
                                    background: '#1e222d', padding: '20px', borderRadius: '12px', width: '300px',
                                    border: '1px solid #2a2e39', boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
                                    display: 'flex', flexDirection: 'column', gap: '16px'
                                }} onClick={e => e.stopPropagation()}>
                                    <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>设置</h3>

                                    {isIndicator ? (
                                        <>
                                            <div className="menu-row">
                                                <label>周期</label>
                                                <input type="number" value={indicators[targetId].period}
                                                    onChange={e => setIndicators(p => ({ ...p, [targetId]: { ...p[targetId], period: parseInt(e.target.value) || 7 } }))}
                                                    style={{ width: 60, background: '#2a2e39', border: 'none', color: '#fff', padding: 8, borderRadius: 4 }} />
                                            </div>
                                            <div className="menu-row">
                                                <label>颜色</label>
                                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                    {['#fcd535', '#ff9f43', '#a855f7', '#00d68f', '#ff4757', '#3b82f6'].map(c => (
                                                        <div key={c} onClick={() => setIndicators(p => ({ ...p, [targetId]: { ...p[targetId], color: c } }))}
                                                            style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: indicators[targetId].color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="menu-row">
                                                <label>线宽</label>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    {[1, 2, 3, 4].map(w => (
                                                        <div key={w} onClick={() => setIndicators(p => ({ ...p, [targetId]: { ...p[targetId], width: w } }))}
                                                            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: indicators[targetId].width === w ? '#2a2e39' : 'transparent', cursor: 'pointer', border: '1px solid #444', borderRadius: 4 }}>
                                                            <div style={{ height: w, width: 20, background: '#888' }}></div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="menu-row">
                                                <label>主色</label>
                                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                    {['#fcd535', '#ff9f43', '#a855f7', '#00d68f', '#ff4757', '#3b82f6', '#ffffff'].map(c => (
                                                        <div key={c} onClick={() => setDrawings(p => p.map(d => d.id === targetId ? { ...d, color: c } : d))}
                                                            style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: (drawings.find(d => d.id === targetId)?.color || '#00d68f') === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="menu-row">
                                                <label>线宽</label>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    {[1, 2, 3, 4].map(w => (
                                                        <div key={w} onClick={() => setDrawings(p => p.map(d => d.id === targetId ? { ...d, width: w } : d))}
                                                            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: (drawings.find(d => d.id === targetId)?.width || 2) === w ? '#2a2e39' : 'transparent', cursor: 'pointer', border: '1px solid #444', borderRadius: 4 }}>
                                                            <div style={{ height: w, width: 20, background: '#888' }}></div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {drawings.find(d => d.id === targetId)?.type === 'fib' && (
                                                <div style={{ marginTop: 8 }}>
                                                    <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Fib 分层</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                                                        {FIB_RATIOS.map(r => {
                                                            const d = drawings.find(dd => dd.id === targetId);
                                                            const c = (d.fibColors && d.fibColors[r]) ? d.fibColors[r] : d.color; // Fallback to main color
                                                            const visible = d.fibVisible ? d.fibVisible[r] !== false : (r <= 1);
                                                            return (
                                                                <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: '#2a2e39', padding: 6, borderRadius: 6 }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={visible}
                                                                            onChange={(e) => {
                                                                                const checked = e.target.checked;
                                                                                setDrawings(prev => prev.map(dd => {
                                                                                    if (dd.id !== targetId) return dd;
                                                                                    return { ...dd, fibVisible: { ...(dd.fibVisible || {}), [r]: checked } };
                                                                                }));
                                                                            }}
                                                                        />
                                                                        <span style={{ fontSize: 11, color: '#ccc' }}>{r}</span>
                                                                    </div>
                                                                    {visible && (
                                                                        <div style={{ position: 'relative', width: 20, height: 20 }}>
                                                                            <input
                                                                                type="color"
                                                                                value={c}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                onChange={(e) => {
                                                                                    const newC = e.target.value;
                                                                                    setDrawings(prev => prev.map(dd => {
                                                                                        if (dd.id !== targetId) return dd;
                                                                                        return { ...dd, fibColors: { ...(dd.fibColors || {}), [r]: newC } };
                                                                                    }));
                                                                                }}
                                                                                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                                                                            />
                                                                            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: c, border: '1px solid #fff' }} />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    <div style={{ textAlign: 'right', marginTop: '8px' }}>
                                        <button onClick={close} style={{ padding: '8px 16px', background: '#2a2e39', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>完成</button>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    // Mini Toolbar
                    return (
                        <div className="mini-toolbar" style={{
                            position: 'absolute',
                            left: 10,
                            top: 40,
                            background: '#1e222d', border: '1px solid #2a2e39', borderRadius: '30px',
                            padding: '8px 16px', display: 'flex', gap: '16px', zIndex: 100,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)', alignItems: 'center'
                        }} onClick={e => e.stopPropagation()}>
                            <button onClick={openSettings} style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '18px', cursor: 'pointer', padding: 0 }}>⚙</button>
                            <button onClick={toggleVis} style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '18px', cursor: 'pointer', padding: 0 }}>👁</button>
                            <button onClick={del} style={{ background: 'none', border: 'none', color: '#ff4757', fontSize: '18px', cursor: 'pointer', padding: 0 }}>🗑</button>
                            <div style={{ width: 1, height: 16, background: '#333' }}></div>
                            <button onClick={close} style={{ background: 'none', border: 'none', color: '#666', fontSize: '14px', cursor: 'pointer', padding: 0 }}>✕</button>
                        </div>
                    );
                })()}

                <svg
                    style={{
                        position: 'absolute', top: 0, left: 0,
                        width: '100%', height: '100%',
                        // Let blank areas fall through to chart; child elements override pointerEvents individually
                        pointerEvents: 'none', zIndex: 10
                    }}>
                    {/* ClipPath to exclude axis areas */}
                    <defs>
                        <clipPath id="chartClip">
                            <rect x="0" y="0"
                                width={(containerRef.current?.clientWidth || 300) - 75}
                                height={(containerRef.current?.clientHeight || 200) - 25} />
                        </clipPath>
                    </defs>

                    {/* All drawings clipped to chart area */}
                    <g clipPath="url(#chartClip)">
                        {/* Active point + crosshair in draw mode */}
                        {inDrawMode && activePoint && (
                            <g>
                                {/* Crosshair lines */}
                                <line x1={0} y1={activePoint.y} x2="100%" y2={activePoint.y} stroke="rgba(255,255,255,0.5)" strokeDasharray="4,4" />
                                <line x1={activePoint.x} y1={0} x2={activePoint.x} y2="100%" stroke="rgba(255,255,255,0.5)" strokeDasharray="4,4" />
                                {/* Active point (Target Reticle) */}
                                <circle cx={activePoint.x} cy={activePoint.y} r="5" fill="transparent" stroke={getColor(drawMode)} strokeWidth="2" />
                            </g>
                        )}
                        {/* Custom long-press crosshair */}
                        {customCrosshair && !inDrawMode && (
                            <g>
                                {/* Crosshair lines - free positioning, no price snap */}
                                <line x1={0} y1={customCrosshair.y} x2="100%" y2={customCrosshair.y} stroke="rgba(252,213,53,0.8)" strokeWidth="1" strokeDasharray="4,4" />
                                <line x1={customCrosshair.x} y1={0} x2={customCrosshair.x} y2="100%" stroke="rgba(252,213,53,0.8)" strokeWidth="1" strokeDasharray="4,4" />
                                {/* Center dot */}
                                <circle cx={customCrosshair.x} cy={customCrosshair.y} r="4" fill="rgba(252,213,53,0.3)" stroke="rgba(252,213,53,1)" strokeWidth="2" />
                            </g>
                        )}
                        {/* Confirmed pending points (Solid Anchor) */}
                        {pendingPoints.map((p, i) => {
                            const sp = logicToScreen(p.logic, p.price);
                            return sp ? <circle key={i} cx={sp.x} cy={sp.y} r="6" fill={getColor(drawMode)} stroke="#fff" strokeWidth="2" /> : null;
                        })}

                        {/* Preview line from last pending point to active point */}
                        {inDrawMode && activePoint && pendingPoints.length === 1 && (
                            <line x1={logicToScreen(pendingPoints[0].logic, pendingPoints[0].price)?.x}
                                y1={logicToScreen(pendingPoints[0].logic, pendingPoints[0].price)?.y}
                                x2={activePoint.x} y2={activePoint.y}
                                stroke={getColor(drawMode)} strokeWidth="2" strokeDasharray="6,3" />
                        )}

                        {/* Preview for Channel (2 points confirmed, finding 3rd) */}
                        {inDrawMode && drawMode === 'channel' && activePoint && pendingPoints.length === 2 && (() => {
                            const p0 = logicToScreen(pendingPoints[0].logic, pendingPoints[0].price);
                            const p1 = logicToScreen(pendingPoints[1].logic, pendingPoints[1].price);
                            // Construct temp drawing object to reuse render3Pt logic
                            // But render3Pt expects a 'drawing' object. Let's make a temp one.
                            if (p0 && p1) {
                                const tempD = {
                                    id: 'temp', type: 'channel',
                                    screenPoints: [p0, p1, { x: activePoint.x, y: activePoint.y }]
                                };
                                return render3Pt(tempD, false);
                            }
                        })()}

                        {/* Preview for Fib (2 points confirmed, finding 3rd) */}
                        {inDrawMode && drawMode === 'fib' && activePoint && pendingPoints.length === 2 && (() => {
                            const p0 = logicToScreen(pendingPoints[0].logic, pendingPoints[0].price);
                            const p1 = logicToScreen(pendingPoints[1].logic, pendingPoints[1].price);
                            if (p0 && p1) {
                                const tempD = {
                                    id: 'temp', type: 'fib',
                                    screenPoints: [p0, p1, { x: activePoint.x, y: activePoint.y }]
                                };
                                return render3Pt(tempD, true);
                            }
                        })()}

                        {/* Completed drawings */}
                        {screenDrawings.map(d => {
                            const color = getColor(d.type, d), sel = d.id === selectedId;
                            const handlers = {
                                onClick: (e) => {
                                    e.stopPropagation();
                                    const rect = containerRef.current.getBoundingClientRect();
                                    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, type: 'drawing', id: d.id });
                                    setSelectedId(d.id);
                                }
                            };
                            const anchorHandlers = (idx) => ({
                                onPointerDown: (e) => handleDragStart(e, d.id, idx),
                                onClick: (e) => {
                                    e.stopPropagation();
                                    // Toggle Active Handle
                                    if (activeHandle && activeHandle.id === d.id && activeHandle.index === idx) {
                                        setActiveHandle(null);
                                    } else {
                                        setActiveHandle({ id: d.id, index: idx });
                                        // Also Select Drawing if not
                                        setSelectedId(d.id);
                                    }
                                }
                            });
                            if (d.type === 'hline') return (
                                <g key={d.id}>
                                    {/* Hit Area */}
                                <line
                                    x1={0}
                                    y1={d.screenY}
                                    x2="100%"
                                    y2={d.screenY}
                                        stroke="transparent"
                                        strokeWidth="20"
                                        cursor="pointer"
                                        pointerEvents="all"
                                        onPointerDown={(e) => {
                                                if (selectedId !== d.id) { setSelectedId(d.id); return; }
                                                e.stopPropagation();
                                                handleDragStart(e, d.id, -1);
                                        }}
                                        {...handlers}
                                />
                                    {/* Visible */}
                                    <line x1={0} y1={d.screenY} x2="100%" y2={d.screenY} stroke={color} strokeWidth={sel ? (d.width || 1) + 1 : (d.width || 1)} pointerEvents="none" />
                                    <text x={5} y={d.screenY - 5} fill={color} fontSize="10" pointerEvents="auto" onClick={(e) => { e.stopPropagation(); setSelectedId(d.id); }}>{d.label || d.id}</text>
                                    {sel && <circle cx={(containerRef.current?.clientWidth || 300) / 2} cy={d.screenY} r="7" fill={activeHandle?.id === d.id && activeHandle?.index === 0 ? "#fff" : color} stroke={activeHandle?.id === d.id && activeHandle?.index === 0 ? color : "#fff"} strokeWidth="2" cursor="ns-resize" pointerEvents="all" {...anchorHandlers(0)} />}
                                </g>
                            );
                            else if (d.type === 'trendline' && d.screenPoints && d.screenPoints.length >= 2) {
                                const [p1, p2] = d.screenPoints;
                                return (
                                    <g key={d.id}>
                                        {/* Hit Area */}
                                        <line
                                            x1={p1.x}
                                        y1={p1.y}
                                        x2={p2.x}
                                        y2={p2.y}
                                        stroke="transparent"
                                        strokeWidth="15"
                                        cursor="pointer"
                                        pointerEvents="all"
                                        onPointerDown={(e) => {
                                            if (selectedId !== d.id) { setSelectedId(d.id); return; }
                                            e.stopPropagation();
                                            logInteract('trendline pointerDown', d.id, e.pointerType);
                                            handleDragStart(e, d.id, -1);
                                            }}
                                            {...handlers}
                                        />
                                        {/* Visible */}
                                        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={d.width || 1} pointerEvents="none" />
                                        {sel && d.screenPoints.map((p, i) => (
                                            <circle key={i} cx={p.x} cy={p.y} r="6" fill={activeHandle?.id === d.id && activeHandle?.index === i ? "#fff" : color} stroke={activeHandle?.id === d.id && activeHandle?.index === i ? color : "#fff"} strokeWidth="2" cursor="crosshair" pointerEvents="all" {...anchorHandlers(i)} />
                                        ))}
                                        <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 5} fill={color} fontSize="10" textAnchor="middle" pointerEvents="auto" onClick={(e) => { e.stopPropagation(); setSelectedId(d.id); }}>{d.label || d.id}</text>
                                    </g>
                                );
                            } else if (d.type === 'rect' && d.screenPoints && d.screenPoints.length >= 2) {
                                const [p1, p2] = d.screenPoints;
                                const x = Math.min(p1.x, p2.x);
                                const y = Math.min(p1.y, p2.y);
                                const w = Math.abs(p2.x - p1.x);
                                const h = Math.abs(p2.y - p1.y);
                                return (
                                    <g key={d.id}>
                <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={`${color}20`}
                    stroke={color}
                    strokeWidth={sel ? (d.width || 1) + 1 : (d.width || 1)}
                    pointerEvents="all"
                    cursor="grab"
                    onPointerDown={(e) => {
                        if (selectedId !== d.id) { setSelectedId(d.id); return; }
                        e.stopPropagation();
                        logInteract('rect pointerDown', d.id, e.pointerType);
                        handleDragStart(e, d.id, -1);
                    }}
                    {...handlers}
                />
                                        {sel && <><circle cx={p1.x} cy={p1.y} r="7" fill={color} stroke="#fff" strokeWidth="2" cursor="grab" pointerEvents="all" onPointerDown={(e) => handleDragStart(e, d.id, 0)} /><circle cx={p2.x} cy={p2.y} r="7" fill={color} stroke="#fff" strokeWidth="2" cursor="grab" pointerEvents="all" onPointerDown={(e) => handleDragStart(e, d.id, 1)} /></>}
                                        <text x={x + 5} y={y - 5} fill={color} fontSize="10" pointerEvents="auto" onClick={(e) => { e.stopPropagation(); setSelectedId(d.id); }}>{d.label || d.id}</text>
                                    </g>
                                );
                            }
                            if (d.type === 'channel') return render3Pt(d, false);
                            if (d.type === 'fib') return render3Pt(d, true);
                            return null;
                        })}
                    </g>
                </svg>

                {/* Custom Crosshair Labels */}
                {customCrosshair && !inDrawMode && chartRef.current && seriesRef.current && (
                    <>
                        {/* Price label on right axis */}
                        {(() => {


                            let value = null;
                            let isSubChart = false;

                            // Calculate boundary: when sub-indicator is active, main chart is ~64.9% of height
                            const container = containerRef.current;
                            const containerHeight = container?.clientHeight || 0;
                            const mainChartHeight = subIndicator !== 'NONE' ? containerHeight * 0.649 : containerHeight;

                            // Debug: log values to help fine-tune
                            // console.log('Crosshair Y:', customCrosshair.y, 'Boundary:', mainChartHeight, 'In SubChart:', customCrosshair.y > mainChartHeight);

                            // Check if crosshair is in sub-chart area
                            if (customCrosshair.y > mainChartHeight && subIndicator !== 'NONE') {
                                let subSeries = null;
                                if (subIndicator === 'RSI' && subSeriesRefs.current.rsi) {
                                    subSeries = subSeriesRefs.current.rsi;
                                } else if (subIndicator === 'MACD' && subSeriesRefs.current.hist) {
                                    subSeries = subSeriesRefs.current.hist;
                                } else if (subIndicator === 'KDJ' && subSeriesRefs.current.k) {
                                    subSeries = subSeriesRefs.current.k;
                                }

                                if (subSeries) {
                                    value = subSeries.coordinateToPrice(customCrosshair.y);
                                    isSubChart = true;
                                }
                            }

                            // Fallback to main chart if not in sub-chart or no value yet
                            if (value === null) {
                                value = seriesRef.current.coordinateToPrice(customCrosshair.y);
                            }

                            if (value === null) return null;

                            return (
                                <div style={{
                                    position: 'absolute',
                                    right: '2px', // Align to right axis with small padding
                                    top: `${customCrosshair.y - 12}px`,
                                    background: 'rgba(252,213,53,0.9)', // Unified Yellow Style
                                    color: '#000',
                                    borderRadius: '4px',
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    pointerEvents: 'none',
                                    zIndex: 20,
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
                                }}>
                                    {isSubChart ? value.toFixed(2) : value.toFixed(2)}
                                </div>
                            );
                        })()}
                        {/* Time label on bottom axis */}
                        {(() => {
                            const logic = chartRef.current.timeScale().coordinateToLogical(customCrosshair.x);
                            if (logic === null) return null;
                            const time = getTime(logic);
                            const date = new Date(time * 1000);
                            const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                            return (
                                <div style={{
                                    position: 'absolute',
                                    left: `${customCrosshair.x - 40}px`,
                                    bottom: '2px',
                                    background: 'rgba(252,213,53,0.9)',
                                    color: '#000',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    pointerEvents: 'none',
                                    zIndex: 15,
                                    whiteSpace: 'nowrap'
                                }}>
                                    {timeStr}
                                </div>
                            );
                        })()}
                    </>
                )}

                {/* Interaction Layer for Virtual Cursor */}
                {inDrawMode && (
                    <div
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 20, cursor: 'none', touchAction: 'none' }}
                        onPointerDown={onInteractStart}
                        onPointerMove={onInteractMove}
                        onClick={confirmPoint}
                    />
                )}
            </div>

            <div className="drawing-toolbar"
                ref={toolbarRef}
                onPointerDown={(e) => {
                    toolbarDragRef.current = { isDragging: false, startX: e.pageX, scrollLeft: e.currentTarget.scrollLeft };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
                    const drag = toolbarDragRef.current;
                    const walk = e.pageX - drag.startX;
                    if (Math.abs(walk) > 5) drag.isDragging = true;
                    if (drag.isDragging) {
                        e.currentTarget.scrollLeft = drag.scrollLeft - walk;
                    }
                }}
                onPointerUp={(e) => {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onClickCapture={(e) => {
                    if (toolbarDragRef.current.isDragging) {
                        e.stopPropagation();
                        e.preventDefault();
                        toolbarDragRef.current.isDragging = false;
                    }
                }}
                style={{
                    overflowX: 'auto', // Keep for basic support
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 8px',
                    scrollbarWidth: 'none', /* Firefox */
                    msOverflowStyle: 'none', /* IE/Edge */
                    cursor: 'grab',
                    userSelect: 'none',
                    touchAction: 'none' // Important: Disable browser handling of gestures
                }}>
                <style>{`.drawing-toolbar::-webkit-scrollbar { display: none; }`}</style>
                <div style={{ position: 'relative' }}>
                    <button className={subIndicator !== 'NONE' ? 'active' : ''}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (showSubMenu) {
                                setShowSubMenu(false);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                // User request: Always open UPWARDS
                                setSubMenuPos({
                                    x: rect.left + (rect.width / 2),
                                    y: rect.top - 10, // Position above the button
                                    isBottom: true // Force 'bottom' calculation logic in render
                                });
                                setShowSubMenu(true);
                            }
                        }}
                        style={{ fontSize: '13px', fontWeight: 'bold' }}>
                        {subIndicator !== 'NONE' ? subIndicator : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 12c3.5-6 7-6 10 0s6.5 6 10 0" />
                            </svg>
                        )}
                    </button>
                </div>
                {/* Removed extra spacing div */}
                {['hline', 'trendline', 'channel', 'fib', 'rect'].map(t => (
                    <button key={t} className={drawMode === t ? 'active' : ''} onClick={(e) => { e.stopPropagation(); startDrawMode(t); }}>
                        {t === 'hline' ? '─' : t === 'trendline' ? '╱' : t === 'channel' ? (
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: 'block', minWidth: '20px', minHeight: '20px' }}>
                                <path d="M5 15L15 5" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M9 17L19 7" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M7 16L17 6" stroke="currentColor" strokeWidth="1" strokeDasharray="2,2" opacity="0.8" />
                            </svg>
                        ) : t === 'fib' ? 'Fib' : '▢'}
                    </button>
                ))}
                {selectedId && <button onClick={deleteSelected} style={{ color: '#ff4757' }}>🗑</button>}
                {drawings.length > 0 && !selectedId && <button onClick={clearAll} style={{ color: '#ff4757', opacity: 0.6 }}>🗑</button>}
                {selectedId && <span style={{ color: '#00d68f', fontSize: '11px', marginLeft: '6px' }}>{selectedId}</span>}

                {/* Add More Button */}
                <button onClick={() => setShowAddMenu(true)} style={{ marginLeft: '8px', fontSize: '16px' }}>+</button>
            </div>

            {/* Sub Indicator Menu (Fixed Global Position) */}
            {showSubMenu && subMenuPos && (
                <div style={{
                    position: 'fixed',
                    top: subMenuPos.isBottom ? 'auto' : subMenuPos.y,
                    bottom: subMenuPos.isBottom ? (window.innerHeight - subMenuPos.y) : 'auto',
                    left: subMenuPos.x,
                    transform: 'translateX(-50%)',
                    background: '#1e222d', border: '1px solid #2a2e39', borderRadius: '8px',
                    padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 9999, minWidth: '80px'
                }} onClick={(e) => e.stopPropagation()}>
                    {['NONE', 'RSI', 'MACD', 'KDJ'].map(type => (
                        <button key={type}
                            onClick={(e) => { e.stopPropagation(); setSubIndicator(type); setShowSubMenu(false); }}
                            style={{
                                background: subIndicator === type ? '#2a2e39' : 'transparent',
                                border: 'none', color: subIndicator === type ? '#fcd535' : '#ccc',
                                padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', textAlign: 'left'
                            }}>
                            {type === 'NONE' ? '无' : type}
                        </button>
                    ))}
                </div>
            )}

            {/* Add More Tools Modal */}
            {showAddMenu && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.6)', zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }} onClick={() => setShowAddMenu(false)}>
                    <div style={{
                        background: '#1e222d', padding: '20px', borderRadius: '16px',
                        width: '85%', maxWidth: '360px', maxHeight: '80%', overflowY: 'auto',
                        position: 'relative', border: '1px solid #2a2e39',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
                    }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => setShowAddMenu(false)} style={{
                            position: 'absolute', top: '15px', right: '15px',
                            background: 'transparent', border: 'none', color: '#666', fontSize: '24px', cursor: 'pointer'
                        }}>×</button>
                        <h3 style={{ marginTop: 0, marginBottom: '24px', color: '#fcd535', fontSize: '18px' }}>添加绘图工具</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                            {['交易', '波浪', '江恩', '形态', '形状', '测量', '标注'].map((cat, i) => (
                                <div key={cat} onClick={() => alert('即将推出: ' + cat)} style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer'
                                }}>
                                    <div style={{
                                        width: '56px', height: '56px', background: '#2a2e39', borderRadius: '12px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00d68f', fontSize: '24px'
                                    }}>
                                        {/* Simple icons for now */}
                                        {i === 0 ? '📊' : i === 1 ? '🌊' : i === 2 ? '📐' : i === 3 ? '🧩' : i === 4 ? '⬜' : i === 5 ? '📏' : '📝'}
                                    </div>
                                    <span style={{ fontSize: '11px', color: '#999', textAlign: 'center' }}>{cat}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Symbol Switcher Dropdown Menu */}
            {showSymbolMenu && (
                <>
                    {/* Backdrop */}
                    <div style={{
                        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                        background: 'transparent', zIndex: 9998
                    }} onClick={() => setShowSymbolMenu(false)} />

                    {/* Dropdown */}
                    <div style={{
                        position: 'absolute',
                        top: '60px', // Below header
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '90%',
                        maxWidth: '300px',
                        background: 'rgba(20, 24, 35, 0.65)',
                        borderRadius: '12px',
                        border: '1px solid rgba(252, 213, 53, 0.3)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                        zIndex: 9999,
                        maxHeight: '400px',
                        overflowY: 'auto',
                        padding: '12px'
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {allSymbols.map(sym => {
                                const price = liveTickers[sym]?.price;
                                const isCurrent = sym === symbol;
                                return (
                                    <div key={sym}
                                        onClick={() => {
                                            if (!isCurrent) {
                                                navigate(`/chart/${sym}`);
                                                setShowSymbolMenu(false);
                                            }
                                        }}
                                        style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '10px 14px',
                                            background: isCurrent ? 'rgba(252, 213, 53, 0.1)' : 'transparent',
                                            borderRadius: '8px',
                                            cursor: isCurrent ? 'default' : 'pointer',
                                            border: isCurrent ? '1px solid rgba(252, 213, 53, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                                        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <span style={{ fontSize: '13px', color: isCurrent ? '#fcd535' : '#fff', fontWeight: isCurrent ? 'bold' : 'normal' }}>{sym}</span>
                                        <span style={{ fontSize: '12px', color: '#00d68f', fontFamily: 'monospace' }}>
                                            {price ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '...'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
