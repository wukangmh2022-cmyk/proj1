import { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useBinanceTickers } from './hooks/useBinanceTickers';
import FloatingWidget from './plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';
import { getSymbols, addSymbol, removeSymbol, getFloatingConfig, saveFloatingConfig } from './utils/storage';
import ChartPage from './components/ChartPage';
import './App.css';

function HomePage() {
  const navigate = useNavigate();
  const [symbols, setSymbols] = useState(getSymbols());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [floatingActive, setFloatingActive] = useState(false);
  const [config, setConfig] = useState(getFloatingConfig());
  const floatingActiveRef = useRef(false);

  // Update ref when state changes
  useEffect(() => {
    floatingActiveRef.current = floatingActive;

    // Sync symbols list to native if active
    if (floatingActive && Capacitor.isNativePlatform()) {
      FloatingWidget.setSymbols({ symbols }).catch(console.error);
    }
  }, [floatingActive, symbols]);

  // Callback for ticker updates - only sends to widget if active
  const handleTickerUpdate = useCallback((symbol, data) => {
    if (!floatingActiveRef.current || !Capacitor.isNativePlatform()) return;

    FloatingWidget.update({
      symbol: symbol,
      price: data.price.toFixed(2),
      change: data.changePercent.toFixed(2)
    }).catch(() => { }); // Ignore if not running
  }, []);

  const tickers = useBinanceTickers(symbols, handleTickerUpdate);

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
      floatingActiveRef.current = true; // Update ref immediately to prevent race conditions

      // Sync symbols list
      await FloatingWidget.setSymbols({ symbols });

      // Apply current config immediately
      const currentConfig = getFloatingConfig();
      await FloatingWidget.updateConfig({
        fontSize: currentConfig.fontSize,
        opacity: currentConfig.opacity,
        showSymbol: currentConfig.showSymbol
      });
    } catch (e) {
      console.error(e);
      alert('Failed to start: ' + e.message);
    }
  };

  const stopFloating = async () => {
    try {
      floatingActiveRef.current = false; // Stop updates immediately
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

    // Sync config to native layer if floating is active
    if (Capacitor.isNativePlatform() && floatingActive) {
      try {
        await FloatingWidget.updateConfig({
          fontSize: newConfig.fontSize,
          opacity: newConfig.opacity,
          showSymbol: newConfig.showSymbol
        });
      } catch (e) {
        console.error('Failed to update config', e);
      }
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <div className="header">
        <h1>₿ Binance Live</h1>
        <div className="header-actions">
          <button className="btn btn-secondary btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Add</button>
        </div>
      </div>

      {/* Ticker Grid */}
      <div className="ticker-grid">
        {symbols.map(symbol => {
          const data = tickers[symbol];
          const price = data ? data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
          const change = data ? data.changePercent.toFixed(2) : '0.00';
          const isPositive = data ? data.changePercent >= 0 : true;

          return (
            <div
              key={symbol}
              className="ticker-card"
              onClick={() => navigate(`/chart/${symbol}`)}
            >
              <button
                className="remove-btn"
                onClick={(e) => handleRemoveSymbol(symbol, e)}
              >×</button>
              <div className="symbol">{symbol}</div>
              <div className="price">${price}</div>
              <div className={`change ${isPositive ? 'up' : 'down'}`}>
                {isPositive ? '+' : ''}{change}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Controls */}
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

      {/* Add Symbol Modal */}
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

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Floating Window Settings</h2>

            <div className="settings-group">
              <label>
                Show Symbol Name
                <input
                  type="checkbox"
                  checked={config.showSymbol}
                  onChange={e => updateConfig('showSymbol', e.target.checked)}
                />
              </label>
            </div>

            <div className="settings-group">
              <label>Font Size: {config.fontSize}px</label>
              <input
                type="range"
                min="10"
                max="24"
                value={config.fontSize}
                onChange={e => updateConfig('fontSize', parseInt(e.target.value))}
              />
            </div>

            <div className="settings-group">
              <label>Background Opacity: {Math.round(config.opacity * 100)}%</label>
              <input
                type="range"
                min="20"
                max="100"
                value={config.opacity * 100}
                onChange={e => updateConfig('opacity', parseInt(e.target.value) / 100)}
              />
            </div>

            <div className="settings-group">
              <label>Items Per Page: {config.itemsPerPage}</label>
              <input
                type="range"
                min="1"
                max="5"
                value={config.itemsPerPage}
                onChange={e => updateConfig('itemsPerPage', parseInt(e.target.value))}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Done</button>
            </div>
          </div>
        </div>
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
