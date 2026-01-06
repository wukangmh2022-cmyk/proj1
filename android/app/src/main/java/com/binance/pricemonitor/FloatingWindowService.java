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
    private long lastUiUpdateMs = 0L;
    private static final long UI_UPDATE_THROTTLE_MS = 200L; // cap UI redraws to ~5fps to reduce jank
    
    // Data storage
    private java.util.List<String> symbolList = new java.util.ArrayList<>();
    private java.util.Map<String, String[]> priceDataMap = new java.util.concurrent.ConcurrentHashMap<>();
    private java.util.Map<String, double[]> rawPriceDataMap = new java.util.concurrent.ConcurrentHashMap<>();
    private int currentIndex = 0;
    
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

    private boolean windowVisible = false;
    private static final String PERF_TAG = "[perf] FloatingWindowService";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d(PERF_TAG, "onCreate at " + System.currentTimeMillis());
        startForegroundService();
        
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
            stopWebSockets();
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
    
    private void stopWebSockets() {
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
                
                priceDataMap.put(symbol, new String[]{
                    formatPrice(closePrice), 
                    String.format("%.2f", changePercent)
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
        } catch (Exception e) {
            e.printStackTrace();
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
            
            // PRE-PARSE / CACHE PARAMETERS to avoid Map lookup in hot loop
            for (AlertConfig a : alerts) {
                try {
                    if (a.repeatMode == null || a.repeatMode.isEmpty()) a.repeatMode = "once";
                    if (a.repeatIntervalSec < 0) a.repeatIntervalSec = 0;
                    if (a.actions == null) a.actions = new AlertConfig.Actions();
                    if (a.actions.vibration == null || a.actions.vibration.isEmpty()) a.actions.vibration = "once";

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
            
            // Connect to K-line streams if needed
            connectKlineWebSocket();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    
    private void connectKlineWebSocket() {
        if (klineWebSocket != null) {
            klineWebSocket.cancel();
            klineWebSocket = null;
        }
        
        // Collect all needed kline streams from alerts
        java.util.Set<String> streams = new java.util.HashSet<>();
        for (AlertConfig alert : alerts) {
            if (alert.active && (alert.targetType.equals("indicator") || alert.targetType.equals("drawing") || alert.confirmation.equals("candle_close"))) {
                String interval = alert.interval != null ? alert.interval : "1m";
                streams.add(alert.symbol.toLowerCase() + "@kline_" + interval);
            }
        }
        
        if (streams.isEmpty()) {
            // Release WakeLock if no active alerts
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
            return;
        }
        
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
        
        String streamPath = String.join("/", streams);
        String url = "wss://stream.binance.com:9443/stream?streams=" + streamPath;
        
        okhttp3.Request request = new okhttp3.Request.Builder().url(url).build();
        klineWebSocket = client.newWebSocket(request, new okhttp3.WebSocketListener() {
            @Override
            public void onMessage(okhttp3.WebSocket webSocket, String text) {
                handleKlineMessage(text);
            }
            
            @Override
            public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    connectKlineWebSocket();
                }, 5000);
            }
        });
        
        // Also fetch initial history
        fetchKlineHistory(streams);
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
        } catch (Exception e) {
            e.printStackTrace();
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
            boolean conditionMet = false;
            double triggerTarget = 0;

            if ("rect_zone".equals(alert.algo) && potentialTargets.size() >= 2) {
                double high = java.util.Collections.max(potentialTargets);
                double low = java.util.Collections.min(potentialTargets);
                if (allowUp && crossedUp(prevClose, close, high)) {
                    conditionMet = true;
                    triggerTarget = high;
                } else if (allowDown && crossedDown(prevClose, close, low)) {
                    conditionMet = true;
                    triggerTarget = low;
                }
            } else {
                for (double tVal : potentialTargets) {
                    if (allowUp && crossedUp(prevClose, close, tVal)) {
                        conditionMet = true;
                        triggerTarget = tVal;
                        break;
                    } else if (allowDown && crossedDown(prevClose, close, tVal)) {
                        conditionMet = true;
                        triggerTarget = tVal;
                        break;
                    }
                }
            }
            
            if (conditionMet) {
                // Handle Confirmation Mode
                if ("time_delay".equals(alert.confirmation) && alert.delaySeconds > 0) {
                    long now = System.currentTimeMillis();
                    if (!pendingDelayAlerts.containsKey(alert.id)) {
                        // First time condition met: Start timer
                        pendingDelayAlerts.put(alert.id, now);
                    } else {
                        // Already pending: Check duration
                        long startTime = pendingDelayAlerts.get(alert.id);
                        if (now - startTime >= alert.delaySeconds * 1000L) {
                            // Time up! Trigger.
                            triggerAlert(alert, close, triggerTarget);
                           if (pendingDelayAlerts.containsKey(alert.id)) {
                        pendingDelayAlerts.remove(alert.id);
                    }
                        }
                    }
                } else if ("candle_delay".equals(alert.confirmation) && alert.delayCandles > 0) {
                    if (isClosed) {
                        int count = candleDelayCounter.getOrDefault(alert.id, 0) + 1;
                        if (count >= alert.delayCandles) {
                            triggerAlert(alert, close, triggerTarget);
                            candleDelayCounter.put(alert.id, 0); // Reset or Keep? Usually trigger once.
                        } else {
                            candleDelayCounter.put(alert.id, count);
                        }
                    }
                    // For open candles, do nothing (wait for close)
                } else {
                    // Immediate trigger (or candle close which is already filtered)
                    triggerAlert(alert, close, triggerTarget);
                }
            } else {
                // Condition NOT met
                if (pendingDelayAlerts.containsKey(alert.id)) {
                    pendingDelayAlerts.remove(alert.id);
                }
                if (isClosed) {
                    // Reset candle counter if condition broke on a CLOSED candle
                    candleDelayCounter.put(alert.id, 0);
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
                if (t <= alert.cachedT_End) {
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
            if (!alert.confirmation.equals("immediate")) continue;
            
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
        String targetStr = alert.targetType.equals("indicator") 
            ? alert.targetValue.toUpperCase() 
            : String.format("$%.2f", targetValue);
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
        if (spotWebSocket != null) spotWebSocket.cancel();
        if (futuresWebSocket != null) futuresWebSocket.cancel();
        if (klineWebSocket != null) {
            klineWebSocket.cancel();
        }
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
