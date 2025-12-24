import { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useBinanceTickers } from './hooks/useBinanceTickers';
import { usePriceAlerts } from './hooks/usePriceAlerts';
import FloatingWidget from './plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';
import { getSymbols, addSymbol, removeSymbol, saveSymbols, getFloatingConfig, saveFloatingConfig } from './utils/storage';
import ChartPage from './components/ChartPage';
import AlertConfigModal from './components/AlertConfigModal';
import './App.css';

import { App as CapacitorApp } from '@capacitor/app';

function HomePage() {
  const navigate = useNavigate();
  const [symbols, setSymbols] = useState(getSymbols());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [alertModalSymbol, setAlertModalSymbol] = useState(null);
  const [newSymbol, setNewSymbol] = useState('');
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
      if (showAddModal || showSettings || alertModalSymbol) {
        setShowAddModal(false);
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
  }, [showAddModal, showSettings, alertModalSymbol, isEditMode]);

  // Start native data service on mount (for Android)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      FloatingWidget.startData({ symbols }).catch(console.error);
    }
  }, [symbols]); // Re-start when symbols change

  useEffect(() => {
    floatingActiveRef.current = floatingActive;
  }, [floatingActive]);

  // Data source: native on Android (service started above), WebSocket on web
  const tickers = useBinanceTickers(symbols);
  usePriceAlerts(tickers);

  const handleAddSymbol = () => {
    if (newSymbol.trim()) {
      const updated = addSymbol(newSymbol);
      setSymbols([...updated]);
      setNewSymbol('');
      setShowAddModal(false);
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

  return (
    <div className="app-container" onClick={() => {
      // Only exit edit mode if clicking background, not when dragging
      // This was a bit aggressive before
    }}>
      {/* Header */}
      <div className="header">
        <h1>₿ 实时行情</h1>
        <div className="header-actions">
          {isEditMode ? (
            <button className="btn btn-primary" onClick={() => setIsEditMode(false)}>完成</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => setIsEditMode(true)}>编辑</button>
              <button className="btn btn-secondary btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ 添加</button>
            </>
          )}
        </div>
      </div>

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
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>添加交易对</h2>
            <input
              type="text"
              placeholder="如 DOGEUSDT"
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddSymbol}>添加</button>
            </div>
          </div>
        </div>
      )}

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
            </div>
          </div>
        </div>
      )}

      {alertModalSymbol && (
        <AlertConfigModal
          symbol={alertModalSymbol}
          currentPrice={tickers[alertModalSymbol]?.price}
          onClose={() => setAlertModalSymbol(null)}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chart/:symbol" element={<ChartPage />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
