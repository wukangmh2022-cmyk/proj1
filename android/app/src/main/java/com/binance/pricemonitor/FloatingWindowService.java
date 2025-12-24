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
    
    public static final String ACTION_UPDATE = "UPDATE_DATA";
    public static final String ACTION_CONFIG = "UPDATE_CONFIG";
    public static final String ACTION_SET_SYMBOLS = "SET_SYMBOLS";
    
    public static final String EXTRA_SYMBOL = "SYMBOL";
    public static final String EXTRA_PRICE = "PRICE";
    public static final String EXTRA_CHANGE = "CHANGE";
    public static final String EXTRA_FONT_SIZE = "FONT_SIZE";
    public static final String EXTRA_OPACITY = "OPACITY";
    public static final String EXTRA_SHOW_SYMBOL = "SHOW_SYMBOL";
    public static final String EXTRA_SYMBOL_LIST = "SYMBOL_LIST";
    public static final String EXTRA_ITEMS_PER_PAGE = "ITEMS_PER_PAGE"; // New extra

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
        itemsContainer = floatingView.findViewById(R.id.items_container); // New container for list items

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
                        
                        // Check if it was a click (short duration, small movement)
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
            }
            return START_STICKY;
        }

        if (ACTION_CONFIG.equals(action)) {
            fontSize = intent.getFloatExtra(EXTRA_FONT_SIZE, 14f);
            opacity = intent.getFloatExtra(EXTRA_OPACITY, 0.85f);
            showSymbol = intent.getBooleanExtra(EXTRA_SHOW_SYMBOL, true);
            itemsPerPage = intent.getIntExtra(EXTRA_ITEMS_PER_PAGE, 1); // Get itemsPerPage
            applyConfig();
            updateUI(); // Re-render UI with new item count
            return START_STICKY;
        }
        
        if (ACTION_UPDATE.equals(action)) {
            String symbol = intent.getStringExtra(EXTRA_SYMBOL);
            String price = intent.getStringExtra(EXTRA_PRICE);
            String change = intent.getStringExtra(EXTRA_CHANGE);
            
            if (symbol != null) {
                priceDataMap.put(symbol, new String[]{price, change});
                if (!symbolList.contains(symbol)) {
                    symbolList.add(symbol);
                }
                // Check if the updated symbol is currently visible
                if (isSymbolVisible(symbol)) {
                    updateUI();
                }
            }
        }
        return START_STICKY;
    }
    
    private boolean isSymbolVisible(String symbol) {
        if (symbolList.isEmpty()) return false;
        
        // Calculate page index logic
        // We paginate by itemsPerPage. currentIndex is the starting index of the page.
        // But our currentIndex logic was previously single-item. 
        // Let's adjust: "currentIndex" will be the index of the first item on the current page.
        
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
        itemsContainer.removeAllViews(); // Clear existing views
        
        if (symbolList.isEmpty()) {
            addLoadingView();
            return;
        }

        // Add views for each item in the current page
        for (int i = 0; i < itemsPerPage; i++) {
            int idx = (currentIndex + i) % symbolList.size();
            String symbol = symbolList.get(idx);
            String[] data = priceDataMap.get(symbol);
            addTickerView(symbol, data);
            
            // If total symbols < itemsPerPage, don't duplicate
            if (i >= symbolList.size() - 1) break; 
        }
    }
    
    private void addLoadingView() {
        TextView tv = new TextView(this);
        tv.setText("Waiting for data...");
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize);
        itemsContainer.addView(tv);
    }

    private void addTickerView(String symbol, String[] data) {
        String price = (data != null) ? data[0] : "--";
        String change = (data != null) ? data[1] : null;

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, 0, 0, 10); // Spacing between items

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
                double changeVal = Double.parseDouble(change);
                if (Double.isNaN(changeVal)) {
                    changeTv.setText("--%");
                    changeTv.setTextColor(Color.WHITE);
                } else {
                    changeTv.setText(String.format("%.2f%%", changeVal));
                    int color = changeVal < 0 ? 0xFFFF4444 : 0xFF00CC88;
                    changeTv.setTextColor(color);
                }
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
                .setContentText("Floating window active")
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, notification);
        }
    }
}
