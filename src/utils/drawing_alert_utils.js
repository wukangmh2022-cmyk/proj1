/**
 * Standardized Data Structures for Remote Price Alerting
 * 
 * This module converts frontend drawing objects (lightweight-charts coordinates)
 * into a universal JSON format suitable for backend storage and detection engines.
 */

// --- Serializers: Frontend Drawing -> Backend Config ---

export const serializeDrawingAlert = (drawing) => {
    if (!drawing || !drawing.points) return null;

    const { type, id, points } = drawing;
    const base = { id, type, symbol: drawing.symbol || 'UNKNOWN' };

    // 1. Horizontal Line (Price Level)
    if (type === 'hline') {
        return {
            ...base,
            algo: 'price_level',
            params: {
                price: points[0].price
            }
        };
    }

    // 2. Trendline (Ray/Line) - Linear Function
    if (type === 'trendline') {
        const p1 = points[0];
        const p2 = points[1];
        if (!p1 || !p2) return null;

        const slope = (p2.price - p1.price) / (p2.time - p1.time);
        return {
            ...base,
            algo: 'linear_ray',
            params: {
                t0: p1.time,
                p0: p1.price,
                slope: slope
            }
        };
    }

    // 3. Parallel Channel (Two Parallel Rays)
    if (type === 'channel') {
        const p1 = points[0];
        const p2 = points[1];
        const p3 = points[2]; // Width control point
        if (!p1 || !p2 || !p3) return null;

        const slope = (p2.price - p1.price) / (p2.time - p1.time);

        // Calculate vertical offset (channel height)
        const yLineAtP3 = p1.price + slope * (p3.time - p1.time);
        const height = p3.price - yLineAtP3;

        return {
            ...base,
            algo: 'parallel_channel',
            params: {
                t0: p1.time,
                p0: p1.price,
                slope: slope,
                offsets: [0, height] // Main line (0) and Parallel line (height)
            }
        };
    }

    // 4. Fibonacci Channel (Multi-level Rays)
    if (type === 'fib') {
        const p1 = points[0];
        const p2 = points[1];
        const p3 = points[2];
        if (!p1 || !p2 || !p3) return null;

        const slope = (p2.price - p1.price) / (p2.time - p1.time);
        const yLineAtP3 = p1.price + slope * (p3.time - p1.time);
        const fullHeight = p3.price - yLineAtP3;

        // Standard Fib Levels
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
        const offsets = levels.map(r => fullHeight * r);

        return {
            ...base,
            algo: 'multi_ray',
            params: {
                t0: p1.time,
                p0: p1.price,
                slope: slope,
                offsets: offsets
            }
        };
    }

    // 5. Rectangle (Time-Bound Price Zone)
    if (type === 'rect') {
        const p1 = points[0];
        const p2 = points[1];
        if (!p1 || !p2) return null;

        return {
            ...base,
            algo: 'rect_zone',
            params: {
                tStart: Math.min(p1.time, p2.time),
                tEnd: Math.max(p1.time, p2.time),
                pHigh: Math.max(p1.price, p2.price),
                pLow: Math.min(p1.price, p2.price)
            }
        };
    }

    return null;
};


// --- Detection Engine: Backend Config + Time -> Target Price(s) ---

export const checkAlertTargets = (config, timestamp) => {
    if (!config || !config.algo || !config.params) return null;
    const { algo, params } = config;

    // 1. Price Level (Constant)
    if (algo === 'price_level') {
        return params.price;
    }

    // 2. Linear Ray: y = mx + c
    if (algo === 'linear_ray') {
        // y = p0 + slope * (t - t0)
        return params.p0 + params.slope * (timestamp - params.t0);
    }

    // 3. Parallel Channel / Multi Ray
    if (algo === 'parallel_channel' || algo === 'multi_ray') {
        const basePrice = params.p0 + params.slope * (timestamp - params.t0);
        // Return array of all line prices
        return params.offsets.map(offset => basePrice + offset);
    }

    // 4. Rect Zone
    if (algo === 'rect_zone') {
        // If outside time bounds, inactive
        if (timestamp < params.tStart || timestamp > params.tEnd) return null;
        // Return both bounds
        return [params.pHigh, params.pLow];
    }

    return null;
};
