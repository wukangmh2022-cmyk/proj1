const SYMBOLS_KEY = 'binance_symbols';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ZECUSDT'];

export const getSymbols = () => {
    const stored = localStorage.getItem(SYMBOLS_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch {
            return DEFAULT_SYMBOLS;
        }
    }
    return DEFAULT_SYMBOLS;
};

export const saveSymbols = (symbols) => {
    localStorage.setItem(SYMBOLS_KEY, JSON.stringify(symbols));
    return symbols;
};

export const addSymbol = (symbol) => {
    const symbols = getSymbols();
    const upper = symbol.toUpperCase().trim();
    if (upper && !symbols.includes(upper)) {
        symbols.push(upper);
        saveSymbols(symbols);
    }
    return symbols;
};

export const removeSymbol = (symbol) => {
    let symbols = getSymbols();
    symbols = symbols.filter(s => s !== symbol);
    saveSymbols(symbols);
    return symbols;
};

// Floating window config
const CONFIG_KEY = 'floating_config';
const DEFAULT_CONFIG = {
    showSymbol: false,
    fontSize: 10,
    opacity: 0.5,
    itemsPerPage: 1
};

export const getFloatingConfig = () => {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
        try {
            return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
        } catch {
            return DEFAULT_CONFIG;
        }
    }
    return DEFAULT_CONFIG;
};

export const saveFloatingConfig = (config) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

// Market data provider (Home/Chart tickers)
const MARKET_PROVIDER_KEY = 'market_data_provider';
const DEFAULT_MARKET_PROVIDER = 'binance'; // 'binance' | 'hyperliquid'

export const getMarketDataProvider = () => {
    const stored = localStorage.getItem(MARKET_PROVIDER_KEY);
    if (stored === 'binance' || stored === 'hyperliquid') return stored;
    return DEFAULT_MARKET_PROVIDER;
};

export const setMarketDataProvider = (provider) => {
    if (provider !== 'binance' && provider !== 'hyperliquid') return;
    localStorage.setItem(MARKET_PROVIDER_KEY, provider);
};
