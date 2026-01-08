package com.binance.pricemonitor;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.IBinder;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.os.Build;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.NotificationCompat;

public class FloatingWindowService extends Service {
    private WindowManager windowManager;
    private View floatingView;
    private LinearLayout container;
    private LinearLayout itemsContainer;
    private WindowManager.LayoutParams params;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final android.os.Handler klineHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private long lastUiUpdateMs = 0L;
    private static final long UI_UPDATE_THROTTLE_MS = 200L; // cap UI redraws to ~5fps to reduce jank
    private long lastKlineMessageMs = 0L;
    private int klineRetryAttempt = 0;
    private final Runnable klineWatchdog = new Runnable() {
        @Override
        public void run() {
            long now = android.os.SystemClock.uptimeMillis();
            if (now - lastKlineMessageMs > 30000) {
                connectKlineWebSocket();
                return;
            }
            klineHandler.postDelayed(this, 15000);
        }
    };
    
    // Data storage
    private java.util.List<String> symbolList = new java.util.ArrayList<>();
    private java.util.Map<String, String[]> priceDataMap = new java.util.concurrent.ConcurrentHashMap<>();
    private java.util.Map<String, double[]> rawPriceDataMap = new java.util.concurrent.ConcurrentHashMap<>();
    private int currentIndex = 0;
    private boolean hasPriceAlerts = false;
    
    // Config values
    private float fontSize = 14f;
    private float opacity = 0.85f;
    private boolean showSymbol = true;
    private int itemsPerPage = 1;
    
    // WebSocket
    private okhttp3.WebSocket spotWebSocket;
    private okhttp3.WebSocket futuresWebSocket;
    private okhttp3.OkHttpClient client = new okhttp3.OkHttpClient();
    private com.google.gson.Gson gson = new com.google.gson.Gson();

    // Sound
    private android.media.ToneGenerator toneGenerator;

    // Crossing detection state
    private final java.util.Map<String, Double> lastTickerPriceBySymbol = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<String, Double> lastLiveCloseByKlineKey = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<String, Long> soundLoopTokens = new java.util.concurrent.ConcurrentHashMap<>();

    // Market data provider (Binance vs Hyperliquid)
    private static final String PREFS_NAME = "market_data_prefs";
    private static final String PREF_MARKET_PROVIDER = "market_data_provider";
    private static final String PROVIDER_BINANCE = "binance";
    private static final String PROVIDER_HYPERLIQUID = "hyperliquid";
    private String marketProvider = PROVIDER_BINANCE;
    private MarketDataProvider marketDataProvider = null;

    public static final String ACTION_CONFIG = "UPDATE_CONFIG";
    public static final String ACTION_SET_SYMBOLS = "SET_SYMBOLS";
    public static final String ACTION_START_DATA = "START_DATA"; // Start WS without showing window
    public static final String ACTION_SHOW_WINDOW = "SHOW_WINDOW";

    public static final String ACTION_HIDE_WINDOW = "HIDE_WINDOW";
    public static final String ACTION_REQUEST_UPDATE = "REQUEST_UPDATE"; // New action for immediate data
    public static final String ACTION_PREVIEW_SOUND = "PREVIEW_SOUND";
    
    public static final String EXTRA_FONT_SIZE = "FONT_SIZE";
    public static final String EXTRA_OPACITY = "OPACITY";
    public static final String EXTRA_SHOW_SYMBOL = "SHOW_SYMBOL";
    public static final String EXTRA_SYMBOL_LIST = "SYMBOL_LIST";
    public static final String EXTRA_ITEMS_PER_PAGE = "ITEMS_PER_PAGE";
    public static final String EXTRA_SOUND_ID = "SOUND_ID";
    public static final String EXTRA_MARKET_PROVIDER = "MARKET_PROVIDER";

    private boolean windowVisible = false;
    private static final String PERF_TAG = "[perf] FloatingWindowService";

    private static class KlineSubscription {
        public final String symbol;
        public final String interval;

        public KlineSubscription(String symbol, String interval) {
            this.symbol = symbol;
            this.interval = interval;
        }

        @Override
        public int hashCode() {
            return (symbol + "_" + interval).hashCode();
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof KlineSubscription)) return false;
            KlineSubscription other = (KlineSubscription) o;
            return symbol.equals(other.symbol) && interval.equals(other.interval);
        }
    }

    private interface MarketDataProvider {
        String name();
        void startTicker(java.util.List<String> symbols);
        void stopTicker();
        void startKlines(java.util.Set<KlineSubscription> subs);
        void stopKlines();
        void requestImmediateUpdate();
        void shutdown();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d(PERF_TAG, "onCreate at " + System.currentTimeMillis());
        startForegroundService();

        // Load last chosen provider (default: Binance)
        marketProvider = readMarketProviderPref();
        
        // Prepare floating view but don't show yet
        floatingView = LayoutInflater.from(this).inflate(R.layout.floating_widget, null);
        container = floatingView.findViewById(R.id.floating_container);
        itemsContainer = floatingView.findViewById(R.id.items_container);

        params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);

        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 0;
        params.y = 100;

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        // DO NOT add view here - wait for SHOW_WINDOW action
        
        // Setup ToneGenerator
        try {
            toneGenerator = new android.media.ToneGenerator(android.media.AudioManager.STREAM_ALARM, 100);
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Setup touch listener for floating view
        setupTouchListener();
    }

    private String normalizeProvider(String v) {
        if (v == null) return PROVIDER_BINANCE;
        String s = v.trim().toLowerCase();
        if (PROVIDER_HYPERLIQUID.equals(s)) return PROVIDER_HYPERLIQUID;
        return PROVIDER_BINANCE;
    }

    private String readMarketProviderPref() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            return normalizeProvider(sp.getString(PREF_MARKET_PROVIDER, PROVIDER_BINANCE));
        } catch (Exception ignored) {
            return PROVIDER_BINANCE;
        }
    }

    private void writeMarketProviderPref(String provider) {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            sp.edit().putString(PREF_MARKET_PROVIDER, provider).apply();
        } catch (Exception ignored) {}
    }

    private void resetMarketDataCaches() {
        try { priceDataMap.clear(); } catch (Exception ignored) {}
        try { rawPriceDataMap.clear(); } catch (Exception ignored) {}
        try { lastTickerPriceBySymbol.clear(); } catch (Exception ignored) {}
        try { lastLiveCloseByKlineKey.clear(); } catch (Exception ignored) {}
        try { candleHistory.clear(); } catch (Exception ignored) {}
        try { lastCandleTime.clear(); } catch (Exception ignored) {}
        try { lastTriggeredAtMs.clear(); } catch (Exception ignored) {}
        try { pendingDelayAlerts.clear(); } catch (Exception ignored) {}
        try { candleDelayCounter.clear(); } catch (Exception ignored) {}
    }

    private MarketDataProvider getMarketDataProvider() {
        if (marketDataProvider != null) return marketDataProvider;
        if (PROVIDER_HYPERLIQUID.equals(marketProvider)) {
            marketDataProvider = new HyperliquidMarketDataProvider();
        } else {
            marketDataProvider = new BinanceMarketDataProvider();
        }
        return marketDataProvider;
    }

    private void applyMarketProvider(String provider) {
        applyMarketProvider(provider, true);
    }

    private void applyMarketProvider(String provider, boolean restartFeeds) {
        String next = normalizeProvider(provider);
        if (next.equals(marketProvider) && marketDataProvider != null) return;
        marketProvider = next;
        writeMarketProviderPref(marketProvider);
        if (marketDataProvider != null) {
            try { marketDataProvider.shutdown(); } catch (Exception ignored) {}
            marketDataProvider = null;
        }
        resetMarketDataCaches();
        if (restartFeeds) {
            // Restart feeds under the new provider if needed
            if (!symbolList.isEmpty() && (windowVisible || hasPriceAlerts)) {
                connectWebSockets();
            }
            connectKlineWebSocket();
        }
    }
    
    private void setupTouchListener() {
        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;
            private long startClickTime;
            private static final long LONG_PRESS_THRESHOLD = 500; // ms

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        startClickTime = System.currentTimeMillis();
                        return true;
                        
                    case MotionEvent.ACTION_UP:
                        long clickDuration = System.currentTimeMillis() - startClickTime;
                        float dx = event.getRawX() - initialTouchX;
                        float dy = event.getRawY() - initialTouchY;
                        if (clickDuration >= LONG_PRESS_THRESHOLD && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                            // Long press -> open app
                            openMainApp();
                        } else if (clickDuration < 200 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                            // Short tap -> next page
                            showNextPage();
                        }
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        if (windowVisible && windowManager != null) {
                            windowManager.updateViewLayout(floatingView, params);
                        }
                        return true;
                }
                return false;
            }
        });
    }
    
    private void openMainApp() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(intent);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        android.util.Log.d(PERF_TAG, "onStartCommand at " + System.currentTimeMillis() +
                " action=" + (intent != null ? intent.getAction() : "null"));
        if (intent == null) return START_STICKY;
        
        String action = intent.getAction();
        String providerExtra = intent.getStringExtra(EXTRA_MARKET_PROVIDER);
        if (providerExtra != null && !providerExtra.isEmpty() && !ACTION_CONFIG.equals(action)) {
            // Apply provider before handling action, but avoid auto-restarting feeds here since
            // some actions (START_DATA/SET_SYMBOLS) mutate the symbol list afterwards.
            applyMarketProvider(providerExtra, false);
        }
        
        // Start data service (WebSocket) without showing window
        if (ACTION_START_DATA.equals(action)) {
            java.util.ArrayList<String> received = intent.getStringArrayListExtra(EXTRA_SYMBOL_LIST);
            if (received != null && !received.isEmpty()) {
                symbolList = received;
                connectWebSockets();
            }
            return START_STICKY;
        }
        
        // Show floating window
        if (ACTION_SHOW_WINDOW.equals(action)) {
            if (!windowVisible && windowManager != null) {
                windowManager.addView(floatingView, params);
                windowVisible = true;
                // Reconnect data feed if it was stopped while hidden
                if (spotWebSocket == null && futuresWebSocket == null) {
                    connectWebSockets();
                }
                applyConfig();
                updateUI();
            }
            return START_STICKY;
        }
        
        // Hide floating window and stop data feed to release CPU
        if (ACTION_HIDE_WINDOW.equals(action)) {
            if (windowVisible && windowManager != null) {
                windowManager.removeView(floatingView);
            }
            windowVisible = false;
            if (!hasPriceAlerts) {
                stopWebSockets();
            }
            return START_STICKY;
        }
        
        if (ACTION_SET_SYMBOLS.equals(action)) {
            java.util.ArrayList<String> received = intent.getStringArrayListExtra(EXTRA_SYMBOL_LIST);
            if (received != null) {
                String currentSymbol = (symbolList.size() > 0 && currentIndex < symbolList.size()) 
                    ? symbolList.get(currentIndex) : null;
                
                symbolList = received;
                currentIndex = 0;
                
                if (currentSymbol != null) {
                    int idx = symbolList.indexOf(currentSymbol);
                    if (idx >= 0) currentIndex = idx;
                }
                if (windowVisible) updateUI();
                connectWebSockets();
            }
            return START_STICKY;
        }

        if (ACTION_CONFIG.equals(action)) {
            String provider = intent.getStringExtra(EXTRA_MARKET_PROVIDER);
            if (provider != null && !provider.isEmpty()) {
                applyMarketProvider(provider, true);
            }
            fontSize = intent.getFloatExtra(EXTRA_FONT_SIZE, 14f);
            opacity = intent.getFloatExtra(EXTRA_OPACITY, 0.85f);
            showSymbol = intent.getBooleanExtra(EXTRA_SHOW_SYMBOL, true);
            itemsPerPage = intent.getIntExtra(EXTRA_ITEMS_PER_PAGE, 1);
            applyConfig();
            if (windowVisible) updateUI();
            return START_STICKY;
        }
        
        // Sync alerts from JS
        if (ACTION_SYNC_ALERTS.equals(action)) {
            String alertsJson = intent.getStringExtra(EXTRA_ALERTS_JSON);
            if (alertsJson != null) {
                syncAlerts(alertsJson);
            }
            return START_STICKY;
        }

        // Request immediate update (replay last data)
        if (ACTION_REQUEST_UPDATE.equals(action)) {
            android.util.Log.d(PERF_TAG, "ACTION_REQUEST_UPDATE at " + System.currentTimeMillis() +
                    " hasListener=" + (tickerListener != null) +
                    " symbolsCount=" + rawPriceDataMap.size());
            try {
                getMarketDataProvider().requestImmediateUpdate();
            } catch (Exception ignored) {}
            if (tickerListener != null && !rawPriceDataMap.isEmpty()) {
                for (java.util.Map.Entry<String, double[]> entry : rawPriceDataMap.entrySet()) {
                    String symbol = entry.getKey();
                    double[] vals = entry.getValue();
                    tickerListener.onTickerUpdate(symbol, vals[0], vals[1]);
                }
            }
            return START_STICKY;
        }

        // Preview Sound
        if (ACTION_PREVIEW_SOUND.equals(action)) {
            int soundId = intent.getIntExtra(EXTRA_SOUND_ID, 1);
            playAlertSoundOnce(soundId); // Play once for preview
            return START_STICKY;
        }
        
        return START_STICKY;
    }
    
    private void connectWebSockets() {
        getMarketDataProvider().startTicker(symbolList);
    }

    private void stopWebSockets() {
        if (marketDataProvider != null) {
            marketDataProvider.stopTicker();
        } else {
            // Backward safety: stop any lingering Binance sockets.
            stopBinanceWebSocketsInternal();
        }
    }

    private void connectBinanceWebSocketsInternal() {
        // Close previous sockets
        if (spotWebSocket != null) { spotWebSocket.cancel(); spotWebSocket = null; }
        if (futuresWebSocket != null) { futuresWebSocket.cancel(); futuresWebSocket = null; }

        if (symbolList.isEmpty()) return;

        java.util.List<String> spot = new java.util.ArrayList<>();
        java.util.List<String> futures = new java.util.ArrayList<>();
        for (String s : symbolList) {
            if (s == null) continue;
            if (s.toUpperCase().endsWith(".P")) futures.add(s);
            else spot.add(s);
        }

        if (!spot.isEmpty()) {
            StringBuilder streams = new StringBuilder();
            for (String s : spot) {
                streams.append(s.toLowerCase()).append("@miniTicker/");
            }
            if (streams.length() > 0) streams.setLength(streams.length() - 1);
            String url = "wss://stream.binance.com:9443/stream?streams=" + streams.toString();

            okhttp3.Request request = new okhttp3.Request.Builder().url(url).build();
            spotWebSocket = client.newWebSocket(request, new okhttp3.WebSocketListener() {
                @Override
                public void onMessage(okhttp3.WebSocket webSocket, String text) {
                    handleMessage(text, false);
                }

                @Override
                public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                    try { Thread.sleep(3000); } catch (InterruptedException ignored) {}
                    connectWebSockets();
                }
            });
        }

        if (!futures.isEmpty()) {
            StringBuilder streams = new StringBuilder();
            for (String s : futures) {
                String base = s.toUpperCase().endsWith(".P") ? s.substring(0, s.length() - 2) : s;
                streams.append(base.toLowerCase()).append("@miniTicker/");
            }
            if (streams.length() > 0) streams.setLength(streams.length() - 1);
            String url = "wss://fstream.binance.com/stream?streams=" + streams.toString();

            okhttp3.Request request = new okhttp3.Request.Builder().url(url).build();
            futuresWebSocket = client.newWebSocket(request, new okhttp3.WebSocketListener() {
                @Override
                public void onMessage(okhttp3.WebSocket webSocket, String text) {
                    handleMessage(text, true);
                }

                @Override
                public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                    try { Thread.sleep(3000); } catch (InterruptedException ignored) {}
                    connectWebSockets();
                }
            });
        }
    }

    private void stopBinanceWebSocketsInternal() {
        try {
            if (spotWebSocket != null) {
                spotWebSocket.close(1000, "hidden");
            }
        } catch (Exception ignored) {}
        try {
            if (futuresWebSocket != null) {
                futuresWebSocket.close(1000, "hidden");
            }
        } catch (Exception ignored) {}
        spotWebSocket = null;
        futuresWebSocket = null;
    }

    private class BinanceMarketDataProvider implements MarketDataProvider {
        private String lastTickerKey = null;
        private String lastKlineKey = null;

        @Override
        public String name() {
            return PROVIDER_BINANCE;
        }

        @Override
        public void startTicker(java.util.List<String> symbols) {
            String key = buildSymbolsKey(symbols);
            boolean shouldReconnect = (spotWebSocket == null && futuresWebSocket == null) || (lastTickerKey == null) || !lastTickerKey.equals(key);
            lastTickerKey = key;
            if (shouldReconnect) {
                connectBinanceWebSocketsInternal();
            }
        }

        @Override
        public void stopTicker() {
            stopBinanceWebSocketsInternal();
        }

        @Override
        public void startKlines(java.util.Set<KlineSubscription> subs) {
            String key = buildKlineSubsKey(subs);
            boolean shouldReconnect = (klineWebSocket == null) || (lastKlineKey == null) || !lastKlineKey.equals(key);
            lastKlineKey = key;
            if (shouldReconnect) {
                startBinanceKlinesInternal(subs);
            }
        }

        @Override
        public void stopKlines() {
            stopBinanceKlineInternal();
        }

        @Override
        public void requestImmediateUpdate() {
            // No-op: ACTION_REQUEST_UPDATE already replays cached values.
        }

        @Override
        public void shutdown() {
            stopTicker();
            stopKlines();
        }

        private String buildSymbolsKey(java.util.List<String> symbols) {
            if (symbols == null || symbols.isEmpty()) return "";
            java.util.List<String> list = new java.util.ArrayList<>(symbols);
            java.util.Collections.sort(list);
            return String.join(",", list);
        }

        private String buildKlineSubsKey(java.util.Set<KlineSubscription> subs) {
            if (subs == null || subs.isEmpty()) return "";
            java.util.List<String> list = new java.util.ArrayList<>();
            for (KlineSubscription s : subs) {
                if (s == null) continue;
                list.add(s.symbol + "@" + s.interval);
            }
            java.util.Collections.sort(list);
            return String.join(",", list);
        }
    }

    private void startBinanceKlinesInternal(java.util.Set<KlineSubscription> subs) {
        if (klineWebSocket != null) {
            try { klineWebSocket.cancel(); } catch (Exception ignored) {}
            klineWebSocket = null;
        }

        java.util.Set<String> streams = new java.util.HashSet<>();
        for (KlineSubscription sub : subs) {
            if (sub == null || sub.symbol == null || sub.interval == null) continue;
            // NOTE: current implementation assumes spot symbols (Binance spot stream). Keep behavior stable.
            String symLower = sub.symbol.toLowerCase();
            streams.add(symLower + "@kline_" + sub.interval);
        }

        if (streams.isEmpty()) return;

        String streamPath = String.join("/", streams);
        String url = "wss://stream.binance.com:9443/stream?streams=" + streamPath;

        okhttp3.Request request = new okhttp3.Request.Builder().url(url).build();
        klineWebSocket = client.newWebSocket(request, new okhttp3.WebSocketListener() {
            @Override
            public void onMessage(okhttp3.WebSocket webSocket, String text) {
                lastKlineMessageMs = android.os.SystemClock.uptimeMillis();
                klineRetryAttempt = 0;
                handleKlineMessage(text);
            }

            @Override
            public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                long delay = (long) Math.min(30000, 5000 * Math.pow(2, Math.min(5, klineRetryAttempt)));
                klineRetryAttempt++;
                klineHandler.postDelayed(() -> connectKlineWebSocket(), delay);
            }
        });

        fetchKlineHistory(streams);
    }

    private class HyperliquidMarketDataProvider implements MarketDataProvider {
        private static final String HL_URL = "https://api.hyperliquid.xyz/info";
        private static final String HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
        private final Object lock = new Object();
        private volatile boolean tickerRunning = false;
        private volatile boolean klineRunning = false;
        private volatile java.util.List<String> symbols = new java.util.ArrayList<>();
        private volatile java.util.Set<KlineSubscription> subs = new java.util.HashSet<>();
        private volatile long serverTimeOffsetMs = 0L;
        private volatile long lastServerTimeSyncUptimeMs = 0L;

        private okhttp3.WebSocket ws = null;
        private volatile boolean wsOpen = false;
        private int wsRetryAttempt = 0;
        private final java.util.Map<String, java.util.List<String>> tickerEmitSymbolsByCoin = new java.util.concurrent.ConcurrentHashMap<>();
        private final java.util.Map<String, java.util.List<String>> candleEmitSymbolsByCoinInterval = new java.util.concurrent.ConcurrentHashMap<>();
        private final java.util.Map<String, Long> lastOpenTimeByCoinInterval = new java.util.concurrent.ConcurrentHashMap<>();
        private final java.util.Map<String, Double> lastCloseByCoinInterval = new java.util.concurrent.ConcurrentHashMap<>();
        private final java.util.Set<String> backfillInFlight = java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());
        private String lastTickerKey = null;
        private String lastKlineKey = null;

        @Override
        public String name() {
            return PROVIDER_HYPERLIQUID;
        }

        @Override
        public void startTicker(java.util.List<String> symbols) {
            synchronized (lock) {
                this.symbols = symbols != null ? new java.util.ArrayList<>(symbols) : new java.util.ArrayList<>();
                tickerRunning = true;
                String key = buildSymbolsKey(this.symbols);
                boolean changed = lastTickerKey == null || !lastTickerKey.equals(key);
                lastTickerKey = key;
                if (changed) {
                    restartWebSocket();
                } else {
                    ensureWebSocket();
                }
            }
        }

        @Override
        public void stopTicker() {
            synchronized (lock) {
                tickerRunning = false;
                if (!klineRunning) {
                    closeWebSocket("stopTicker");
                } else {
                    restartWebSocket();
                }
            }
        }

        @Override
        public void startKlines(java.util.Set<KlineSubscription> subs) {
            synchronized (lock) {
                this.subs = subs != null ? new java.util.HashSet<>(subs) : new java.util.HashSet<>();
                klineRunning = true;
                String key = buildKlineSubsKey(this.subs);
                boolean changed = lastKlineKey == null || !lastKlineKey.equals(key);
                lastKlineKey = key;
                if (changed) {
                    restartWebSocket();
                } else {
                    ensureWebSocket();
                }
                // Best-effort: seed history so indicator/drawing logic has enough window.
                new Thread(() -> {
                    try {
                        for (KlineSubscription s : this.subs) {
                            if (!klineRunning) break;
                            ensureHistoryInitialized(s);
                        }
                    } catch (Exception ignored) {}
                }, "HL-SeedHistory").start();
            }
        }

        @Override
        public void stopKlines() {
            synchronized (lock) {
                klineRunning = false;
                if (!tickerRunning) {
                    closeWebSocket("stopKlines");
                } else {
                    restartWebSocket();
                }
            }
        }

        @Override
        public void requestImmediateUpdate() {
            ensureWebSocket();
            // Best-effort: backfill last couple of minutes after resume to avoid missing candle close.
            if (klineRunning) {
                java.util.Set<KlineSubscription> local = this.subs;
                new Thread(() -> {
                    try {
                        for (KlineSubscription s : local) {
                            if (!klineRunning) break;
                            backfillRecentCandles(s);
                        }
                    } catch (Exception ignored) {}
                }, "HL-ImmediateBackfill").start();
            }
        }

        @Override
        public void shutdown() {
            stopTicker();
            stopKlines();
        }

        private void ensureWebSocket() {
            synchronized (lock) {
                if (!tickerRunning && !klineRunning) return;
                if (ws != null && wsOpen) return;
                restartWebSocket();
            }
        }

        private void restartWebSocket() {
            closeWebSocket("restart");
            buildEmitMaps();
            okhttp3.Request request = new okhttp3.Request.Builder().url(HL_WS_URL).build();
            ws = client.newWebSocket(request, new okhttp3.WebSocketListener() {
                @Override
                public void onOpen(okhttp3.WebSocket webSocket, okhttp3.Response response) {
                    wsOpen = true;
                    wsRetryAttempt = 0;
                    try { syncServerTimeIfNeeded(true); } catch (Exception ignored) {}
                    sendSubscriptions();
                    // Seed history/backfill without blocking WS callbacks
                    if (klineRunning) {
                        new Thread(() -> {
                            try {
                                for (KlineSubscription s : HyperliquidMarketDataProvider.this.subs) {
                                    if (!klineRunning) break;
                                    ensureHistoryInitialized(s);
                                }
                                for (KlineSubscription s : HyperliquidMarketDataProvider.this.subs) {
                                    if (!klineRunning) break;
                                    backfillRecentCandles(s);
                                }
                            } catch (Exception ignored) {}
                        }, "HL-OnOpenBackfill").start();
                    }
                }

                @Override
                public void onMessage(okhttp3.WebSocket webSocket, String text) {
                    try {
                        com.google.gson.JsonObject msg = com.google.gson.JsonParser.parseString(text).getAsJsonObject();
                        if (!msg.has("channel")) return;
                        String channel = msg.get("channel").getAsString();
                        if ("subscriptionResponse".equals(channel)) return;
                        if (!msg.has("data")) return;
                        com.google.gson.JsonElement dataEl = msg.get("data");
                        if ("candle".equals(channel) && dataEl.isJsonObject()) {
                            handleCandleWs(dataEl.getAsJsonObject());
                        } else if ("ticker".equals(channel)) {
                            if (dataEl.isJsonObject()) {
                                handleTickerWs(dataEl.getAsJsonObject());
                            } else if (dataEl.isJsonArray()) {
                                com.google.gson.JsonArray arr = dataEl.getAsJsonArray();
                                for (int i = 0; i < arr.size(); i++) {
                                    com.google.gson.JsonElement el = arr.get(i);
                                    if (el != null && el.isJsonObject()) handleTickerWs(el.getAsJsonObject());
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                }

                @Override
                public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                    wsOpen = false;
                    scheduleReconnect();
                }

                @Override
                public void onClosed(okhttp3.WebSocket webSocket, int code, String reason) {
                    wsOpen = false;
                    if (tickerRunning || klineRunning) scheduleReconnect();
                }
            });
        }

        private void scheduleReconnect() {
            if (!tickerRunning && !klineRunning) return;
            long delay = (long) Math.min(30000, 1000 * Math.pow(2, Math.min(6, wsRetryAttempt)));
            wsRetryAttempt++;
            mainHandler.postDelayed(() -> {
                if (!tickerRunning && !klineRunning) return;
                restartWebSocket();
            }, delay);
        }

        private void closeWebSocket(String reason) {
            try {
                if (ws != null) {
                    ws.close(1000, reason);
                }
            } catch (Exception ignored) {}
            ws = null;
            wsOpen = false;
        }

        private void buildEmitMaps() {
            tickerEmitSymbolsByCoin.clear();
            candleEmitSymbolsByCoinInterval.clear();

            if (tickerRunning) {
                for (String sym : symbols) {
                    String coin = mapToHlCoin(sym);
                    if (coin == null) continue;
                    java.util.List<String> list = tickerEmitSymbolsByCoin.get(coin);
                    if (list == null) list = new java.util.ArrayList<>();
                    list.add(sym);
                    tickerEmitSymbolsByCoin.put(coin, list);
                }
            }
            if (klineRunning) {
                for (KlineSubscription sub : subs) {
                    if (sub == null || sub.symbol == null || sub.interval == null) continue;
                    String coin = mapToHlCoin(sub.symbol);
                    if (coin == null) continue;
                    String key = coin + "_" + sub.interval;
                    java.util.List<String> list = candleEmitSymbolsByCoinInterval.get(key);
                    if (list == null) list = new java.util.ArrayList<>();
                    list.add(sub.symbol);
                    candleEmitSymbolsByCoinInterval.put(key, list);
                }
            }
        }

        private void sendSubscriptions() {
            if (ws == null) return;
            try {
                if (tickerRunning) {
                    for (String coin : tickerEmitSymbolsByCoin.keySet()) {
                        String payload = "{\"method\":\"subscribe\",\"subscription\":{\"type\":\"ticker\",\"coin\":\"" + coin + "\"}}";
                        ws.send(payload);
                    }
                }
                if (klineRunning) {
                    for (String key : candleEmitSymbolsByCoinInterval.keySet()) {
                        String[] parts = key.split("_", 2);
                        if (parts.length != 2) continue;
                        String coin = parts[0];
                        String interval = parts[1];
                        String payload = "{\"method\":\"subscribe\",\"subscription\":{\"type\":\"candle\",\"coin\":\"" + coin + "\",\"interval\":\"" + interval + "\"}}";
                        ws.send(payload);
                    }
                }
            } catch (Exception ignored) {}
        }

        private void syncServerTimeIfNeeded(boolean force) throws Exception {
            long nowUptime = android.os.SystemClock.uptimeMillis();
            if (!force && nowUptime - lastServerTimeSyncUptimeMs < 15_000) return;
            lastServerTimeSyncUptimeMs = nowUptime;
            long serverTime = fetchExchangeStatusTimeMs();
            if (serverTime > 0) {
                serverTimeOffsetMs = serverTime - System.currentTimeMillis();
            }
        }

        private long serverNowMs() {
            return System.currentTimeMillis() + serverTimeOffsetMs;
        }

        private String mapToHlCoin(String symbol) {
            if (symbol == null) return null;
            String s = symbol.trim().toUpperCase();
            if (s.endsWith(".P")) s = s.substring(0, s.length() - 2);
            if (s.endsWith("USDT")) s = s.substring(0, s.length() - 4);
            if (s.endsWith("USD")) s = s.substring(0, s.length() - 3);
            return s;
        }

        private long intervalToMs(String interval) {
            if (interval == null || interval.isEmpty()) return 60_000L;
            String s = interval.trim().toLowerCase();
            long mult;
            if (s.endsWith("m")) mult = 60_000L;
            else if (s.endsWith("h")) mult = 3_600_000L;
            else if (s.endsWith("d")) mult = 86_400_000L;
            else if (s.endsWith("w")) mult = 7L * 86_400_000L;
            else return 60_000L;
            try {
                long n = Long.parseLong(s.substring(0, s.length() - 1));
                return Math.max(1, n) * mult;
            } catch (Exception ignored) {
                return 60_000L;
            }
        }

        private okhttp3.Request buildPost(String jsonBody) {
            okhttp3.MediaType mt = okhttp3.MediaType.parse("application/json; charset=utf-8");
            okhttp3.RequestBody body = okhttp3.RequestBody.create(jsonBody, mt);
            return new okhttp3.Request.Builder().url(HL_URL).post(body).build();
        }

        private long fetchExchangeStatusTimeMs() throws Exception {
            String payload = "{\"type\":\"exchangeStatus\"}";
            okhttp3.Request request = buildPost(payload);
            try (okhttp3.Response resp = client.newCall(request).execute()) {
                if (!resp.isSuccessful()) return 0L;
                String text = resp.body() != null ? resp.body().string() : "";
                com.google.gson.JsonObject obj = com.google.gson.JsonParser.parseString(text).getAsJsonObject();
                if (obj.has("time")) return obj.get("time").getAsLong();
                return 0L;
            }
        }

        private void handleTickerWs(com.google.gson.JsonObject data) {
            // Try common field names.
            String coin = null;
            if (data.has("coin")) coin = data.get("coin").getAsString();
            else if (data.has("s")) coin = data.get("s").getAsString();
            if (coin == null) return;

            double price = Double.NaN;
            if (data.has("midPx")) price = parseDoubleSafe(data.get("midPx"));
            if (Double.isNaN(price) && data.has("markPx")) price = parseDoubleSafe(data.get("markPx"));
            if (Double.isNaN(price) && data.has("price")) price = parseDoubleSafe(data.get("price"));
            if (Double.isNaN(price) && data.has("px")) price = parseDoubleSafe(data.get("px"));
            if (Double.isNaN(price) || price <= 0) return;

            double changePercent = Double.NaN;
            if (data.has("prevDayPx")) {
                double prev = parseDoubleSafe(data.get("prevDayPx"));
                if (!Double.isNaN(prev) && prev > 0) changePercent = ((price - prev) / prev) * 100.0;
            } else if (data.has("dayOpen")) {
                double open = parseDoubleSafe(data.get("dayOpen"));
                if (!Double.isNaN(open) && open > 0) changePercent = ((price - open) / open) * 100.0;
            }
            if (Double.isNaN(changePercent)) changePercent = 0.0;

            java.util.List<String> emit = tickerEmitSymbolsByCoin.get(coin);
            if (emit == null) return;
            for (String sym : emit) {
                handleTickerEvent(sym, price, changePercent);
            }
        }

        private void handleCandleWs(com.google.gson.JsonObject data) {
            if (!data.has("s") || !data.has("i") || !data.has("t")) return;
            String coin = data.get("s").getAsString();
            String interval = data.get("i").getAsString();
            long openTime = data.get("t").getAsLong();
            double close = data.has("c") ? parseDoubleSafe(data.get("c")) : Double.NaN;
            if (Double.isNaN(close)) return;

            String key = coin + "_" + interval;
            java.util.List<String> emit = candleEmitSymbolsByCoinInterval.get(key);
            if (emit == null || emit.isEmpty()) return;

            long intervalMs = intervalToMs(interval);
            Long lastOpen = lastOpenTimeByCoinInterval.get(key);
            Double lastClose = lastCloseByCoinInterval.get(key);

            if (lastOpen != null && openTime > lastOpen) {
                // If we skipped more than one candle, backfill the gap.
                if (openTime - lastOpen > intervalMs * 2L) {
                    backfillGapCandles(coin, interval, lastOpen, openTime);
                } else if (lastClose != null && !Double.isNaN(lastClose)) {
                    // Finalize previous candle close at boundary.
                    for (String sym : emit) {
                        handleKlineEvent(sym, interval, lastClose, true, lastOpen);
                    }
                }
            }

            lastOpenTimeByCoinInterval.put(key, openTime);
            lastCloseByCoinInterval.put(key, close);
            // Live update for current candle (not closed).
            for (String sym : emit) {
                handleKlineEvent(sym, interval, close, false, openTime);
            }
        }

        private void backfillGapCandles(String coin, String interval, long lastOpenTime, long newOpenTime) {
            String key = coin + "_" + interval;
            if (!backfillInFlight.add(key)) return;
            new Thread(() -> {
                try {
                    try { syncServerTimeIfNeeded(false); } catch (Exception ignored) {}
                    long start = lastOpenTime + intervalToMs(interval);
                    long end = newOpenTime + 1000L;
                    // We need a representative original symbol to map coin for HTTP snapshot.
                    java.util.List<String> emitSyms = candleEmitSymbolsByCoinInterval.get(key);
                    if (emitSyms == null || emitSyms.isEmpty()) return;
                    String rep = emitSyms.get(0);
                    java.util.List<Candle> candles = fetchCandleSnapshot(rep, interval, start, end);
                    if (candles == null || candles.isEmpty()) return;
                    candles.sort((a, b) -> Long.compare(a.openTimeMs, b.openTimeMs));
                    long now = serverNowMs();
                    for (Candle cd : candles) {
                        if (cd == null) continue;
                        if (cd.openTimeMs <= lastOpenTime) continue;
                        if (cd.openTimeMs >= newOpenTime) break;
                        // only treat as closed if the server time is beyond its close bound
                        if (now >= cd.closeTimeMs) {
                            java.util.List<String> emit = candleEmitSymbolsByCoinInterval.get(key);
                            if (emit == null) break;
                            for (String sym : emit) {
                                handleKlineEvent(sym, interval, cd.close, true, cd.openTimeMs);
                            }
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    backfillInFlight.remove(key);
                }
            }, "HL-BackfillGap").start();
        }

        private void backfillRecentCandles(KlineSubscription sub) {
            try {
                if (sub == null || sub.symbol == null || sub.interval == null) return;
                try { syncServerTimeIfNeeded(false); } catch (Exception ignored) {}
                String coin = mapToHlCoin(sub.symbol);
                if (coin == null) return;
                String key = coin + "_" + sub.interval;
                long intervalMs = intervalToMs(sub.interval);
                Long lastOpen = lastOpenTimeByCoinInterval.get(key);
                long now = serverNowMs();
                long start = (lastOpen != null ? lastOpen : now - intervalMs * 5L) - intervalMs * 2L;
                long end = now + 1000L;
                java.util.List<Candle> candles = fetchCandleSnapshot(sub.symbol, sub.interval, start, end);
                if (candles == null || candles.isEmpty()) return;
                candles.sort((a, b) -> Long.compare(a.openTimeMs, b.openTimeMs));
                for (Candle cd : candles) {
                    if (cd == null) continue;
                    if (now >= cd.closeTimeMs) {
                        handleKlineEvent(sub.symbol, sub.interval, cd.close, true, cd.openTimeMs);
                    }
                }
            } catch (Exception ignored) {}
        }

        private void ensureHistoryInitialized(KlineSubscription sub) {
            String key = sub.symbol + "_" + sub.interval;
            if (candleHistory.containsKey(key) && candleHistory.get(key) != null && !candleHistory.get(key).isEmpty()) return;
            try {
                try { syncServerTimeIfNeeded(false); } catch (Exception ignored) {}
                long intervalMs = intervalToMs(sub.interval);
                long end = serverNowMs();
                long start = end - Math.min(100L * intervalMs * 2L, 7L * 24L * 3600_000L); // cap at 7d to avoid giant pulls
                java.util.List<Candle> candles = fetchCandleSnapshot(sub.symbol, sub.interval, start, end);
                if (candles == null || candles.isEmpty()) return;
                long now = serverNowMs();
                java.util.List<Double> closes = new java.util.ArrayList<>();
                long lastClosedOpen = -1L;
                for (Candle cd : candles) {
                    if (cd == null) continue;
                    if (now >= cd.closeTimeMs) {
                        closes.add(cd.close);
                        lastClosedOpen = cd.openTimeMs;
                    }
                }
                if (!closes.isEmpty()) {
                    if (closes.size() > 100) closes = closes.subList(closes.size() - 100, closes.size());
                    candleHistory.put(key, new java.util.ArrayList<>(closes));
                    if (lastClosedOpen > 0) lastCandleTime.put(key, lastClosedOpen);
                }
            } catch (Exception ignored) {}
        }

        private String buildSymbolsKey(java.util.List<String> symbols) {
            if (symbols == null || symbols.isEmpty()) return "";
            java.util.List<String> list = new java.util.ArrayList<>(symbols);
            java.util.Collections.sort(list);
            return String.join(",", list);
        }

        private String buildKlineSubsKey(java.util.Set<KlineSubscription> subs) {
            if (subs == null || subs.isEmpty()) return "";
            java.util.List<String> list = new java.util.ArrayList<>();
            for (KlineSubscription s : subs) {
                if (s == null) continue;
                list.add(s.symbol + "@" + s.interval);
            }
            java.util.Collections.sort(list);
            return String.join(",", list);
        }

        private java.util.List<Candle> fetchCandleSnapshot(String symbol, String interval, long startTime, long endTime) throws Exception {
            String coin = mapToHlCoin(symbol);
            if (coin == null) return null;
            String payload = "{\"type\":\"candleSnapshot\",\"req\":{\"coin\":\"" + coin + "\",\"interval\":\"" + interval +
                    "\",\"startTime\":" + startTime + ",\"endTime\":" + endTime + "}}";
            okhttp3.Request request = buildPost(payload);
            try (okhttp3.Response resp = client.newCall(request).execute()) {
                if (!resp.isSuccessful()) return null;
                String text = resp.body() != null ? resp.body().string() : "";
                com.google.gson.JsonArray arr = com.google.gson.JsonParser.parseString(text).getAsJsonArray();
                java.util.List<Candle> out = new java.util.ArrayList<>();
                for (int i = 0; i < arr.size(); i++) {
                    com.google.gson.JsonObject o = arr.get(i).getAsJsonObject();
                    Candle c = new Candle();
                    c.openTimeMs = o.get("t").getAsLong();
                    c.closeTimeMs = o.get("T").getAsLong();
                    c.close = parseDoubleSafe(o.get("c"));
                    out.add(c);
                }
                return out;
            }
        }

        private double parseDoubleSafe(com.google.gson.JsonElement el) {
            if (el == null || el.isJsonNull()) return Double.NaN;
            try {
                if (el.isJsonPrimitive()) {
                    com.google.gson.JsonPrimitive p = el.getAsJsonPrimitive();
                    if (p.isNumber()) return p.getAsDouble();
                    if (p.isString()) return Double.parseDouble(p.getAsString());
                }
            } catch (Exception ignored) {}
            return Double.NaN;
        }

        private class Candle {
            long openTimeMs;
            long closeTimeMs;
            double close;
        }
    }
    
    // Static listener for ticker updates (used by Plugin)
    public interface TickerUpdateListener {
        void onTickerUpdate(String symbol, double price, double changePercent);
    }
    
    private static TickerUpdateListener tickerListener;
    
    public static void setTickerListener(TickerUpdateListener listener) {
        tickerListener = listener;
    }
    
    private void handleMessage(String text, boolean isFutures) {
        try {
            com.google.gson.JsonObject json = com.google.gson.JsonParser.parseString(text).getAsJsonObject();
            if (json.has("data")) {
                com.google.gson.JsonObject data = json.getAsJsonObject("data");
                String symbolRaw = data.get("s").getAsString();
                String symbol = isFutures ? symbolRaw + ".P" : symbolRaw;
                String close = data.get("c").getAsString();
                
                // Calculate change percent
                double closePrice = Double.parseDouble(close);
                double openPrice = Double.parseDouble(data.get("o").getAsString());
                double changePercent = ((closePrice - openPrice) / openPrice) * 100;
                handleTickerEvent(symbol, closePrice, changePercent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void handleTickerEvent(String symbol, double closePrice, double changePercent) {
        priceDataMap.put(symbol, new String[]{
                formatPrice(closePrice),
                String.format(java.util.Locale.US, "%.2f", changePercent)
        });

        // Store raw data for replay
        rawPriceDataMap.put(symbol, new double[]{closePrice, changePercent});

        // Notify static listener (Plugin) about ticker update
        if (tickerListener != null) {
            tickerListener.onTickerUpdate(symbol, closePrice, changePercent);
        }

        // Check simple price alerts
        Double prev = lastTickerPriceBySymbol.put(symbol, closePrice);
        double prevPrice = prev != null ? prev : Double.NaN;
        checkPriceAlerts(symbol, closePrice, prevPrice);

        // Update UI on main thread
        if (windowVisible) {
            mainHandler.post(() -> {
                // Throttle redraws to avoid hammering UI/main thread when prices tick fast.
                long now = android.os.SystemClock.uptimeMillis();
                if (now - lastUiUpdateMs < UI_UPDATE_THROTTLE_MS) return;
                lastUiUpdateMs = now;
                if (isSymbolVisible(symbol)) {
                    updateUI();
                }
            });
        }
    }
    
    // Smart formatting to satisfy "0.01% of price" precision
    private String formatPrice(double price) {
        if (price == 0) return "0.00";
        if (price >= 1000) return String.format(java.util.Locale.US, "%.2f", price);
        if (price >= 1) return String.format(java.util.Locale.US, "%.4f", price);
        if (price >= 0.0001) return String.format(java.util.Locale.US, "%.6f", price).replaceAll("0*$", "").replaceAll("\\.$", "");
        return String.format(java.util.Locale.US, "%.8f", price).replaceAll("0*$", "").replaceAll("\\.$", "");
    }
    
    private boolean isSymbolVisible(String symbol) {
        if (symbolList.isEmpty()) return false;
        for (int i = 0; i < itemsPerPage; i++) {
            int idx = (currentIndex + i) % symbolList.size();
            if (symbol.equals(symbolList.get(idx))) {
                return true;
            }
        }
        return false;
    }
    
    private void showNextPage() {
        if (symbolList.isEmpty()) return;
        currentIndex = (currentIndex + itemsPerPage) % symbolList.size();
        updateUI();
    }

    private void stopBinanceKlineInternal() {
        if (klineWebSocket != null) {
            try { klineWebSocket.cancel(); } catch (Exception ignored) {}
            klineWebSocket = null;
        }
        klineHandler.removeCallbacks(klineWatchdog);
    }
    
    private void updateUI() {
        if (!windowVisible || itemsContainer == null) return;
        itemsContainer.removeAllViews();
        
        if (symbolList.isEmpty()) {
            addLoadingView();
            return;
        }

        for (int i = 0; i < itemsPerPage; i++) {
            int idx = (currentIndex + i) % symbolList.size();
            String symbol = symbolList.get(idx);
            String[] data = priceDataMap.get(symbol);
            addTickerView(symbol, data);
            
            if (i >= symbolList.size() - 1) break; 
        }
    }
    
    private void addLoadingView() {
        TextView tv = new TextView(this);
        tv.setText("Waiting...");
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize);
        itemsContainer.addView(tv);
    }

    private void addTickerView(String symbol, String[] data) {
        String price = (data != null) ? data[0] : "--";
        String change = (data != null) ? data[1] : null;

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, 0, 0, 10);

        TextView priceTv = new TextView(this);
        String displayText = showSymbol ? 
            (symbol != null ? symbol + ": $" : "$") + (price != null ? price : "--") :
            "$" + (price != null ? price : "--");
        priceTv.setText(displayText);
        priceTv.setTextColor(Color.WHITE);
        priceTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize);
        priceTv.setTypeface(null, android.graphics.Typeface.BOLD);
        row.addView(priceTv);

        TextView changeTv = new TextView(this);
        if (change == null) {
            changeTv.setText("--%");
            changeTv.setTextColor(Color.WHITE);
        } else {
            try {
                // Change is already formatted as string, but we need double for color
                 // But wait, "data[1]" in map is now "1.23".
                 // In previous code it was string.
                 // Let's parse it safely.
                 // Wait, formatPrice might return string like "1.23".
                 
                 // In handleMessage: String.format("%.2f", changePercent) -> "1.23"
                 
                double changeVal = Double.parseDouble(change); // "1.23" -> 1.23
                changeTv.setText(change + "%"); // "1.23%"
                int color = changeVal < 0 ? 0xFFFF4444 : 0xFF00CC88;
                changeTv.setTextColor(color);
                
            } catch (NumberFormatException e) {
                changeTv.setText("--%");
                changeTv.setTextColor(Color.WHITE);
            }
        }
        changeTv.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize - 2);
        row.addView(changeTv);

        itemsContainer.addView(row);
    }
    
    private void applyConfig() {
        if (container != null) {
            int alpha = (int) (opacity * 255);
            int bgColor = Color.argb(alpha, 0, 0, 0);
            container.setBackgroundColor(bgColor);
        }
        if (windowManager != null && floatingView != null && params != null && windowVisible) {
            try {
                windowManager.updateViewLayout(floatingView, params);
            } catch (Exception e) {
                // View may not be attached
            }
        }
    }

    // ============================================
    // K-LINE WEBSOCKET & ALERT SYSTEM
    // ============================================
    
    public static final String ACTION_SYNC_ALERTS = "SYNC_ALERTS";
    public static final String EXTRA_ALERTS_JSON = "ALERTS_JSON";
    
    private okhttp3.WebSocket klineWebSocket;
    private java.util.List<AlertConfig> alerts = new java.util.ArrayList<>();
    private java.util.Map<String, java.util.List<Double>> candleHistory = new java.util.concurrent.ConcurrentHashMap<>();
    private java.util.Map<String, Long> lastCandleTime = new java.util.concurrent.ConcurrentHashMap<>();
    private java.util.Set<String> triggeredAlerts = java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());
    private java.util.Map<String, Long> lastTriggeredAtMs = new java.util.concurrent.ConcurrentHashMap<>();
    // Map to track start time of delayed alerts: <AlertID, StartTimestampMS>
    private java.util.Map<String, Long> pendingDelayAlerts = new java.util.concurrent.ConcurrentHashMap<>();
    // Map to track consecutive candle hits: <AlertID, Count>
    private java.util.Map<String, Integer> candleDelayCounter = new java.util.concurrent.ConcurrentHashMap<>();
    
    private android.os.PowerManager.WakeLock wakeLock;

    // Alert configuration class
    public static class AlertConfig {
        public String id;
        public String symbol;
        public String targetType;
        public double target;
        public String targetValue;
        public String condition;
        public java.util.List<String> conditions;
        public String confirmation;
        public String interval;
        public int delaySeconds; // Field for time delay
        public int delayCandles; // Field for K-line delay
        public int soundId; // 0-9 for MIDI-like tones, Default 1
        public String soundRepeat; // "once" | "loop"
        public int soundDuration; // Max duration in seconds
        public int loopPause; // Pause in seconds
        public String repeatMode; // "once" | "repeat"
        public int repeatIntervalSec; // Repeat interval in seconds (for repeat mode)

        public static class Actions {
            public boolean toast = true;
            public boolean notification = true;
            public String vibration = "once"; // "none" | "once" | "continuous"
        }

        public Actions actions;
        
        public String algo;
        public java.util.Map<String, Object> params;
        
        // --- Cache Fields (Optimized for Hot Loop) ---
        public String cachedIndType; // "sma", "rsi"
        public int cachedPeriod;
        public double cachedT0;
        public double cachedP0;
        public double cachedSlope;
        public double cachedP_High;
        public double cachedP_Low;
        public double cachedT_Start;
        public double cachedT_End;
        public java.util.List<Double> cachedOffsets;
        // ---------------------------------------------
        
        public boolean active;
    }

    private boolean hasCondition(AlertConfig alert, String cond) {
        if (alert.conditions != null && !alert.conditions.isEmpty()) {
            return alert.conditions.contains(cond);
        }
        if (alert.condition != null && !alert.condition.isEmpty()) {
            return alert.condition.equals(cond);
        }
        return "crossing_up".equals(cond);
    }
    
    public void syncAlerts(String alertsJson) {
        try {
            com.google.gson.reflect.TypeToken<java.util.List<AlertConfig>> typeToken = 
                new com.google.gson.reflect.TypeToken<java.util.List<AlertConfig>>() {};
            alerts = gson.fromJson(alertsJson, typeToken.getType());
            hasPriceAlerts = false;
            
            // PRE-PARSE / CACHE PARAMETERS to avoid Map lookup in hot loop
            for (AlertConfig a : alerts) {
                try {
                    if (a.confirmation == null || a.confirmation.isEmpty()) a.confirmation = "immediate";
                    if (a.repeatMode == null || a.repeatMode.isEmpty()) a.repeatMode = "once";
                    if (a.repeatIntervalSec < 0) a.repeatIntervalSec = 0;
                    if (a.actions == null) a.actions = new AlertConfig.Actions();
                    if (a.actions.vibration == null || a.actions.vibration.isEmpty()) a.actions.vibration = "once";
                    if (a.active && "price".equals(a.targetType)) hasPriceAlerts = true;

                    // Cache Indicator Params
                    if ("indicator".equals(a.targetType) && a.targetValue != null) {
                        a.cachedIndType = a.targetValue.replaceAll("[0-9]", "").toLowerCase();
                         try {
                            a.cachedPeriod = Integer.parseInt(a.targetValue.replaceAll("[a-zA-Z]", ""));
                        } catch (Exception e) { a.cachedPeriod = 14; }
                    }
                    
                    // Cache Drawing Params
                    if (a.params != null) {
                         java.util.Map<String, Object> p = a.params;
                         if (p.containsKey("t0")) a.cachedT0 = ((Number)p.get("t0")).doubleValue();
                         if (p.containsKey("p0")) a.cachedP0 = ((Number)p.get("p0")).doubleValue();
                         if (p.containsKey("slope")) a.cachedSlope = ((Number)p.get("slope")).doubleValue();
                         if (p.containsKey("pHigh")) a.cachedP_High = ((Number)p.get("pHigh")).doubleValue();
                         if (p.containsKey("pLow")) a.cachedP_Low = ((Number)p.get("pLow")).doubleValue();
                         if (p.containsKey("tStart")) a.cachedT_Start = ((Number)p.get("tStart")).doubleValue();
                         if (p.containsKey("tEnd")) a.cachedT_End = ((Number)p.get("tEnd")).doubleValue();
                         
                         if (p.containsKey("offsets")) {
                              a.cachedOffsets = new java.util.ArrayList<>();
                              Object offsetsObj = p.get("offsets");
                              if (offsetsObj instanceof java.util.List) {
                                  for (Object o : (java.util.List)offsetsObj) {
                                      if (o instanceof Number) a.cachedOffsets.add(((Number)o).doubleValue());
                                  }
                              }
                         }
                    }
                } catch (Exception e) { e.printStackTrace(); }
            }

            // Prune state for removed alerts (keep "once" triggers + repeat cooldown across syncs)
            java.util.Set<String> ids = new java.util.HashSet<>();
            for (AlertConfig a : alerts) { if (a != null && a.id != null) ids.add(a.id); }
            triggeredAlerts.retainAll(ids);
            for (String k : new java.util.HashSet<>(lastTriggeredAtMs.keySet())) {
                if (!ids.contains(k)) lastTriggeredAtMs.remove(k);
            }
            for (String k : new java.util.HashSet<>(pendingDelayAlerts.keySet())) {
                if (!ids.contains(k)) pendingDelayAlerts.remove(k);
            }
            for (String k : new java.util.HashSet<>(candleDelayCounter.keySet())) {
                if (!ids.contains(k)) candleDelayCounter.remove(k);
            }
            
            // Keep ticker WS alive for price alerts even when window hidden
            if (hasPriceAlerts && !symbolList.isEmpty()) {
                connectWebSockets();
            }
            
            // Connect to K-line streams if needed
            connectKlineWebSocket();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    
    private void connectKlineWebSocket() {
        // Collect all needed kline subscriptions from alerts
        java.util.Set<KlineSubscription> subs = new java.util.HashSet<>();
        for (AlertConfig alert : alerts) {
            if (alert.active && (alert.targetType.equals("indicator") || alert.targetType.equals("drawing") || "candle_close".equals(alert.confirmation))) {
                String interval = alert.interval != null ? alert.interval : "1m";
                subs.add(new KlineSubscription(alert.symbol, interval));
            }
        }
        
        if (subs.isEmpty()) {
            // Release WakeLock if no active alerts
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            klineHandler.removeCallbacks(klineWatchdog);
            if (marketDataProvider != null) {
                try { marketDataProvider.stopKlines(); } catch (Exception ignored) {}
            } else {
                stopBinanceKlineInternal();
            }
            return;
        }
        lastKlineMessageMs = android.os.SystemClock.uptimeMillis();
        klineHandler.removeCallbacks(klineWatchdog);
        klineHandler.postDelayed(klineWatchdog, 15000);
        
        // Smart WakeLock: Only acquire if we have ACTUAL ALERTS monitoring.
        // If we are just streaming for the UI (activeAlertsCount == 0), we DO NOT hold the lock.
        // This lets the phone sleep when screen is off, saving battery.
        boolean hasActiveAlerts = false;
        for (AlertConfig a : alerts) { if(a.active) { hasActiveAlerts = true; break; } }
        
        if (hasActiveAlerts) {
            if (wakeLock == null) {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "AmazeMonitor::AlertService");
            }
            if (!wakeLock.isHeld()) {
                wakeLock.acquire();
            }
        } else {
             if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }
        getMarketDataProvider().startKlines(subs);
    }
    
    private void fetchKlineHistory(java.util.Set<String> streams) {
        for (String stream : streams) {
            // stream format: btcusdt@kline_1m
            String[] parts = stream.split("@kline_");
            if (parts.length != 2) continue;
            String symbol = parts[0].toUpperCase();
            String interval = parts[1];
            String key = symbol + "_" + interval;
            
            new Thread(() -> {
                try {
                    String urlStr = "https://api.binance.com/api/v3/klines?symbol=" + symbol + "&interval=" + interval + "&limit=100";
                    java.net.URL url = new java.net.URL(urlStr);
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(url.openStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                    reader.close();
                    
                    com.google.gson.JsonArray arr = com.google.gson.JsonParser.parseString(sb.toString()).getAsJsonArray();
                    java.util.List<Double> closes = new java.util.ArrayList<>();
                    for (int i = 0; i < arr.size(); i++) {
                        closes.add(arr.get(i).getAsJsonArray().get(4).getAsDouble()); // Close price
                    }
                    candleHistory.put(key, closes);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }).start();
        }
    }
    
    private void handleKlineMessage(String text) {
        try {
            com.google.gson.JsonObject json = com.google.gson.JsonParser.parseString(text).getAsJsonObject();
            if (!json.has("data")) return;
            
            com.google.gson.JsonObject data = json.getAsJsonObject("data");
            if (!data.has("e") || !data.get("e").getAsString().equals("kline")) return;
            
            String symbol = data.get("s").getAsString();
            com.google.gson.JsonObject k = data.getAsJsonObject("k");
            String interval = k.get("i").getAsString();
            double close = k.get("c").getAsDouble();
            boolean isClosed = k.get("x").getAsBoolean();
            long openTime = k.get("t").getAsLong();
            handleKlineEvent(symbol, interval, close, isClosed, openTime);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void handleKlineEvent(String symbol, String interval, double close, boolean isClosed, long openTime) {
        lastKlineMessageMs = android.os.SystemClock.uptimeMillis();
        String key = symbol + "_" + interval;
        Double prevLiveClose = lastLiveCloseByKlineKey.get(key);

        // Update candle history
        java.util.List<Double> history = candleHistory.get(key);
        if (history == null) {
            history = new java.util.ArrayList<>();
            candleHistory.put(key, history);
        }

        Long lastTime = lastCandleTime.get(key);
        if (isClosed && (lastTime == null || lastTime != openTime)) {
            history.add(close);
            if (history.size() > 100) history.remove(0);
            lastCandleTime.put(key, openTime);

            // Update live-close cache
            lastLiveCloseByKlineKey.put(key, close);

            // Check alerts on candle close
            checkAlertsForKline(symbol, interval, close, history, true, prevLiveClose != null ? prevLiveClose : Double.NaN);
        } else if (!isClosed) {
            // Update live-close cache
            lastLiveCloseByKlineKey.put(key, close);
            // Live update for immediate alerts
            checkAlertsForKline(symbol, interval, close, history, false, prevLiveClose != null ? prevLiveClose : Double.NaN);
        }
    }
    
    private static boolean crossedUp(double prev, double curr, double target) {
        return prev < target && curr >= target;
    }

    private static boolean crossedDown(double prev, double curr, double target) {
        return prev > target && curr <= target;
    }

    private boolean isRepeatEnabled(AlertConfig alert) {
        return alert != null && "repeat".equals(alert.repeatMode) && alert.repeatIntervalSec > 0;
    }

    private void checkAlertsForKline(String symbol, String interval, double close, java.util.List<Double> history, boolean isClosed, double prevLiveClose) {
        for (AlertConfig alert : alerts) {
            if (!alert.active || !alert.symbol.equals(symbol)) continue;
            if (!isRepeatEnabled(alert) && triggeredAlerts.contains(alert.id)) continue;
            if (alert.confirmation == null || alert.confirmation.isEmpty()) alert.confirmation = "immediate";
            
            String alertInterval = alert.interval != null ? alert.interval : "1m";
            if (!alertInterval.equals(interval)) continue;
            
            // Determine target(s)
            java.util.List<Double> potentialTargets = new java.util.ArrayList<>();
            
            if (alert.targetType.equals("indicator")) {
                double val = Double.NaN;
                if (alert.targetValue != null && alert.targetValue.startsWith("fib")) {
                    val = calculateFibLevel(alert.targetValue);
                } else {
                    val = calculateIndicator(alert, history); // Pass 'alert' object instead of 'alert.targetValue'
                }
                if (!Double.isNaN(val)) potentialTargets.add(val);
            } else if (alert.targetType.equals("drawing") && alert.algo != null) {
                // Dynamic drawing calculation
                String key = symbol + "_" + interval;
                Long t = lastCandleTime.get(key);
                long calcTime = (isClosed && t != null) ? t : System.currentTimeMillis();
                potentialTargets = calculateDrawingTargets(alert, calcTime);
            } else {
                potentialTargets.add(alert.target);
            }
            
            if (potentialTargets.isEmpty()) continue;
            
            // Check confirmation mode
            if (alert.confirmation.equals("candle_close") && !isClosed) continue;

            // Determine previous price for crossing detection
            double prevClose = Double.NaN;
            if (isClosed) {
                // history already includes current close
                if (history != null && history.size() >= 2) {
                    prevClose = history.get(history.size() - 2);
                }
            } else {
                if (!Double.isNaN(prevLiveClose)) {
                    prevClose = prevLiveClose;
                } else if (history != null && !history.isEmpty()) {
                    // fallback: last closed candle close
                    prevClose = history.get(history.size() - 1);
                }
            }
            if (Double.isNaN(prevClose)) continue;
            
            // Check condition against ALL potential targets (e.g. channel lines)
            final boolean allowUp = hasCondition(alert, "crossing_up");
            final boolean allowDown = hasCondition(alert, "crossing_down");
            boolean crossingMet = false;
            boolean beyondMet = false; // price stays beyond target (for delay modes)
            double triggerTarget = 0;

            if ("rect_zone".equals(alert.algo) && potentialTargets.size() >= 2) {
                double high = java.util.Collections.max(potentialTargets);
                double low = java.util.Collections.min(potentialTargets);
                if (allowUp && crossedUp(prevClose, close, high)) {
                    crossingMet = true;
                    triggerTarget = high;
                } else if (allowUp && close >= high) {
                    beyondMet = true;
                    triggerTarget = high;
                } else if (allowDown && crossedDown(prevClose, close, low)) {
                    crossingMet = true;
                    triggerTarget = low;
                } else if (allowDown && close <= low) {
                    beyondMet = true;
                    triggerTarget = low;
                }
            } else {
                for (double tVal : potentialTargets) {
                    boolean crossUp = allowUp && crossedUp(prevClose, close, tVal);
                    boolean crossDown = allowDown && crossedDown(prevClose, close, tVal);
                    boolean beyondUp = allowUp && close >= tVal;
                    boolean beyondDown = allowDown && close <= tVal;
                    if (crossUp || crossDown) {
                        crossingMet = true;
                        triggerTarget = tVal;
                        break;
                    }
                    if (beyondUp || beyondDown) {
                        beyondMet = true;
                        triggerTarget = tVal;
                    }
                }
            }
            
            final boolean isCandleDelay = "candle_delay".equals(alert.confirmation) && alert.delayCandles > 0;
            final boolean isTimeDelay = "time_delay".equals(alert.confirmation) && alert.delaySeconds > 0;

            if (isCandleDelay) {
                if (!isClosed) continue; // only evaluate on closed candles
                if (beyondMet || crossingMet) {
                    int count = candleDelayCounter.getOrDefault(alert.id, 0) + 1;
                    if (count >= alert.delayCandles) {
                        triggerAlert(alert, close, triggerTarget);
                        candleDelayCounter.put(alert.id, 0);
                    } else {
                        candleDelayCounter.put(alert.id, count);
                    }
                } else {
                    candleDelayCounter.put(alert.id, 0);
                }
                pendingDelayAlerts.remove(alert.id);
            } else if (isTimeDelay) {
                if (beyondMet || crossingMet) {
                    long now = System.currentTimeMillis();
                    if (!pendingDelayAlerts.containsKey(alert.id)) {
                        pendingDelayAlerts.put(alert.id, now);
                    } else {
                        long startTime = pendingDelayAlerts.get(alert.id);
                        if (now - startTime >= alert.delaySeconds * 1000L) {
                            triggerAlert(alert, close, triggerTarget);
                            pendingDelayAlerts.remove(alert.id);
                        }
                    }
                } else {
                    pendingDelayAlerts.remove(alert.id);
                }
                candleDelayCounter.put(alert.id, 0);
            } else {
                // Immediate / candle_close (already filtered above)
                if (crossingMet) {
                    triggerAlert(alert, close, triggerTarget);
                } else {
                    pendingDelayAlerts.remove(alert.id);
                    if (isClosed) candleDelayCounter.put(alert.id, 0);
                }
            }
        }
    }
    
    private java.util.List<Double> calculateDrawingTargets(AlertConfig alert, long timestampMs) {
        java.util.List<Double> results = new java.util.ArrayList<>();
        // Removed params null check because we use cached fields (initialized to 0, which is fine or managed)
        // But algo check remains
        
        try {
            double t = timestampMs / 1000.0; // Seconds
            
            if ("linear_ray".equals(alert.algo)) {
                 results.add(alert.cachedP0 + alert.cachedSlope * (t - alert.cachedT0));
            } else if (("parallel_channel".equals(alert.algo) || "multi_ray".equals(alert.algo)) && alert.cachedOffsets != null) {
                 double base = alert.cachedP0 + alert.cachedSlope * (t - alert.cachedT0);
                 for (double off : alert.cachedOffsets) {
                     results.add(base + off);
                 }
            }
             // For horizontal lines (algo=price_level), params.price is sufficient, params checks removed for speed
             // Assuming parsed correctly. Price usually in 'target' fallback, but if algo present:
            else if ("price_level".equals(alert.algo) && alert.params != null && alert.params.containsKey("price")) {
                 results.add(((Number)alert.params.get("price")).doubleValue()); // Keep map lookup for simple case or cache 'cachedPrice' todo
            }
            // Rectangle Zone: [High, Low] if time matches
            else if ("rect_zone".equals(alert.algo)) {
                if (t >= alert.cachedT_Start && t <= alert.cachedT_End) {
                    results.add(alert.cachedP_High);
                    results.add(alert.cachedP_Low);
                }
            }
            
        } catch (Exception e) {
            e.printStackTrace();
        }
        return results;
    }
    
    private double calculateIndicator(AlertConfig alert, java.util.List<Double> history) {
        if (history == null || history.isEmpty()) return Double.NaN;
        
        String type = alert.cachedIndType;
        if (type == null) return Double.NaN;
        int period = alert.cachedPeriod;
        
        if (type.equals("sma") || type.equals("ma")) {
            if (history.size() < period) return Double.NaN;
            java.util.List<Double> values = history.subList(history.size() - period, history.size());
            double sum = 0;
            for (double v : values) sum += v;
            return sum / period;
        } else if (type.equals("ema")) {
            if (history.size() < period) return Double.NaN;
            java.util.List<Double> values = history.subList(history.size() - period, history.size());
            double multiplier = 2.0 / (period + 1);
            double ema = values.get(0);
            for (int i = 1; i < values.size(); i++) {
                ema = (values.get(i) - ema) * multiplier + ema;
            }
            return ema;
        } else if (type.equals("rsi")) {
            // RSI calculation requires period + 1 prices for changes
            if (history.size() < period + 1) return Double.NaN;
            
            double avgGain = 0;
            double avgLoss = 0;
            
            // Calculate initial average gain/loss
            for (int i = history.size() - period; i < history.size(); i++) {
                double change = history.get(i) - history.get(i - 1);
                if (change > 0) avgGain += change;
                else avgLoss += Math.abs(change);
            }
            avgGain /= period;
            avgLoss /= period;
            
            if (avgLoss == 0) return 100.0;
            double rs = avgGain / avgLoss;
            return 100.0 - (100.0 / (1.0 + rs));
        }
        
        return Double.NaN;
    }
    
    // Calculate Fibonacci retracement level
    // Format: "fib_高点_低点_比例" e.g. "fib_100000_90000_0.618"
    private double calculateFibLevel(String fibConfig) {
        try {
            String[] parts = fibConfig.split("_");
            if (parts.length < 4) return Double.NaN;
            double high = Double.parseDouble(parts[1]);
            double low = Double.parseDouble(parts[2]);
            double ratio = Double.parseDouble(parts[3]);
            return high - (high - low) * ratio;
        } catch (Exception e) {
            return Double.NaN;
        }
    }
    
    // Also check simple price alerts from ticker data
    public void checkPriceAlerts(String symbol, double price, double prevPrice) {
        if (Double.isNaN(prevPrice)) return;
        for (AlertConfig alert : alerts) {
            if (!alert.active || !alert.symbol.equals(symbol)) continue;
            if (!isRepeatEnabled(alert) && triggeredAlerts.contains(alert.id)) continue;
            if (!alert.targetType.equals("price")) continue;
            if (alert.confirmation == null || alert.confirmation.isEmpty()) alert.confirmation = "immediate";
            
            final boolean allowUp = hasCondition(alert, "crossing_up");
            final boolean allowDown = hasCondition(alert, "crossing_down");
            boolean conditionMet = false;
            if (allowUp && crossedUp(prevPrice, price, alert.target)) {
                conditionMet = true;
            } else if (allowDown && crossedDown(prevPrice, price, alert.target)) {
                conditionMet = true;
            }
            
            if (conditionMet) {
                triggerAlert(alert, price, alert.target);
            }
        }
    }
    
    private void triggerAlert(AlertConfig alert, double currentPrice, double targetValue) {
        long now = System.currentTimeMillis();

        if (isRepeatEnabled(alert)) {
            Long last = lastTriggeredAtMs.get(alert.id);
            if (last != null && now - last < alert.repeatIntervalSec * 1000L) {
                return;
            }
            lastTriggeredAtMs.put(alert.id, now);
        } else {
            triggeredAlerts.add(alert.id);
        }
        
        final boolean allowUp = hasCondition(alert, "crossing_up");
        final boolean allowDown = hasCondition(alert, "crossing_down");
        String direction = allowUp && allowDown ? "↕ 穿越" : (allowUp ? "↑ 突破" : "↓ 跌破");
        String targetStr;
        if ("indicator".equals(alert.targetType)) {
            targetStr = alert.targetValue != null ? alert.targetValue.toUpperCase() : String.format("%.4f", targetValue);
        } else if ("drawing".equals(alert.targetType) || alert.targetType == null) {
            targetStr = String.format("%.4f", targetValue);
        } else {
            targetStr = String.format("$%.2f", targetValue);
        }
        String message = alert.symbol + " " + direction + " " + targetStr + "\n当前: $" + String.format("%.2f", currentPrice);
        
        // Send notification
        if (alert.actions == null || alert.actions.notification) {
            sendNotification(alert.symbol + " 预警触发", message, alert.id.hashCode());
        }
        
        // Play Sound
        if (alert.soundId > 0) {
            playAlertSoundWithRepeat(alert);
        }

        // Vibrate
        String vib = (alert.actions != null) ? alert.actions.vibration : "once";
        if (vib == null) vib = "once";
        if (!"none".equals(vib)) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(android.content.Context.VIBRATOR_SERVICE);
                if (v != null) {
                    if ("continuous".equals(vib)) {
                        long[] pattern = new long[]{0, 1000, 200, 1000, 200, 1000};
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1));
                        } else {
                            v.vibrate(pattern, -1);
                        }
                    } else {
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            v.vibrate(android.os.VibrationEffect.createOneShot(500, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                        } else {
                            v.vibrate(500);
                        }
                    }
                }
            } catch (Exception ignored) {}
        }
        
        // Notify plugin to update JS (mark as inactive)
        if (tickerListener != null) {
            // Could add a separate listener for alert triggers
        }
    }

    private int getToneType(int soundId) {
        switch (soundId) {
            case 1: return android.media.ToneGenerator.TONE_CDMA_PIP; // Success
            case 2: return android.media.ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK; // Danger
            case 3: return android.media.ToneGenerator.TONE_DTMF_0; // Coin
            case 4: return android.media.ToneGenerator.TONE_PROP_PROMPT; // Laser
            case 5: return android.media.ToneGenerator.TONE_CDMA_ALERT_INCALL_LITE; // Rise
            case 6: return android.media.ToneGenerator.TONE_SUP_PIP; // Pop
            case 7: return android.media.ToneGenerator.TONE_CDMA_NETWORK_BUSY; // Tech
            case 8: return android.media.ToneGenerator.TONE_CDMA_LOW_SS; // Low Battery
            case 9: return android.media.ToneGenerator.TONE_PROP_ACK; // Confirm
            case 10: return android.media.ToneGenerator.TONE_CDMA_SOFT_ERROR_LITE; // Attention
            default: return android.media.ToneGenerator.TONE_PROP_BEEP;
        }
    }

    private int getToneDurationMs(int soundId) {
        switch (soundId) {
            case 1: return 2000;
            case 2: return 5000;
            case 3: return 1000;
            case 4: return 1000;
            case 5: return 3000;
            case 6: return 500;
            case 7: return 4000;
            case 8: return 3000;
            case 9: return 2000;
            case 10: return 4000;
            default: return 3000;
        }
    }

    private void playAlertSoundOnce(int soundId) {
        if (toneGenerator == null) return;
        toneGenerator.startTone(getToneType(soundId), getToneDurationMs(soundId));
    }

    private void playAlertSoundWithRepeat(AlertConfig alert) {
        if (alert == null || alert.soundId <= 0) return;
        if (!"loop".equals(alert.soundRepeat)) {
            playAlertSoundOnce(alert.soundId);
            return;
        }

        final long token = System.currentTimeMillis();
        soundLoopTokens.put(alert.id, token);

        final int soundId = alert.soundId;
        final int toneDurationMs = getToneDurationMs(soundId);
        final long pauseMs = Math.max(0, alert.loopPause) * 1000L;
        final long totalMs = Math.max(5, alert.soundDuration) * 1000L;
        final long endAt = System.currentTimeMillis() + totalMs;

        new Thread(() -> {
            try {
                while (System.currentTimeMillis() < endAt) {
                    Long currentToken = soundLoopTokens.get(alert.id);
                    if (currentToken == null || currentToken != token) return;
                    playAlertSoundOnce(soundId);
                    Thread.sleep(toneDurationMs + pauseMs);
                }
            } catch (InterruptedException ignored) {
            }
        }, "AlertSoundLoop-" + alert.id).start();
    }
    
    private void sendNotification(String title, String message, int id) {
        String channelId = "alert_channel_v2";
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                channelId, "价格预警", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("价格预警通知");
            channel.enableVibration(false);
            channel.setSound(null, null);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        
        // Create intent to open app when notification is clicked
        Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        android.app.PendingIntent pendingIntent = null;
        if (openIntent != null) {
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pendingIntent = android.app.PendingIntent.getActivity(
                this, id, openIntent, 
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
            );
        }
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(0)
            .setAutoCancel(true);
        
        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
            builder.setFullScreenIntent(pendingIntent, true); // Heads-up style
        }
        
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(id, builder.build());
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (marketDataProvider != null) {
            try { marketDataProvider.shutdown(); } catch (Exception ignored) {}
        } else {
            if (spotWebSocket != null) spotWebSocket.cancel();
            if (futuresWebSocket != null) futuresWebSocket.cancel();
            if (klineWebSocket != null) {
                klineWebSocket.cancel();
            }
        }
        klineHandler.removeCallbacks(klineWatchdog);
        if (floatingView != null && windowManager != null && windowVisible) {
            try {
                windowManager.removeView(floatingView);
            } catch (Exception e) {}
        }
    }

    private void startForegroundService() {
        String channelId = "floating_service_channel";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "Floating Window Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = null;
        if (launchIntent != null) {
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            pi = PendingIntent.getActivity(
                    this,
                    0,
                    launchIntent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT : PendingIntent.FLAG_UPDATE_CURRENT
            );
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setContentTitle("Amaze Monitor")
                .setContentText("后台监控价格中...")
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .setOngoing(true);

        if (pi != null) {
            builder.setContentIntent(pi);
        }

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, notification);
        }
    }
}
