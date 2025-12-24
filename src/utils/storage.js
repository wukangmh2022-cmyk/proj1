const SYMBOLS_KEY = 'binance_symbols';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

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
    showSymbol: true,
    fontSize: 14,
    opacity: 0.85,
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
