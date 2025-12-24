import { useState } from 'react';
import { useBinanceTickers } from './hooks/useBinanceTickers';
import FloatingWidget from './plugins/FloatingWidget';
import { Capacitor } from '@capacitor/core';
import './App.css';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

function App() {
  const tickers = useBinanceTickers(DEFAULT_SYMBOLS);
  const [isCapping, setIsCapping] = useState(false);

  const startFloating = async () => {
    if (!Capacitor.isNativePlatform()) {
      alert("Floating window only available on Android");
      return;
    }

    try {
      // Check/Request permission first
      const perm = await FloatingWidget.checkPermission();
      if (!perm.granted) {
        await FloatingWidget.requestPermission();
        return;
      }

      await FloatingWidget.start();
      setIsCapping(true);
    } catch (e) {
      console.error(e);
      alert("Failed to start floating widget: " + e.message);
    }
  };

  const stopFloating = async () => {
    try {
      await FloatingWidget.stop();
      setIsCapping(false);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="container">
      <h1>Binance Live Prices</h1>

      <div className="controls" style={{ marginBottom: '20px' }}>
        <button onClick={startFloating} style={{ marginRight: '10px', padding: '10px 20px', fontSize: '16px' }}>
          Enable Floating Window
        </button>
        <button onClick={stopFloating} style={{ padding: '10px 20px', fontSize: '16px', background: '#f6465d' }}>
          Disable
        </button>
      </div>

      <div className="ticker-grid">
        {DEFAULT_SYMBOLS.map(symbol => {
          const data = tickers[symbol];
          const price = data ? data.price.toFixed(2) : 'Loading...';
          const change = data ? data.changePercent.toFixed(2) : '0.00';
          const isPositive = data ? data.changePercent >= 0 : true;

          return (
            <div key={symbol} className="ticker-card">
              <div className="symbol">{symbol}</div>
              <div className="price">${price}</div>
              <div className={`change ${isPositive ? 'up' : 'down'}`}>
                {isPositive ? '+' : ''}{change}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
