package com.binance.pricemonitor;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.IBinder;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.os.Build;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import androidx.core.app.NotificationCompat;

public class FloatingWindowService extends Service {
    private WindowManager windowManager;
    private View floatingView;
    private TextView priceText;
    private TextView changeText;
    public static final String ACTION_UPDATE = "UPDATE_DATA";
    public static final String EXTRA_SYMBOL = "SYMBOL";
    public static final String EXTRA_PRICE = "PRICE";
    public static final String EXTRA_CHANGE = "CHANGE";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundService();

        floatingView = LayoutInflater.from(this).inflate(R.layout.floating_widget, null);
        priceText = floatingView.findViewById(R.id.floating_price_text);
        changeText = floatingView.findViewById(R.id.floating_change_text);

        final WindowManager.LayoutParams params = new WindowManager.LayoutParams(
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

        // Add drag listener
        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = params.x;
                        initialY = params.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
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
        if (intent != null && ACTION_UPDATE.equals(intent.getAction())) {
            String symbol = intent.getStringExtra(EXTRA_SYMBOL);
            String price = intent.getStringExtra(EXTRA_PRICE);
            String change = intent.getStringExtra(EXTRA_CHANGE);

            if (priceText != null && symbol != null) {
                priceText.setText(symbol + ": $" + (price != null ? price : "--"));
            }
            if (changeText != null && change != null) {
                // Check for NaN or invalid values
                try {
                    double changeVal = Double.parseDouble(change);
                    if (Double.isNaN(changeVal)) {
                        changeText.setText("--%");
                        changeText.setTextColor(0xFFFFFFFF);
                    } else {
                        changeText.setText(change + "%");
                        int color = changeVal < 0 ? 0xFFFF4444 : 0xFF00CC88;
                        changeText.setTextColor(color);
                    }
                } catch (NumberFormatException e) {
                    changeText.setText("--%");
                    changeText.setTextColor(0xFFFFFFFF);
                }
            }
        }
        return START_STICKY;
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
