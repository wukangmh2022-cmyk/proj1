package com.binance.pricemonitor;

import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.os.Build;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "[perf] MainActivity";
    private FrameLayout loadingOverlay;
    private boolean overlayAttached = false;
    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean waitingForWebViewDraw = false;
    private Runnable resumeReloadRunnable = null;
    private Runnable hardRestartRunnable = null;
    private static final long RESUME_WATCHDOG_MS = 2500;
    private static final long HARD_RESTART_WATCHDOG_MS = 6000;
    private static final long MIN_BG_ARM_MS = 10_000;
    private android.view.ViewTreeObserver.OnPreDrawListener webViewPreDrawListener = null;
    private Runnable forceHideOverlayRunnable = null;
    private long lastPausedAtUptime = 0L;

    private String pendingSymbol = null;
    private boolean pendingOpenAlert = false;
    private boolean pendingOpenSettings = false;
    private boolean pendingOpenEdit = false;
    private String pendingSymbolsJson = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        long now = System.currentTimeMillis();
        Log.d(TAG, "onCreate at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] MainActivity onCreate at " + now);

        // Check for symbol deep link from HomeActivity
        if (getIntent() != null && getIntent().hasExtra("symbol")) {
            pendingSymbol = getIntent().getStringExtra("symbol");
        }
        
        // Check if we should open alert modal
        pendingOpenAlert = getIntent() != null && getIntent().getBooleanExtra("openAlert", false);
        pendingOpenSettings = getIntent() != null && getIntent().getBooleanExtra("openSettings", false);
        pendingOpenEdit = getIntent() != null && getIntent().getBooleanExtra("openEdit", false);
        pendingSymbolsJson = getIntent() != null ? getIntent().getStringExtra("symbolsJson") : null;

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
        if (pauseAt > 0) {
            Intent intent = new Intent(this, HomeActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
            finish();
            return;
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
        // Avoid long "spinning" overlays; hard-restart watchdog is expected to recover quickly.
        final long safetyMs = Math.max(5000L, HARD_RESTART_WATCHDOG_MS + 1500L);
        uiHandler.postDelayed(forceHideOverlayRunnable, safetyMs);
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
        
        // Navigate to pending symbol if needed
        if (getBridge() != null && getBridge().getWebView() != null) {
            if (pendingSymbolsJson != null && !pendingSymbolsJson.isEmpty()) {
                String syncScript = "try{localStorage.setItem('binance_symbols', JSON.stringify(" + pendingSymbolsJson + "));}catch(e){}";
                getBridge().getWebView().evaluateJavascript(syncScript, null);
                pendingSymbolsJson = null;
            }

            if (pendingSymbol != null) {
                if (pendingOpenAlert) {
                    // Navigate to home with symbol param for alert modal
                    // The React app will detect this and open alert modal
                    String script = "window.location.replace('#/?alertSymbol=" + pendingSymbol + "');";
                    getBridge().getWebView().evaluateJavascript(script, null);
                } else {
                    String script = "window.location.replace('#/chart/" + pendingSymbol + "');";
                    getBridge().getWebView().evaluateJavascript(script, null);
                }
                pendingSymbol = null;
                pendingOpenAlert = false;
                pendingOpenSettings = false;
                pendingOpenEdit = false;
                return;
            }

            if (pendingOpenSettings) {
                String script = "window.location.replace('#/?openSettings=1');";
                getBridge().getWebView().evaluateJavascript(script, null);
                pendingOpenSettings = false;
            } else if (pendingOpenEdit) {
                String script = "window.location.replace('#/?editMode=1');";
                getBridge().getWebView().evaluateJavascript(script, null);
                pendingOpenEdit = false;
            }
        }
    }

    private boolean canRecoverNow() {
        return true;
    }

    private void armResumeReloadWatchdog() {
        if (resumeReloadRunnable != null) uiHandler.removeCallbacks(resumeReloadRunnable);
        resumeReloadRunnable = () -> {
            if (!waitingForWebViewDraw) return;
            // First tier: immediate hard restart if stuck > 2.5s
            // recreate() is often not enough for deep render freezer.
            long now = System.currentTimeMillis();
            Log.d(TAG, "resume watchdog: forcing hard restart at " + now);
            DiagnosticsLog.append(getApplicationContext(), "[native] resume watchdog: forcing hard restart at " + now);
            try {
                hideOverlay();
                hardRestartApp();
            } catch (Exception ignored) {}
        };
        uiHandler.postDelayed(resumeReloadRunnable, RESUME_WATCHDOG_MS);

        // Second-tier recovery: redundancy
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

    private boolean canHardRestartNow() {
        return true;
    }

    private void hardRestartApp() {
        long now = System.currentTimeMillis();
        Log.d(TAG, "hard restart: killing chart process at " + now);
        DiagnosticsLog.append(getApplicationContext(), "[native] hard restart: killing chart process at " + now);
        
        // Since we are now in the child :chart process, 
        // "Hard recovery" simply means killing this process so user falls back to the HomeActivity.
        // It's a "Crash to Desktop" behavior but effectively "Close to Home".
        // This is safe and robust.
        
        try {
            finishAffinity(); // Close this Activity and any parents in this task
            // Ensure process death to clear WebView deadlocks
            uiHandler.postDelayed(() -> {
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(0);
            }, 100);
        } catch (Exception ignored) {}
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
