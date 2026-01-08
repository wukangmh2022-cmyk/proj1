const SYMBOLS_KEY = 'symbols';
const LEGACY_SYMBOLS_KEY = 'binance_symbols';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ZECUSDT'];

const normalizeSymbol = (symbol) => {
    const raw = String(symbol || '').toUpperCase().trim();
    if (!raw) return '';
    const isPerp = raw.endsWith('.P');
    const base = isPerp ? raw.slice(0, -2) : raw;

    // Keep symbols that already specify quote or contain separators.
    if (base.includes('/') || base.includes('-')) return raw;
    if (base.endsWith('USDT') || base.endsWith('USDC') || base.endsWith('USD')) return raw;

    // If user enters "BTC" / "UNI" etc, assume USDT quote by default.
    if (/^[A-Z0-9]{2,20}$/.test(base)) {
        return isPerp ? `${base}USDT.P` : `${base}USDT`;
    }
    return raw;
};

export const getSymbols = () => {
    const stored = localStorage.getItem(SYMBOLS_KEY) ?? localStorage.getItem(LEGACY_SYMBOLS_KEY);
    if (!stored) return DEFAULT_SYMBOLS;
    try {
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_SYMBOLS;
        const normalized = parsed.map(normalizeSymbol).filter(Boolean);
        return normalized.length ? normalized : DEFAULT_SYMBOLS;
    } catch {
        return DEFAULT_SYMBOLS;
    }
};

export const saveSymbols = (symbols) => {
    const s = JSON.stringify(symbols);
    localStorage.setItem(SYMBOLS_KEY, s);
    // Backward-compat for older builds that still read `binance_symbols`.
    localStorage.setItem(LEGACY_SYMBOLS_KEY, s);
    return symbols;
};

export const addSymbol = (symbol) => {
    const symbols = getSymbols();
    const upper = normalizeSymbol(symbol);
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

// Global settings (placeholders for future features)
const GLOBAL_SETTINGS_KEY = 'global_settings';
const DEFAULT_GLOBAL_SETTINGS = {
    homeCompactMode: false,
    homeTickerMinWidth: 160,
    homeShowChangePercent: true,

    accountEmail: '',
    accountPassword: '',

    binanceApiKey: '',
    binanceApiSecret: '',
    hyperliquidWalletAddress: '',
    hyperliquidPrivateKey: '',

    telegramApiId: '',
    telegramApiHash: '',
    telegramPhone: ''
};

export const getGlobalSettings = () => {
    const stored = localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (!stored) return DEFAULT_GLOBAL_SETTINGS;
    try {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_GLOBAL_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch {
        return DEFAULT_GLOBAL_SETTINGS;
    }
};

export const saveGlobalSettings = (settings) => {
    localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_GLOBAL_SETTINGS, ...(settings || {}) }));
};
