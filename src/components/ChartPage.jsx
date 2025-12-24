import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createChart } from 'lightweight-charts';
import '../App.css';

export default function ChartPage() {
    const { symbol } = useParams();
    const navigate = useNavigate();
    const chartContainerRef = useRef(null);
    const [currentPrice, setCurrentPrice] = useState(null);
    const [priceChange, setPriceChange] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: 'solid', color: '#0d1117' },
                textColor: '#8b949e',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            crosshair: {
                mode: 1,
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#00d68f',
            downColor: '#ff4757',
            borderDownColor: '#ff4757',
            borderUpColor: '#00d68f',
            wickDownColor: '#ff4757',
            wickUpColor: '#00d68f',
        });

        // Fetch klines data
        fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`)
            .then(res => res.json())
            .then(data => {
                const formatted = data.map(d => ({
                    time: d[0] / 1000,
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                }));
                candlestickSeries.setData(formatted);

                if (formatted.length > 0) {
                    const last = formatted[formatted.length - 1];
                    const first = formatted[0];
                    setCurrentPrice(last.close);
                    const change = ((last.close - first.open) / first.open * 100).toFixed(2);
                    setPriceChange(change);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch klines', err);
                setLoading(false);
            });

        chart.timeScale().fitContent();

        const handleResize = () => {
            chart.applyOptions({
                width: chartContainerRef.current.clientWidth,
                height: chartContainerRef.current.clientHeight,
            });
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [symbol]);

    return (
        <div className="chart-page">
            <div className="chart-header">
                <button className="back-btn" onClick={() => navigate('/')}>←</button>
                <div className="symbol-info">
                    <h2>{symbol}</h2>
                    {currentPrice && (
                        <div className="price" style={{ color: priceChange >= 0 ? '#00d68f' : '#ff4757' }}>
                            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span style={{ fontSize: '0.9rem', marginLeft: '10px' }}>
                                {priceChange >= 0 ? '+' : ''}{priceChange}%
                            </span>
                        </div>
                    )}
                </div>
            </div>
            <div className="chart-container" ref={chartContainerRef}>
                {loading && <div className="loading">Loading chart</div>}
            </div>
        </div>
    );
}
