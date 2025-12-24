import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import '../App.css';

export default function ChartPage() {
    const { symbol } = useParams();
    const navigate = useNavigate();

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        const handleBackButton = () => {
            navigate(-1);
        };

        // Add the listener for the back button
        const listener = CapacitorApp.addListener('backButton', handleBackButton);

        // Clean up the listener when the component unmounts
        return () => {
            listener.then(remove => remove.remove());
        };
    }, [navigate]); // Re-run effect if navigate function changes

    // Use TradingView Widget (public embed, no API key needed)
    const widgetUrl = `https://www.tradingview.com/widgetembed/?frameElementId=tv-widget&symbol=BINANCE:${symbol}&interval=60&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=[]&theme=dark&style=1&timezone=exchange&withdateranges=1&showpopupbutton=0&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&locale=zh_CN&utm_source=&utm_medium=widget&utm_campaign=chart`;

    return (
        <div className="chart-page">
            <div className="chart-header">
                <button className="back-btn" onClick={() => navigate(-1)}>←</button>
                <div className="symbol-info">
                    <h2>{symbol}</h2>
                </div>
            </div>
            <div className="chart-container">
                <iframe
                    src={widgetUrl}
                    style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        borderRadius: '8px'
                    }}
                    title={`${symbol} Chart`}
                    allowFullScreen
                />
            </div>
        </div>
    );
}
