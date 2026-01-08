package com.binance.pricemonitor;

import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.os.Build;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "[perf] MainActivity";
    private FrameLayout loadingOverlay;
    private boolean overlayAttached = false;
    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean waitingForWebViewDraw = false;
    private Runnable resumeReloadRunnable = null;
    private Runnable hardRestartRunnable = null;
    private static final long RESUME_WATCHDOG_MS = 2000;
    private static final long HARD_RESTART_WATCHDOG_MS = 5000;
    private static final long MIN_BG_ARM_MS = 10_000;
    private android.view.ViewTreeObserver.OnPreDrawListener webViewPreDrawListener = null;
    private Runnable forceHideOverlayRunnable = null;
    private long lastPausedAtUptime = 0L;

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
        // Hide overlay when the very first frame is drawn on cold start.
        armWebViewReadyCallbacks();
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
        long bgMs = 0L;
        long pauseAt = lastPausedAtUptime;
        lastPausedAtUptime = 0L;
        if (pauseAt > 0) {
            bgMs = android.os.SystemClock.uptimeMillis() - pauseAt;
        }
        if (pauseAt > 0 && bgMs < MIN_BG_ARM_MS) {
            // Short background: don't flash overlay or trigger watchdog.
            return;
        }
        showOverlay();
        waitingForWebViewDraw = true;
        armWebViewReadyCallbacks();
        armResumeReloadWatchdog();
    }

    @Override
    public void onPause() {
        super.onPause();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onPause at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onPause at " + now);
        lastPausedAtUptime = android.os.SystemClock.uptimeMillis();
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
        if (hardRestartRunnable != null) uiHandler.removeCallbacks(hardRestartRunnable);
        if (forceHideOverlayRunnable != null) uiHandler.removeCallbacks(forceHideOverlayRunnable);
    }

    private void attachLoadingOverlay() {
        if (overlayAttached) return;
        ViewGroup root = findViewById(android.R.id.content);
        if (root == null) return;
        loadingOverlay = new FrameLayout(this);
        // Visual overlay only; do not block interactions even if it sticks for any reason.
        loadingOverlay.setClickable(false);
        loadingOverlay.setFocusable(false);
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
        loadingOverlay.setVisibility(android.view.View.GONE);
        overlayAttached = true;
    }

    private void armWebViewReadyCallbacks() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            uiHandler.postDelayed(this::armWebViewReadyCallbacks, 50);
            return;
        }

        final android.webkit.WebView webView = getBridge().getWebView();

        // 1) Best signal: visual state callback (fires once content is actually drawn).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                webView.postVisualStateCallback(0, new android.webkit.WebView.VisualStateCallback() {
                    @Override
                    public void onComplete(long requestId) {
                        onWebViewDrewFrame();
                    }
                });
            } catch (Exception ignored) {}
            // On modern Android, do NOT use pre-draw as "ready" (it can fire even when the first frame is blank),
            // keep watchdog + overlay until we get an actual visual-state callback.
            return;
        }

        // 2) Fallback: first pre-draw of the WebView view tree.
        try {
            if (webViewPreDrawListener != null) {
                try {
                    webView.getViewTreeObserver().removeOnPreDrawListener(webViewPreDrawListener);
                } catch (Exception ignored) {}
                webViewPreDrawListener = null;
            }
            webViewPreDrawListener = new android.view.ViewTreeObserver.OnPreDrawListener() {
                @Override
                public boolean onPreDraw() {
                    onWebViewDrewFrame();
                    try {
                        webView.getViewTreeObserver().removeOnPreDrawListener(this);
                    } catch (Exception ignored) {}
                    return true;
                }
            };
            webView.getViewTreeObserver().addOnPreDrawListener(webViewPreDrawListener);
        } catch (Exception ignored) {}
    }

    private void showOverlay() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(android.view.View.VISIBLE);
        // Safety: never let spinner stick forever in normal cases.
        if (forceHideOverlayRunnable != null) uiHandler.removeCallbacks(forceHideOverlayRunnable);
        forceHideOverlayRunnable = this::hideOverlay;
        // Keep overlay visible long enough for recovery actions (recreate / hard restart) to run.
        uiHandler.postDelayed(forceHideOverlayRunnable, 20_000);
    }

    private void hideOverlay() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(android.view.View.GONE);
    }

    private void onWebViewDrewFrame() {
        hideOverlay();
        waitingForWebViewDraw = false;
        if (resumeReloadRunnable != null) uiHandler.removeCallbacks(resumeReloadRunnable);
        if (hardRestartRunnable != null) uiHandler.removeCallbacks(hardRestartRunnable);
        if (forceHideOverlayRunnable != null) uiHandler.removeCallbacks(forceHideOverlayRunnable);
    }

    private boolean canRecoverNow() {
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

    private boolean canHardRestartNow() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences("resume_hard_restart", MODE_PRIVATE);
            long now = android.os.SystemClock.uptimeMillis();
            long lastAt = sp.getLong("at", 0);
            int count = sp.getInt("count", 0);
            // Hard restart is disruptive; allow at most 1 per 2 minutes, and 2 per 10 minutes.
            if (now - lastAt < 120_000) return false;
            if (now - lastAt < 600_000 && count >= 2) return false;
            sp.edit().putLong("at", now).putInt("count", now - lastAt < 600_000 ? (count + 1) : 1).apply();
            return true;
        } catch (Exception ignored) {
            return true;
        }
    }

    private void hardRestartApp() {
        long now = System.currentTimeMillis();
        Log.d(TAG, "hard restart: restarting task at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] hard restart: restarting task at " + now);
        try {
            // Schedule a restart via AlarmManager, then kill the process to fully reset WebView/JS/native singletons.
            // This avoids killing the freshly-started Activity in the same process.
            android.content.Intent restartIntent = new android.content.Intent(this, MainActivity.class);
            restartIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK);

            android.app.PendingIntent pendingIntent = android.app.PendingIntent.getActivity(
                    this,
                    0,
                    restartIntent,
                    android.app.PendingIntent.FLAG_CANCEL_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
            );

            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(ALARM_SERVICE);
            long at = android.os.SystemClock.elapsedRealtime() + 250;
            if (am != null) {
                am.setExact(android.app.AlarmManager.ELAPSED_REALTIME, at, pendingIntent);
            }

            finishAffinity();
            uiHandler.postDelayed(() -> {
                try {
                    android.os.Process.killProcess(android.os.Process.myPid());
                } catch (Exception ignored) {}
            }, 80);
        } catch (Exception ignored) {}
    }

    private void armResumeReloadWatchdog() {
        if (resumeReloadRunnable != null) uiHandler.removeCallbacks(resumeReloadRunnable);
        resumeReloadRunnable = () -> {
            if (!waitingForWebViewDraw) return;
            if (!canRecoverNow()) {
                long now = System.currentTimeMillis();
                Log.d(TAG, "resume watchdog: recover suppressed at " + now);
                DiagnosticsLog.append(getApplicationContext(), "[native] resume watchdog: recover suppressed at " + now);
                return;
            }
            long now = System.currentTimeMillis();
            Log.d(TAG, "resume watchdog: forcing activity recreate at " + now);
            DiagnosticsLog.append(getApplicationContext(), "[native] resume watchdog: forcing activity recreate at " + now);
            try {
                // recreate() is more aggressive than WebView.reload and can recover faster when renderer is wedged.
                // Best-effort hide overlay to avoid leaving a blocking surface during transition.
                hideOverlay();
                recreate();
            } catch (Exception ignored) {}
        };
        uiHandler.postDelayed(resumeReloadRunnable, RESUME_WATCHDOG_MS);

        // Second-tier recovery: if still stuck after a longer window, restart the whole task/process.
        if (hardRestartRunnable != null) uiHandler.removeCallbacks(hardRestartRunnable);
        hardRestartRunnable = () -> {
            if (!waitingForWebViewDraw) return;
            long now = System.currentTimeMillis();
            Log.d(TAG, "hard watchdog: still stuck after " + HARD_RESTART_WATCHDOG_MS + "ms at " + now);
            DiagnosticsLog.append(getApplicationContext(), "[native] hard watchdog: still stuck after " + HARD_RESTART_WATCHDOG_MS + "ms at " + now);
            if (!canHardRestartNow()) {
                Log.d(TAG, "hard watchdog: restart suppressed at " + now);
                DiagnosticsLog.append(getApplicationContext(), "[native] hard watchdog: restart suppressed at " + now);
                return;
            }
            hardRestartApp();
        };
        uiHandler.postDelayed(hardRestartRunnable, HARD_RESTART_WATCHDOG_MS);
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
