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
    private TextView priceText;
    private TextView changeText;
    private WindowManager.LayoutParams params;
    
    // Data storage
    private java.util.List<String> symbolList = new java.util.ArrayList<>();
    private java.util.Map<String, String[]> priceDataMap = new java.util.concurrent.ConcurrentHashMap<>();
    private int currentIndex = 0;
    
    // Config values
    private float fontSize = 14f;
    private float opacity = 0.85f;
    private boolean showSymbol = true;
    
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
        priceText = floatingView.findViewById(R.id.floating_price_text);
        changeText = floatingView.findViewById(R.id.floating_change_text);

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
                            showNextSymbol();
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
                // Preserve current symbol if possible
                String currentSymbol = (symbolList.size() > 0 && currentIndex < symbolList.size()) 
                    ? symbolList.get(currentIndex) : null;
                
                symbolList = received;
                
                // Try to find old current symbol in new list
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
            applyConfig();
            return START_STICKY;
        }
        
        if (ACTION_UPDATE.equals(action)) {
            String symbol = intent.getStringExtra(EXTRA_SYMBOL);
            String price = intent.getStringExtra(EXTRA_PRICE);
            String change = intent.getStringExtra(EXTRA_CHANGE);
            
            if (symbol != null) {
                // Store data
                priceDataMap.put(symbol, new String[]{price, change});
                
                // Also add to symbol list if not present (auto-discovery if setSymbols missed)
                if (!symbolList.contains(symbol)) {
                    symbolList.add(symbol);
                }
                
                // Update UI ONLY if this is the currently displayed symbol
                if (symbolList.size() > 0 && currentIndex < symbolList.size()) {
                    if (symbol.equals(symbolList.get(currentIndex))) {
                        updateUI();
                    }
                }
            }
        }
        return START_STICKY;
    }
    
    private void showNextSymbol() {
        if (symbolList.isEmpty()) return;
        currentIndex = (currentIndex + 1) % symbolList.size();
        updateUI();
    }
    
    private void updateUI() {
        if (symbolList.isEmpty()) return;
        if (currentIndex >= symbolList.size()) currentIndex = 0;
        
        String symbol = symbolList.get(currentIndex);
        String[] data = priceDataMap.get(symbol);
        String price = (data != null) ? data[0] : "--";
        String change = (data != null) ? data[1] : null; // Pass raw value instead of formatted

        if (priceText != null) {
            String displayText = showSymbol ? 
                (symbol != null ? symbol + ": $" : "$") + (price != null ? price : "--") :
                "$" + (price != null ? price : "--");
            priceText.setText(displayText);
        }
        
        if (changeText != null) {
            if (change == null) {
                 changeText.setText("--%");
                 changeText.setTextColor(0xFFFFFFFF);
            } else {
                try {
                    double changeVal = Double.parseDouble(change);
                    if (Double.isNaN(changeVal)) {
                        changeText.setText("--%");
                        changeText.setTextColor(0xFFFFFFFF);
                    } else {
                        changeText.setText(String.format("%.2f%%", changeVal));
                        int color = changeVal < 0 ? 0xFFFF4444 : 0xFF00CC88;
                        changeText.setTextColor(color);
                    }
                } catch (NumberFormatException e) {
                    changeText.setText("--%");
                    changeText.setTextColor(0xFFFFFFFF);
                }
            }
        }
    }
    
    private void applyConfig() {
        if (priceText != null) {
            priceText.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize);
        }
        if (changeText != null) {
            changeText.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSize - 2);
        }
        if (container != null) {
            int alpha = (int) (opacity * 255);
            int bgColor = Color.argb(alpha, 0, 0, 0);
            container.setBackgroundColor(bgColor);
        }
        // Force layout update to accommodate new text sizes
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
