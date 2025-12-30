package com.binance.pricemonitor;

import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "[perf] MainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        long now = System.currentTimeMillis();
        Log.d(TAG, "onCreate at " + now);
        registerPlugin(FloatingWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        long now = System.currentTimeMillis();
        Log.d(TAG, "onResume at " + now);
    }
}
