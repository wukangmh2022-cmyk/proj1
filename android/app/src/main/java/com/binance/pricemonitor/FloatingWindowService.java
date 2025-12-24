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
import androidx.core.app.NotificationCompat;

public class FloatingWindowService extends Service {
    private WindowManager windowManager;
    private View floatingView;
    private LinearLayout container;
    private LinearLayout itemsContainer;
    private WindowManager.LayoutParams params;
    
    // Data storage
    private java.util.List<String> symbolList = new java.util.ArrayList<>();
    private java.util.Map<String, String[]> priceDataMap = new java.util.concurrent.ConcurrentHashMap<>();
    private int currentIndex = 0;
    
    // Config values
    private float fontSize = 14f;
    private float opacity = 0.85f;
    private boolean showSymbol = true;
    private int itemsPerPage = 1;
    
    // WebSocket
    private okhttp3.WebSocket webSocket;
    private okhttp3.OkHttpClient client = new okhttp3.OkHttpClient();
    private com.google.gson.Gson gson = new com.google.gson.Gson();

    public static final String ACTION_CONFIG = "UPDATE_CONFIG";
    public static final String ACTION_SET_SYMBOLS = "SET_SYMBOLS";
    
    public static final String EXTRA_FONT_SIZE = "FONT_SIZE";
    public static final String EXTRA_OPACITY = "OPACITY";
    public static final String EXTRA_SHOW_SYMBOL = "SHOW_SYMBOL";
    public static final String EXTRA_SYMBOL_LIST = "SYMBOL_LIST";
    public static final String EXTRA_ITEMS_PER_PAGE = "ITEMS_PER_PAGE";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundService();

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
        if (windowManager != null) {
            windowManager.addView(floatingView, params);
        }

        // Drag and Click listener
        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;
            private long startClickTime;

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
                        
                        if (clickDuration < 200 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                            showNextPage();
                        }
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        params.x = initialX + (int) (event.getRawX() - initialTouchX);
                        params.y = initialY + (int) (event.getRawY() - initialTouchY);
                        windowManager.updateViewLayout(floatingView, params);
                        return true;
                }
                return false;
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;
        
        String action = intent.getAction();
        
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
                updateUI();
                connectWebSocket(); // Reconnect with new symbols
            }
            return START_STICKY;
        }

        if (ACTION_CONFIG.equals(action)) {
            fontSize = intent.getFloatExtra(EXTRA_FONT_SIZE, 14f);
            opacity = intent.getFloatExtra(EXTRA_OPACITY, 0.85f);
            showSymbol = intent.getBooleanExtra(EXTRA_SHOW_SYMBOL, true);
            itemsPerPage = intent.getIntExtra(EXTRA_ITEMS_PER_PAGE, 1);
            applyConfig();
            updateUI();
            return START_STICKY;
        }
        
        return START_STICKY;
    }
    
    private void connectWebSocket() {
        if (webSocket != null) {
            webSocket.cancel(); // Use cancel to immediately stop
            webSocket = null;
        }
        
        if (symbolList.isEmpty()) return;

        StringBuilder streams = new StringBuilder();
        for (String s : symbolList) {
            streams.append(s.toLowerCase()).append("@miniTicker/");
        }
        // Remove trailing slash
        if (streams.length() > 0) streams.setLength(streams.length() - 1);
        
        String url = "wss://stream.binance.com:9443/stream?streams=" + streams.toString();
        
        okhttp3.Request request = new okhttp3.Request.Builder().url(url).build();
        webSocket = client.newWebSocket(request, new okhttp3.WebSocketListener() {
            @Override
            public void onOpen(okhttp3.WebSocket webSocket, okhttp3.Response response) {
                // Connected
            }

            @Override
            public void onMessage(okhttp3.WebSocket webSocket, String text) {
                handleMessage(text);
            }

            @Override
            public void onFailure(okhttp3.WebSocket webSocket, Throwable t, okhttp3.Response response) {
                // Retry logic could be added here
                try {
                    Thread.sleep(3000);
                    connectWebSocket();
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        });
    }
    
    private void handleMessage(String text) {
        try {
            com.google.gson.JsonObject json = com.google.gson.JsonParser.parseString(text).getAsJsonObject();
            if (json.has("data")) {
                com.google.gson.JsonObject data = json.getAsJsonObject("data");
                String symbol = data.get("s").getAsString();
                String close = data.get("c").getAsString();
                
                // Calculate change percent
                double closePrice = Double.parseDouble(close);
                double openPrice = Double.parseDouble(data.get("o").getAsString());
                double changePercent = ((closePrice - openPrice) / openPrice) * 100;
                
                priceDataMap.put(symbol, new String[]{
                    formatPrice(closePrice), 
                    String.format("%.2f", changePercent) // Change always 2 decimals
                });
                
                // Update UI on main thread
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    if (isSymbolVisible(symbol)) {
                         updateUI();
                    }
                });
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
        if (itemsContainer == null) return;
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
        if (windowManager != null && floatingView != null && params != null) {
            windowManager.updateViewLayout(floatingView, params);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (webSocket != null) {
            webSocket.cancel();
        }
        if (floatingView != null && windowManager != null) {
            windowManager.removeView(floatingView);
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

        Notification notification = new NotificationCompat.Builder(this, channelId)
                .setContentTitle("Binance Monitor")
                .setContentText("Getting live prices...")
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, notification);
        }
    }
}
