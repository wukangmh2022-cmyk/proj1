import { useState } from 'react';
import { useBinanceTickers } from './hooks/useBinanceTickers';
import './App.css';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

function App() {
  const tickers = useBinanceTickers(DEFAULT_SYMBOLS);

  return (
    <div className="container">
      <h1>Binance Live Prices</h1>
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
