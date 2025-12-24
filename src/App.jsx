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

  useEffect(() => {
    floatingActiveRef.current = floatingActive;
    if (floatingActive && Capacitor.isNativePlatform()) {
      FloatingWidget.setSymbols({ symbols }).catch(console.error);
    }
  }, [floatingActive, symbols]);

  // Ticker updates are now handled natively by the Android Service
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

  const handleTouchStart = (e) => {
    if (isEditMode) return;
    longPressTimerRef.current = setTimeout(() => {
      setIsEditMode(true);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 800);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const startFloating = async () => {
    if (!Capacitor.isNativePlatform()) {
      alert('Floating window only available on Android');
      return;
    }
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
    <div className="app-container" onClick={() => isEditMode && setIsEditMode(false)}>
      {/* Header */}
      <div className="header">
        <h1>₿ Binance Live</h1>
        <div className="header-actions">
          {isEditMode ? (
            <button className="btn btn-primary" onClick={() => setIsEditMode(false)}>Done</button>
          ) : (
            <>
              <button className="btn btn-secondary btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add</button>
            </>
          )}
        </div>
      </div>

      {/* Ticker Grid with DND */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="symbols-grid" direction="horizontal" isCombineEnabled={false}>
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
                        {...provided.dragHandleProps}
                        className={`ticker-card ${snapshot.isDragging ? 'dragging' : ''} ${isEditMode ? 'wobble' : ''}`}
                        onClick={() => !isEditMode && navigate(`/chart/${symbol}`)}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onMouseDown={handleTouchStart}
                        onMouseUp={handleTouchEnd}
                      >
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

                        <div className="symbol">{symbol}</div>
                        <div className="price">${price}</div>
                        <div className={`change ${isPositive ? 'up' : 'down'}`}>
                          {isPositive ? '+' : ''}{change}%
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
              🔲 Enable Overlay
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopFloating}>
              ✕ Disable Overlay
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)}>
            ⚙ Settings
          </button>
        </div>
      )}

      {/* Modals ... (Rest remains same) */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Add Symbol</h2>
            <input
              type="text"
              placeholder="e.g. DOGEUSDT"
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddSymbol}>Add</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Floating Window Settings</h2>
            <div className="settings-group">
              <label>Show Symbol Name
                <input type="checkbox" checked={config.showSymbol} onChange={e => updateConfig('showSymbol', e.target.checked)} />
              </label>
            </div>
            <div className="settings-group">
              <label>Font Size: {config.fontSize}px</label>
              <input type="range" min="10" max="24" value={config.fontSize} onChange={e => updateConfig('fontSize', parseInt(e.target.value))} />
            </div>
            <div className="settings-group">
              <label>Background Opacity: {Math.round(config.opacity * 100)}%</label>
              <input type="range" min="20" max="100" value={config.opacity * 100} onChange={e => updateConfig('opacity', parseInt(e.target.value) / 100)} />
            </div>
            <div className="settings-group">
              <label>Items Per Page: {config.itemsPerPage}</label>
              <input type="range" min="1" max="5" value={config.itemsPerPage} onChange={e => updateConfig('itemsPerPage', parseInt(e.target.value))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Done</button>
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
