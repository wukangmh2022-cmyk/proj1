package com.binance.pricemonitor;

import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "[perf] MainActivity";
    private FrameLayout loadingOverlay;
    private boolean overlayAttached = false;
    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean waitingForWebViewDraw = false;
    private Runnable resumeReloadRunnable = null;
    private static final long RESUME_WATCHDOG_MS = 2200;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        long now = System.currentTimeMillis();
        Log.d(TAG, "onCreate at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onCreate at " + now);
        registerPlugin(FloatingWidgetPlugin.class);
        registerPlugin(DiagnosticsPlugin.class);
        // Switch off the Launch (SplashScreen) theme as early as possible to avoid gray/blank window on resume.
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);

        // Native overlay for renderer-not-ready cases (JS not yet running).
        attachLoadingOverlay();
        setNativeWatchdogFlagInJs();
    }

    @Override
    public void onStart() {
        super.onStart();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onStart at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onStart at " + now);
    }

    @Override
    public void onResume() {
        super.onResume();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onResume at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onResume at " + now);
        showOverlay();
        waitingForWebViewDraw = true;
        wireWebViewFirstDraw();
        armResumeReloadWatchdog();
    }

    @Override
    public void onPause() {
        super.onPause();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onPause at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onPause at " + now);
    }

    @Override
    public void onStop() {
        super.onStop();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onStop at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onStop at " + now);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onDestroy at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onDestroy at " + now);
        if (resumeReloadRunnable != null) uiHandler.removeCallbacks(resumeReloadRunnable);
    }

    private void attachLoadingOverlay() {
        if (overlayAttached) return;
        ViewGroup root = findViewById(android.R.id.content);
        if (root == null) return;
        loadingOverlay = new FrameLayout(this);
        loadingOverlay.setClickable(true);
        loadingOverlay.setFocusable(true);
        loadingOverlay.setBackgroundColor(0xCC0D1117); // semi-opaque dark to match theme
        ProgressBar spinner = new ProgressBar(this, null, android.R.attr.progressBarStyleLarge);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = android.view.Gravity.CENTER;
        loadingOverlay.addView(spinner, lp);
        root.addView(loadingOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        overlayAttached = true;
    }

    private void wireWebViewFirstDraw() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        // Add a one-shot listener for each resume; remove after first draw.
        getBridge().getWebView().getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                hideOverlay();
                waitingForWebViewDraw = false;
                if (resumeReloadRunnable != null) uiHandler.removeCallbacks(resumeReloadRunnable);
                // Remove listener after first draw
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().getViewTreeObserver().removeOnPreDrawListener(this);
                }
                return true;
            }
        });
    }

    private void showOverlay() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(android.view.View.VISIBLE);
    }

    private void hideOverlay() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(android.view.View.GONE);
    }

    private boolean canReloadNow() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences("resume_watchdog", MODE_PRIVATE);
            long now = android.os.SystemClock.uptimeMillis();
            long lastAt = sp.getLong("at", 0);
            int count = sp.getInt("count", 0);
            if (now - lastAt < 120_000) {
                if (count >= 2) return false;
                sp.edit().putLong("at", now).putInt("count", count + 1).apply();
                return true;
            }
            sp.edit().putLong("at", now).putInt("count", 1).apply();
            return true;
        } catch (Exception ignored) {
            return true;
        }
    }

    private void armResumeReloadWatchdog() {
        if (resumeReloadRunnable != null) uiHandler.removeCallbacks(resumeReloadRunnable);
        resumeReloadRunnable = () -> {
            if (!waitingForWebViewDraw) return;
            if (!canReloadNow()) {
                long now = System.currentTimeMillis();
                Log.d(TAG, "resume watchdog: reload suppressed at " + now);
                DiagnosticsLog.append(getApplicationContext(), "[native] resume watchdog: reload suppressed at " + now);
                return;
            }
            long now = System.currentTimeMillis();
            Log.d(TAG, "resume watchdog: forcing webview reload at " + now);
            DiagnosticsLog.append(getApplicationContext(), "[native] resume watchdog: forcing webview reload at " + now);
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().post(() -> {
                        try {
                            getBridge().getWebView().reload();
                        } catch (Exception ignored) {}
                    });
                }
            } catch (Exception ignored) {}
        };
        uiHandler.postDelayed(resumeReloadRunnable, RESUME_WATCHDOG_MS);
    }

    private void setNativeWatchdogFlagInJs() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            getBridge().getWebView().post(() -> {
                try {
                    getBridge().getWebView().evaluateJavascript("window.__NATIVE_RESUME_WATCHDOG__=true;", null);
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }
}
