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
        wireWebViewFirstDraw();
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
        getBridge().getWebView().getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                hideOverlay();
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
}
