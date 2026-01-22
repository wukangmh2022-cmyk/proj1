package com.binance.pricemonitor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingWidget")
public class FloatingWidgetPlugin extends Plugin {
    private static final String PREFS_NAME = "amaze_monitor_prefs";
    private static final String PREFS_FONT_SIZE = "floating_font_size";
    private static final String PREFS_OPACITY = "floating_opacity";
    private static final String PREFS_SHOW_SYMBOL = "floating_show_symbol";
    private static final String PREFS_ITEMS_PER_PAGE = "floating_items_per_page";
    private static final long EMIT_DEDUP_MS = 200L;

    private BroadcastReceiver broadcastReceiver;
    private final java.util.Map<String, Long> lastEmitBySymbolMs = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<String, Double> lastEmitPrice = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<String, Double> lastEmitChange = new java.util.concurrent.ConcurrentHashMap<>();

    @Override
    public void load() {
        super.load();
        
        // Register as listener for ticker updates from the Service (Broadcast for IPC)
        broadcastReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if ("com.binance.pricemonitor.TICKER_UPDATE".equals(intent.getAction())) {
                    String symbol = intent.getStringExtra("symbol");
                    double price = intent.getDoubleExtra("price", 0);
                    double changePercent = intent.getDoubleExtra("changePercent", 0);
                    
                    emitTickerUpdate(symbol, price, changePercent);
                }
            }
        };
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(broadcastReceiver, new IntentFilter("com.binance.pricemonitor.TICKER_UPDATE"), Context.RECEIVER_NOT_EXPORTED); 
        } else {
            getContext().registerReceiver(broadcastReceiver, new IntentFilter("com.binance.pricemonitor.TICKER_UPDATE"));
        }

        // Keep static listener for backward compat (if same process)
        FloatingWindowService.setTickerListener((symbol, price, changePercent) -> emitTickerUpdate(symbol, price, changePercent));
    }
    
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        try {
            if (broadcastReceiver != null) {
                getContext().unregisterReceiver(broadcastReceiver);
            }
        } catch (Exception e) {}
        FloatingWindowService.setTickerListener(null);
    }

    private void emitTickerUpdate(String symbol, double price, double changePercent) {
        if (symbol == null) return;
        long now = System.currentTimeMillis();
        Long lastMs = lastEmitBySymbolMs.get(symbol);
        Double lastPrice = lastEmitPrice.get(symbol);
        Double lastChange = lastEmitChange.get(symbol);
        boolean isDuplicate = lastMs != null
                && lastPrice != null
                && lastChange != null
                && lastPrice == price
                && lastChange == changePercent
                && now - lastMs < EMIT_DEDUP_MS;
        if (isDuplicate) return;

        lastEmitBySymbolMs.put(symbol, now);
        lastEmitPrice.put(symbol, price);
        lastEmitChange.put(symbol, changePercent);

        JSObject data = new JSObject();
        data.put("symbol", symbol);
        data.put("price", price);
        data.put("changePercent", changePercent);
        notifyListeners("tickerUpdate", data);
    }

    @PluginMethod
    public void startData(PluginCall call) {
        com.getcapacitor.JSArray jsArray = call.getArray("symbols");
        java.util.ArrayList<String> symbols = new java.util.ArrayList<>();
        try {
            for (int i = 0; i < jsArray.length(); i++) {
                symbols.add(jsArray.getString(i));
            }
        } catch (Exception e) {
            call.reject("Invalid symbol list");
            return;
        }

        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_START_DATA);
        intent.putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, symbols);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void syncAlerts(PluginCall call) {
        com.getcapacitor.JSArray jsArray = call.getArray("alerts");
        String alertsJson = jsArray != null ? jsArray.toString() : "[]";
        
        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_SYNC_ALERTS);
        intent.putExtra(FloatingWindowService.EXTRA_ALERTS_JSON, alertsJson);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        // Now "start" means show the floating window
        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_SHOW_WINDOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        // Now "stop" means hide the floating window (service keeps running)
        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_HIDE_WINDOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void setSymbols(PluginCall call) {
        com.getcapacitor.JSArray jsArray = call.getArray("symbols");
        java.util.ArrayList<String> symbols = new java.util.ArrayList<>();
        try {
            for (int i = 0; i < jsArray.length(); i++) {
                symbols.add(jsArray.getString(i));
            }
        } catch (Exception e) {
            call.reject("Invalid symbol list");
            return;
        }

        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_SET_SYMBOLS);
        intent.putStringArrayListExtra(FloatingWindowService.EXTRA_SYMBOL_LIST, symbols);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }




    @PluginMethod
    public void requestTickerUpdate(PluginCall call) {
        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_REQUEST_UPDATE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void updateConfig(PluginCall call) {
        float fontSize = call.getFloat("fontSize", 14f);
        float opacity = call.getFloat("opacity", 0.85f);
        boolean showSymbol = call.getBoolean("showSymbol", true);
        int itemsPerPage = call.getInt("itemsPerPage", 1);

        persistFloatingConfig(fontSize, opacity, showSymbol, itemsPerPage);

        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_CONFIG);
        intent.putExtra(FloatingWindowService.EXTRA_FONT_SIZE, fontSize);
        intent.putExtra(FloatingWindowService.EXTRA_OPACITY, opacity);
        intent.putExtra(FloatingWindowService.EXTRA_SHOW_SYMBOL, showSymbol);
        intent.putExtra(FloatingWindowService.EXTRA_ITEMS_PER_PAGE, itemsPerPage);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        
        call.resolve();
    }

    private void persistFloatingConfig(float fontSize, float opacity, boolean showSymbol, int itemsPerPage) {
        try {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putFloat(PREFS_FONT_SIZE, fontSize)
                    .putFloat(PREFS_OPACITY, opacity)
                    .putBoolean(PREFS_SHOW_SYMBOL, showSymbol)
                    .putInt(PREFS_ITEMS_PER_PAGE, itemsPerPage)
                    .apply();
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ret.put("granted", Settings.canDrawOverlays(getContext()));
        } else {
            ret.put("granted", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(getContext())) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivityForResult(intent, 0);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void previewSound(PluginCall call) {
        int soundId = call.getInt("soundId", 1);
        Context context = getContext().getApplicationContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_PREVIEW_SOUND);
        intent.putExtra(FloatingWindowService.EXTRA_SOUND_ID, soundId);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }
}
