import { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { usePriceAlerts } from './hooks/usePriceAlerts';
import FloatingWidget from './plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';
import { getSymbols, addSymbol, removeSymbol, saveSymbols, getFloatingConfig, saveFloatingConfig, getMarketDataProvider, setMarketDataProvider, getGlobalSettings, saveGlobalSettings } from './utils/storage';
import { getAlerts } from './utils/alert_storage';
import { serializeDrawingAlert } from './utils/drawing_alert_utils';
import ChartPage from './components/ChartPage';
import AlertConfigModal from './components/AlertConfigModal';
import './App.css';
import { perfLog } from './utils/perfLogger';
import Diagnostics from './plugins/Diagnostics';

import { App as CapacitorApp } from '@capacitor/app';
import { useMarketTickers } from './hooks/useMarketTickers';

const DIAG_ENABLED = 1;

const getPricePrecision = (price) => {
  const p = Math.abs(Number(price));
  if (!isFinite(p) || p === 0) return 2;
  if (p >= 100) return 2;
  if (p >= 1) return 3;
  if (p >= 0.1) return 4;
  if (p >= 0.01) return 5;
  return 6;
};

const formatQuotePrice = (price) => {
  const n = Number(price);
  if (!isFinite(n)) return '--';
  const precision = getPricePrecision(n);
  return n.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
};

function HomePage() {
  const navigate = useNavigate();
  const [symbols, setSymbols] = useState(getSymbols());
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [showFloatingSettings, setShowFloatingSettings] = useState(false);
  const [marketProviderMenuOpen, setMarketProviderMenuOpen] = useState(false);
  const [alertModalSymbol, setAlertModalSymbol] = useState(null);
  const [newSymbol, setNewSymbol] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [floatingActive, setFloatingActive] = useState(false);
  const [config, setConfig] = useState(getFloatingConfig());
  const [globalSettings, setGlobalSettings] = useState(getGlobalSettings());
  const floatingActiveRef = useRef(false);
  const [marketProvider, setMarketProviderState] = useState(getMarketDataProvider());

  const [isEditMode, setIsEditMode] = useState(false);
  const longPressTimerRef = useRef(null);

  // Back Button Handling
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleBackButton = async () => {
      // 1. Close Modals if open
      if (showGlobalSettings || showFloatingSettings || alertModalSymbol) {
        // No add modal anymore
        setShowGlobalSettings(false);
        setShowFloatingSettings(false);
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
  }, [showGlobalSettings, showFloatingSettings, alertModalSymbol, isEditMode]);

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
      // Defer native/plugin work until after first paint to reduce cold-start and reload latency.
      let cancelled = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          FloatingWidget.startData({ symbols, marketProvider }).catch(console.error);
          // Initial alert sync (can be heavy if drawings are present)
          setTimeout(() => {
            if (cancelled) return;
            try {
              const allAlerts = normalizeAlertsForNative(getAlerts());
              FloatingWidget.syncAlerts({ alerts: allAlerts, marketProvider }).catch(console.error);
            } catch (e) {
              console.error(e);
            }
          }, 0);
        });
      });
      return () => { cancelled = true; };
    }
  }, [symbols, marketProvider]); // Re-start/sync when symbols or provider change

  // Sync alerts to native whenever alert modal closes (might have changed)
  useEffect(() => {
    if (!alertModalSymbol && Capacitor.isNativePlatform()) {
      // Import alerts and sync to native
      // Import alerts and sync to native
      import('./utils/alert_storage').then(({ getAlerts }) => {
        const allAlerts = normalizeAlertsForNative(getAlerts());
        FloatingWidget.syncAlerts({ alerts: allAlerts, marketProvider }).catch(console.error);
      });
    }
  }, [alertModalSymbol, marketProvider]);

  // If provider changes while floating window is active, refresh native config/symbols too.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!floatingActive) return;
    FloatingWidget.setSymbols({ symbols, marketProvider }).catch(console.error);
    const currentConfig = getFloatingConfig();
    FloatingWidget.updateConfig({
      fontSize: currentConfig.fontSize,
      opacity: currentConfig.opacity,
      showSymbol: currentConfig.showSymbol,
      itemsPerPage: currentConfig.itemsPerPage,
      marketProvider
    }).catch(console.error);
  }, [floatingActive, symbols, marketProvider]);

  useEffect(() => {
    floatingActiveRef.current = floatingActive;
  }, [floatingActive]);

  // Data source: native on Android (service started above), WebSocket on web
  const tickers = useMarketTickers(marketProvider, symbols);
  usePriceAlerts(tickers, marketProvider);


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

  const updateGlobalSetting = (key, value) => {
    const next = { ...globalSettings, [key]: value };
    setGlobalSettings(next);
    saveGlobalSettings(next);
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
      await FloatingWidget.setSymbols({ symbols, marketProvider });
      const currentConfig = getFloatingConfig();
      await FloatingWidget.updateConfig({
        fontSize: currentConfig.fontSize,
        opacity: currentConfig.opacity,
        showSymbol: currentConfig.showSymbol,
        itemsPerPage: currentConfig.itemsPerPage,
        marketProvider
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
          itemsPerPage: newConfig.itemsPerPage,
          marketProvider
        });
      } catch (e) {
        console.error('Failed to update config', e);
      }
    }
  };

  useEffect(() => {
    if (!showGlobalSettings) {
      setMarketProviderMenuOpen(false);
      return;
    }
    if (!marketProviderMenuOpen) return;
    const onPointerDown = (e) => {
      if (e.target.closest('.settings-provider-select')) return;
      setMarketProviderMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [marketProviderMenuOpen, showGlobalSettings]);

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
    <div className={`app-container ${globalSettings.homeCompactMode ? 'home-compact' : ''}`} onClick={() => {
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
              <button className="btn btn-secondary btn-icon" onClick={() => setShowGlobalSettings(true)}>⚙</button>
            </>
          )}
        </div>
      </div>

      {/* Add Symbol Input (Below Header) */}
      {!isEditMode && (
        <div style={{ padding: '16px', background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ width: '100%', maxWidth: '520px', margin: '0 auto', position: 'relative' }}>
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
                left: 0,
                right: 0,
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
        </div>
      )}

      {/* Ticker Grid with DND */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="symbols-grid" direction="vertical" isCombineEnabled={false}>
          {(provided) => (
            <div
              className={`ticker-grid ${isEditMode ? 'edit-mode' : ''}`}
              style={{ '--ticker-min-width': `${globalSettings.homeTickerMinWidth || 160}px` }}
              {...provided.droppableProps}
              ref={provided.innerRef}
            >
	              {symbols.map((symbol, index) => {
	                const data = tickers[symbol];
	                const price = data ? formatQuotePrice(data.price) : '--';
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
                          <div className="price-row">
                            <div className="price">${price}</div>
                            {globalSettings.homeShowChangePercent && (
                              <div className={`change ${isPositive ? 'up' : 'down'}`}>
                                {isPositive ? '+' : ''}{change}%
                              </div>
                            )}
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
          <button className="btn btn-secondary" onClick={() => setShowFloatingSettings(true)}>
            ⚙ 设置
          </button>
        </div>
      )}

      {/* Modals */}

      {showGlobalSettings && (
        <div className="modal-overlay" onClick={() => setShowGlobalSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>设置</h2>
            <div className="settings-group">
              <label>行情数据源</label>
              <div className="settings-provider-select">
                <button
                  type="button"
                  className="settings-provider-select-btn"
                  onClick={() => setMarketProviderMenuOpen(v => !v)}
                >
                  <span>{marketProvider === 'hyperliquid' ? 'Hyperliquid' : 'Binance'}</span>
                  <span className="settings-provider-select-caret">▾</span>
                </button>
                {marketProviderMenuOpen && (
                  <div className="settings-provider-select-menu">
                    {[
                      { value: 'binance', label: 'Binance' },
                      { value: 'hyperliquid', label: 'Hyperliquid' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`settings-provider-select-item ${marketProvider === opt.value ? 'active' : ''}`}
                        onClick={() => {
                          if (opt.value !== marketProvider) {
                            const ok = window.confirm('切换数据源会清空当前图形与预警配置（避免不同交易所/时间轴不一致导致误报）。\n\n是否继续？');
                            if (!ok) return;
                            try {
                              // Clear drawing caches for all symbols
                              const all = getSymbols();
                              all.forEach(s => localStorage.removeItem(`chart_drawings_${s}`));
                              // Clear alert configs + history
                              localStorage.removeItem('binance_alerts');
                              localStorage.removeItem('binance_alert_history');
                            } catch {}
                          }
                          setMarketProviderMenuOpen(false);
                          setMarketProviderState(opt.value);
                          setMarketDataProvider(opt.value);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>
                切换数据源会清空当前图形与预警配置（避免不同交易所/时间轴不一致导致误报）。
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">首页布局</div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label>紧凑模式
                  <input
                    type="checkbox"
                    checked={!!globalSettings.homeCompactMode}
                    onChange={e => updateGlobalSetting('homeCompactMode', e.target.checked)}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label>卡片最小宽度: {globalSettings.homeTickerMinWidth || 160}px</label>
                <input
                  type="range"
                  min="120"
                  max="220"
                  value={globalSettings.homeTickerMinWidth || 160}
                  onChange={e => updateGlobalSetting('homeTickerMinWidth', parseInt(e.target.value))}
                />
              </div>
              <div className="settings-group" style={{ marginBottom: 0 }}>
                <label>显示涨跌幅
                  <input
                    type="checkbox"
                    checked={globalSettings.homeShowChangePercent !== false}
                    onChange={e => updateGlobalSetting('homeShowChangePercent', e.target.checked)}
                  />
                </label>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">账号登录</div>
              <div className="settings-placeholder">占位：目前只做本地保存，不会真正登录。</div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>邮箱/账号</span>
                  <input
                    type="text"
                    value={globalSettings.accountEmail || ''}
                    onChange={e => updateGlobalSetting('accountEmail', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 0 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>密码</span>
                  <input
                    type="password"
                    value={globalSettings.accountPassword || ''}
                    onChange={e => updateGlobalSetting('accountPassword', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">交易所 API</div>
              <div className="settings-placeholder">占位：目前只做本地保存（明文），后续再做加密/安全存储。</div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>BN Key</span>
                  <input
                    type="text"
                    value={globalSettings.binanceApiKey || ''}
                    onChange={e => updateGlobalSetting('binanceApiKey', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>BN Secret</span>
                  <input
                    type="password"
                    value={globalSettings.binanceApiSecret || ''}
                    onChange={e => updateGlobalSetting('binanceApiSecret', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>HL 地址</span>
                  <input
                    type="text"
                    value={globalSettings.hyperliquidWalletAddress || ''}
                    onChange={e => updateGlobalSetting('hyperliquidWalletAddress', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 0 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>HL 私钥</span>
                  <input
                    type="password"
                    value={globalSettings.hyperliquidPrivateKey || ''}
                    onChange={e => updateGlobalSetting('hyperliquidPrivateKey', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">钱包</div>
              <div className="settings-placeholder">占位：后续会迁移到系统安全存储。</div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>地址</span>
                  <input
                    type="text"
                    value={globalSettings.hyperliquidWalletAddress || ''}
                    onChange={e => updateGlobalSetting('hyperliquidWalletAddress', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 0 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>私钥</span>
                  <input
                    type="password"
                    value={globalSettings.hyperliquidPrivateKey || ''}
                    onChange={e => updateGlobalSetting('hyperliquidPrivateKey', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">Telegram</div>
              <div className="settings-placeholder">占位：目前只做本地保存，不会真正接入。</div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>API ID</span>
                  <input
                    type="text"
                    value={globalSettings.telegramApiId || ''}
                    onChange={e => updateGlobalSetting('telegramApiId', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 12 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>API HASH</span>
                  <input
                    type="password"
                    value={globalSettings.telegramApiHash || ''}
                    onChange={e => updateGlobalSetting('telegramApiHash', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
              <div className="settings-group" style={{ marginBottom: 0 }}>
                <label style={{ justifyContent: 'flex-start', gap: 10 }}>
                  <span style={{ minWidth: 84 }}>手机号</span>
                  <input
                    type="text"
                    value={globalSettings.telegramPhone || ''}
                    onChange={e => updateGlobalSetting('telegramPhone', e.target.value)}
                    style={{ marginBottom: 0 }}
                  />
                </label>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowGlobalSettings(false)}>完成</button>
              {DIAG_ENABLED && Capacitor.isNativePlatform() && (
                <button className="btn btn-secondary" onClick={() => { setShowGlobalSettings(false); openDiagnostics(); }}>
                  诊断
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showFloatingSettings && (
        <div className="modal-overlay" onClick={() => setShowFloatingSettings(false)}>
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
              <button className="btn btn-primary" onClick={() => setShowFloatingSettings(false)}>完成</button>
              {DIAG_ENABLED && Capacitor.isNativePlatform() && (
                <button className="btn btn-secondary" onClick={() => { setShowFloatingSettings(false); openDiagnostics(); }}>
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
