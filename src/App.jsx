import { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useBinanceTickers } from './hooks/useBinanceTickers';
import { usePriceAlerts } from './hooks/usePriceAlerts';
import FloatingWidget from './plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';
import { getSymbols, addSymbol, removeSymbol, saveSymbols, getFloatingConfig, saveFloatingConfig } from './utils/storage';
import { getAlerts } from './utils/alert_storage';
import { serializeDrawingAlert } from './utils/drawing_alert_utils';
import ChartPage from './components/ChartPage';
import AlertConfigModal from './components/AlertConfigModal';
import './App.css';
import { perfLog } from './utils/perfLogger';
import Diagnostics from './plugins/Diagnostics';

import { App as CapacitorApp } from '@capacitor/app';

const DIAG_ENABLED = 1;

function HomePage() {
  const navigate = useNavigate();
  const [symbols, setSymbols] = useState(getSymbols());
  const [showSettings, setShowSettings] = useState(false);
  const [alertModalSymbol, setAlertModalSymbol] = useState(null);
  const [newSymbol, setNewSymbol] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [floatingActive, setFloatingActive] = useState(false);
  const [config, setConfig] = useState(getFloatingConfig());
  const floatingActiveRef = useRef(false);

  const [isEditMode, setIsEditMode] = useState(false);
  const longPressTimerRef = useRef(null);

  // Back Button Handling
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleBackButton = async () => {
      // 1. Close Modals if open
      if (showSettings || alertModalSymbol) {
        // No add modal anymore
        setShowSettings(false);
        setAlertModalSymbol(null);
        return;
      }

      // 2. Exit Edit Mode
      if (isEditMode) {
        setIsEditMode(false);
        return;
      }

      // 3. Navigation
      // Since we are in HomePage, there is no back history usually.
      // But if we were on ChartPage, it handles it. 
      // This listener is global if attached to CapacitorApp usually, 
      // but here we are inside HomePage component. 
      // For global handling it's better to put in main App or use a cleanup.

      const { value: canGoBack } = await CapacitorApp.minimizeApp(); // Default behavior on Android home is minimize or exit
      // Actually standard behavior is exit on main. 
      // Let's implement common logic.
      CapacitorApp.exitApp();
    };

    const listener = CapacitorApp.addListener('backButton', handleBackButton);
    return () => {
      listener.then(remove => remove.remove());
    };
  }, [showSettings, alertModalSymbol, isEditMode]);

  useEffect(() => {
    perfLog('[perf] HomePage mount at', Date.now());
    return () => {
      perfLog('[perf] HomePage unmount at', Date.now());
    };
  }, []);

  const openDiagnostics = () => {
    if (!DIAG_ENABLED) return;
    if (!Capacitor.isNativePlatform()) return;
    navigate('/diag');
  };

  // App lifecycle logging (helps diagnose gray-screen resume without adb)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const l = CapacitorApp.addListener('appStateChange', (state) => {
      perfLog('[perf] appStateChange', state?.isActive ? 'active' : 'inactive', 'at', Date.now());
      if (state?.isActive) {
        requestAnimationFrame(() => perfLog('[perf] appStateChange active rAF at', Date.now()));
      }
    });
    return () => {
      l.then(r => r.remove());
    };
  }, []);

  const normalizeAlertsForNative = (alerts) => {
    return alerts.map(a => {
      const normalizedCondition = Array.isArray(a.condition)
        ? a.condition[0]
        : (Array.isArray(a.conditions) ? a.conditions[0] : a.condition);
      const normalizedConditions = Array.isArray(a.conditions)
        ? a.conditions
        : (Array.isArray(a.condition) ? a.condition : (a.condition ? [a.condition] : null));
      const normalizedTargetValue = Array.isArray(a.targetValue) ? a.targetValue[0] : a.targetValue;
      const normalizedTargetValues = Array.isArray(a.targetValues)
        ? a.targetValues
        : (Array.isArray(a.targetValue) ? a.targetValue : null);
      const baseAlert = {
        ...a,
        condition: normalizedCondition,
        conditions: normalizedConditions,
        targetValue: normalizedTargetValue,
        targetValues: normalizedTargetValues
      };

      if (baseAlert.targetType === 'drawing' && baseAlert.target === 0) {
        try {
          const drawingsStr = localStorage.getItem(`chart_drawings_${baseAlert.symbol}`);
          if (drawingsStr) {
            const drawings = JSON.parse(drawingsStr);
            const d = drawings.find(x => x.id === baseAlert.targetValue);
            if (d) {
              const serialized = serializeDrawingAlert(d);
              if (serialized) {
                // Merge Algo and Params into the Alert object for Native Service
                return {
                  ...baseAlert,
                  algo: serialized.algo,
                  params: serialized.params
                };
              }
            }
          }
        } catch (e) { console.error('Enrich Drawing Alert Error', e); }
      }
      return baseAlert;
    });
  };

  // Start native data service and sync alerts on mount (for Android)
  useEffect(() => {
    perfLog('[perf] HomePage useEffect startData/syncAlerts at', Date.now(), 'isNative=', Capacitor.isNativePlatform());
    if (Capacitor.isNativePlatform()) {
      FloatingWidget.startData({ symbols }).catch(console.error);
      // Initial alert sync
      const allAlerts = normalizeAlertsForNative(getAlerts());
      FloatingWidget.syncAlerts({ alerts: allAlerts }).catch(console.error);
    }
  }, [symbols]); // Re-start/sync when symbols change

  // Sync alerts to native whenever alert modal closes (might have changed)
  useEffect(() => {
    if (!alertModalSymbol && Capacitor.isNativePlatform()) {
      // Import alerts and sync to native
      // Import alerts and sync to native
      import('./utils/alert_storage').then(({ getAlerts }) => {
        const allAlerts = normalizeAlertsForNative(getAlerts());
        FloatingWidget.syncAlerts({ alerts: allAlerts }).catch(console.error);
      });
    }
  }, [alertModalSymbol]);

  useEffect(() => {
    floatingActiveRef.current = floatingActive;
  }, [floatingActive]);

  // Data source: native on Android (service started above), WebSocket on web
  const tickers = useBinanceTickers(symbols);
  usePriceAlerts(tickers);


  const handleAddSymbol = (symbolToAdd) => {
    const sym = symbolToAdd || newSymbol;
    if (sym.trim()) {
      const updated = addSymbol(sym);
      setSymbols([...updated]);
      setNewSymbol('');
      setShowSuggestions(false);
    }
  };

  const handleSearchInput = (value) => {
    setNewSymbol(value.toUpperCase());
    if (value.trim().length > 0) {
      // Generate suggestions: spot and perpetual
      const base = value.toUpperCase().replace('.P', '');
      const suggestions = [
        base.includes('USDT') ? base : `${base}USDT`,
        (base.includes('USDT') ? base : `${base}USDT`) + '.P'
      ];
      setSearchSuggestions(suggestions);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleRemoveSymbol = (symbol, e) => {
    e.stopPropagation();
    const updated = removeSymbol(symbol);
    setSymbols([...updated]);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(symbols);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setSymbols(items);
    saveSymbols(items);
  };

  // Drag handling logic is now explicit via Edit Mode and Handle

  const startFloating = async () => {
    if (!Capacitor.isNativePlatform()) {
      alert('Floating window only available on Android');
      return;
    }
    // ... logic same ...
    try {
      const perm = await FloatingWidget.checkPermission();
      if (!perm.granted) {
        await FloatingWidget.requestPermission();
        return;
      }
      await FloatingWidget.start();
      setFloatingActive(true);
      localStorage.setItem('floating_active', 'true'); // Persist state
      floatingActiveRef.current = true;
      await FloatingWidget.setSymbols({ symbols });
      const currentConfig = getFloatingConfig();
      await FloatingWidget.updateConfig({
        fontSize: currentConfig.fontSize,
        opacity: currentConfig.opacity,
        showSymbol: currentConfig.showSymbol,
        itemsPerPage: currentConfig.itemsPerPage
      });
    } catch (e) {
      console.error(e);
      alert('Failed to start: ' + e.message);
    }
  };

  const stopFloating = async () => {
    try {
      floatingActiveRef.current = false;
      await FloatingWidget.stop();
      setFloatingActive(false);
      localStorage.removeItem('floating_active'); // Clear state
    } catch (e) {
      console.error(e);
    }
  };

  const updateConfig = async (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    saveFloatingConfig(newConfig);
    if (Capacitor.isNativePlatform() && floatingActive) {
      try {
        await FloatingWidget.updateConfig({
          fontSize: newConfig.fontSize,
          opacity: newConfig.opacity,
          showSymbol: newConfig.showSymbol,
          itemsPerPage: newConfig.itemsPerPage
        });
      } catch (e) {
        console.error('Failed to update config', e);
      }
    }
  };

  // Auto-start floating widget if persisted
  useEffect(() => {
    const shouldStart = Capacitor.isNativePlatform() && localStorage.getItem('floating_active') === 'true';
    if (shouldStart) {
      // Chain after startData to ensure Service is ready
      // Give it a solid 1s delay to allow App resume and Permission checks
      setTimeout(() => {
        console.log('Auto-starting Floating Widget...');
        startFloating();
      }, 1000);
    }
  }, []);

  return (
    <div className="app-container" onClick={() => {
      // Only exit edit mode if clicking background, not when dragging
      // This was a bit aggressive before
    }}>
      {/* Header */}
      <div className="header">
        <h1>实时</h1>
        <div className="header-actions">
          {isEditMode ? (
            <button className="btn btn-primary" onClick={() => setIsEditMode(false)}>完成</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setIsEditMode(true)}>编辑</button>
              <button className="btn btn-secondary btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
            </>
          )}
        </div>
      </div>

      {/* Add Symbol Input (Below Header) */}
      {!isEditMode && (
        <div style={{ padding: '16px', background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="添加交易对 (如 BTC, ETHUSDT)"
              value={newSymbol}
              onChange={e => handleSearchInput(e.target.value)}
              onKeyPress={e => { if (e.key === 'Enter') handleAddSymbol(); }}
              style={{
                flex: 1,
                padding: '12px 16px',
                background: '#161b22',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
            <button
              onClick={() => handleAddSymbol()}
              style={{
                padding: '12px 24px',
                background: '#fcd535',
                border: 'none',
                borderRadius: '8px',
                color: '#000',
                fontSize: '14px',
                fontWeight: 'bold',
                fontWeight: 'bold',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              添加
            </button>
          </div>

          {/* Suggestions Dropdown */}
          {showSuggestions && searchSuggestions.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '16px',
              right: '16px',
              marginTop: '4px',
              background: '#1e222d',
              border: '1px solid rgba(252, 213, 53, 0.3)',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 100
            }}>
              {searchSuggestions.map((sug, idx) => (
                <div
                  key={idx}
                  onClick={() => handleAddSymbol(sug)}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    borderBottom: idx < searchSuggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(252, 213, 53, 0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>{sug}</span>
                  <span style={{ color: '#888', fontSize: '12px' }}>
                    {sug.endsWith('.P') ? '永续' : '现货'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ticker Grid with DND */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="symbols-grid" direction="vertical" isCombineEnabled={false}>
          {(provided) => (
            <div
              className={`ticker-grid ${isEditMode ? 'edit-mode' : ''}`}
              {...provided.droppableProps}
              ref={provided.innerRef}
            >
              {symbols.map((symbol, index) => {
                const data = tickers[symbol];
                const price = data ? data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
                const change = data ? data.changePercent.toFixed(2) : '0.00';
                const isPositive = data ? data.changePercent >= 0 : true;

                return (
                  <Draggable key={symbol} draggableId={symbol} index={index} isDragDisabled={!isEditMode}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`ticker-card ${snapshot.isDragging ? 'dragging' : ''} ${isEditMode ? 'edit-active' : ''}`}
                        onClick={() => {
                          // In edit mode, maybe clicking does nothing or deletes?
                          // User said 'click cannot enter edit' previously. 
                          // Let's allow navigation ONLY if NOT in edit mode.
                          if (!isEditMode) navigate(`/chart/${symbol}`);
                        }}
                        style={{
                          ...provided.draggableProps.style,
                        }}
                      >
                        {/* Drag Handle (Visible only in Edit Mode) */}
                        {isEditMode && (
                          <div className="drag-handle" {...provided.dragHandleProps}>
                            <div></div>
                            <div></div>
                            <div></div>
                          </div>
                        )}

                        <div className="actions">
                          {!isEditMode && (
                            <button
                              className="btn-bell"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAlertModalSymbol(symbol);
                              }}
                            >🔔</button>
                          )}
                          {isEditMode && (
                            <button
                              className="remove-btn visible"
                              onClick={(e) => handleRemoveSymbol(symbol, e)}
                            >×</button>
                          )}
                        </div>

                        <div className="card-content">
                          <div className="symbol">{symbol}</div>
                          <div className="price">${price}</div>
                          <div className={`change ${isPositive ? 'up' : 'down'}`}>
                            {isPositive ? '+' : ''}{change}%
                          </div>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>


      {/* Floating Controls */}
      {!isEditMode && (
        <div className="floating-controls">
          {!floatingActive ? (
            <button className="btn btn-primary" onClick={startFloating}>
              🔲 开启悬浮窗
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopFloating}>
              ✕ 关闭悬浮窗
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)}>
            ⚙ 设置
          </button>
        </div>
      )}

      {/* Modals */}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>悬浮窗设置</h2>
            <div className="settings-group">
              <label>显示币种名称
                <input type="checkbox" checked={config.showSymbol} onChange={e => updateConfig('showSymbol', e.target.checked)} />
              </label>
            </div>
            <div className="settings-group">
              <label>字体大小: {config.fontSize}px</label>
              <input type="range" min="10" max="24" value={config.fontSize} onChange={e => updateConfig('fontSize', parseInt(e.target.value))} />
            </div>
            <div className="settings-group">
              <label>背景透明度: {Math.round(config.opacity * 100)}%</label>
              <input type="range" min="20" max="100" value={config.opacity * 100} onChange={e => updateConfig('opacity', parseInt(e.target.value) / 100)} />
            </div>
            <div className="settings-group">
              <label>每页显示数量: {config.itemsPerPage}</label>
              <input type="range" min="1" max="5" value={config.itemsPerPage} onChange={e => updateConfig('itemsPerPage', parseInt(e.target.value))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowSettings(false)}>完成</button>
              {DIAG_ENABLED && Capacitor.isNativePlatform() && (
                <button className="btn btn-secondary" onClick={() => { setShowSettings(false); openDiagnostics(); }}>
                  诊断
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {alertModalSymbol && (
        <AlertConfigModal
          symbol={alertModalSymbol}
          currentPrice={tickers[alertModalSymbol]?.price || ''}
          onClose={() => setAlertModalSymbol(null)}
        />
      )}
    </div>
  );
}

const ChartPageWrapper = () => {
  const { symbol } = useParams();
  return <ChartPage key={symbol} />;
};

function DiagnosticsPage() {
  const [nativeText, setNativeText] = useState('');
  const [jsText, setJsText] = useState('');

  const copyText = async (text) => {
    const v = text || '';
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(v);
        return true;
      }
    } catch { }
    try {
      const ta = document.createElement('textarea');
      ta.value = v;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const LogBox = ({ title, value, onCopy }) => {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <div style={{ color: '#888', fontSize: 12 }}>{title}</div>
          <button className="btn btn-secondary" onClick={onCopy} style={{ padding: '6px 10px', fontSize: 12 }}>复制</button>
        </div>
        <textarea
          readOnly
          value={value || '(empty)'}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            width: '100%',
            minHeight: '30vh',
            resize: 'vertical',
            background: '#0b0f14',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: 12,
            borderRadius: 8,
            color: '#d1d5db',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: 'pre',
            overflow: 'auto'
          }}
        />
      </div>
    );
  };

  const load = useCallback(async () => {
    try {
      const res = await Diagnostics.getLogs({ maxBytes: 200000 });
      setNativeText(res?.text || '');
    } catch (e) {
      setNativeText(String(e?.message || e));
    }
    try {
      const raw = localStorage.getItem('amaze_diag_js');
      const list = raw ? JSON.parse(raw) : [];
      setJsText(list.map(x => {
        const t = typeof x.t === 'number' ? x.t : Date.now();
        // Native file log uses device local time; show JS timestamps in local time too (and keep epoch for alignment).
        const local = new Date(t).toLocaleString();
        return `${local} (${t}) ${x.text}`;
      }).join('\n'));
    } catch (e) {
      setJsText(String(e?.message || e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="app-container" style={{ padding: 16 }}>
      <div className="header">
        <h1>诊断</h1>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={load}>刷新</button>
          <button className="btn btn-danger" onClick={async () => {
            try { await Diagnostics.clearLogs(); } catch {}
            try { localStorage.removeItem('amaze_diag_js'); } catch {}
            load();
          }}>清空</button>
        </div>
      </div>
      <LogBox
        title="Native 文件日志（含 MainActivity onCreate/onResume）"
        value={nativeText}
        onCopy={async () => { await copyText(nativeText); }}
      />
      <LogBox
        title="JS 本地 ring buffer（不依赖网络）"
        value={jsText}
        onCopy={async () => { await copyText(jsText); }}
      />
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chart/:symbol" element={<ChartPageWrapper />} />
        {DIAG_ENABLED && <Route path="/diag" element={<DiagnosticsPage />} />}
      </Routes>
    </HashRouter>
  );
}

export default App;
