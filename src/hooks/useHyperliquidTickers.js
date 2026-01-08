import { useEffect, useMemo, useRef, useState } from 'react';

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

// Returns map keyed by Hyperliquid market name (e.g. BTC, ETH, SUI)
export const useHyperliquidTickers = (marketNames = []) => {
    const [tickers, setTickers] = useState({});
    const namesKey = useMemo(() => marketNames.filter(Boolean).join(','), [marketNames]);
    const abortRef = useRef(null);
    const timerRef = useRef(null);

    useEffect(() => {
        const names = new Set(marketNames.filter(Boolean));
        if (!names.size) {
            setTickers({});
            return;
        }

        let stopped = false;

        const fetchOnce = async () => {
            if (stopped) return;
            if (document.hidden) return;
            try {
                if (abortRef.current) abortRef.current.abort();
                const ac = new AbortController();
                abortRef.current = ac;
                const res = await fetch(HL_INFO_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
                    signal: ac.signal
                });
                const payload = await res.json();
                const meta = payload?.[0];
                const ctxs = payload?.[1];
                const universe = Array.isArray(meta?.universe) ? meta.universe : [];
                if (!Array.isArray(ctxs) || universe.length !== ctxs.length) return;

                const next = {};
                for (let i = 0; i < universe.length; i++) {
                    const name = universe[i]?.name;
                    if (!name || !names.has(name)) continue;
                    const ctx = ctxs[i] || {};
                    const midPx = Number(ctx.midPx);
                    const prevDayPx = Number(ctx.prevDayPx);
                    if (!isFinite(midPx)) continue;
                    const changePercent = isFinite(prevDayPx) && prevDayPx !== 0 ? ((midPx - prevDayPx) / prevDayPx) * 100 : 0;
                    next[name] = { price: midPx, change: 0, changePercent };
                }
                setTickers(prev => {
                    // keep old entries for markets not returned this round
                    return { ...prev, ...next };
                });
            } catch (_) {
                // ignore (network, abort, etc)
            }
        };

        const loop = async () => {
            await fetchOnce();
            if (stopped) return;
            timerRef.current = setTimeout(loop, 1500);
        };

        loop();

        const onVis = () => {
            if (!document.hidden) fetchOnce();
        };
        document.addEventListener('visibilitychange', onVis, { passive: true });

        return () => {
            stopped = true;
            document.removeEventListener('visibilitychange', onVis);
            if (timerRef.current) clearTimeout(timerRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [namesKey]);

    return tickers;
};

