export const normalizeSymbol = (value) => {
    if (!value) return '';
    return String(value).toUpperCase().trim().replace(/\s+/g, '');
};

export const isCompositeSymbol = (value) => {
    const v = normalizeSymbol(value);
    if (!v.includes('/')) return false;
    const parts = v.split('/');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
};

export const normalizeCompositeSymbol = (value) => {
    const v = normalizeSymbol(value);
    if (!v.includes('/')) return v;
    const [base, quote] = v.split('/');
    if (!base || !quote) return v;
    return `${base}/${quote}`;
};

export const stripPerpSuffix = (symbol) => {
    const v = normalizeSymbol(symbol);
    return v.endsWith('.P') ? v.slice(0, -2) : v;
};

export const tokenToSpotSymbol = (token) => {
    const clean = stripPerpSuffix(token);
    if (!clean) return '';
    return clean.endsWith('USDT') ? clean : `${clean}USDT`;
};

export const parseCompositeSymbol = (value) => {
    if (!isCompositeSymbol(value)) return null;
    const v = normalizeCompositeSymbol(value);
    const [base, quote] = v.split('/');
    if (!base || !quote) return null;
    return { baseToken: stripPerpSuffix(base), quoteToken: stripPerpSuffix(quote) };
};

export const getCompositeLegs = (value) => {
    const parsed = parseCompositeSymbol(value);
    if (!parsed) return null;
    const baseSpot = tokenToSpotSymbol(parsed.baseToken);
    const quoteSpot = tokenToSpotSymbol(parsed.quoteToken);
    if (!baseSpot || !quoteSpot) return null;
    return {
        symbol: normalizeCompositeSymbol(value),
        baseToken: parsed.baseToken,
        quoteToken: parsed.quoteToken,
        baseSpot,
        basePerp: `${baseSpot}.P`,
        quoteSpot,
        quotePerp: `${quoteSpot}.P`,
    };
};
