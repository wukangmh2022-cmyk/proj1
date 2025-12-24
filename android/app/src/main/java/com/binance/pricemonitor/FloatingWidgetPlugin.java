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

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

@CapacitorPlugin(name = "FloatingWidget")
public class FloatingWidgetPlugin extends Plugin {

    private BroadcastReceiver tickerReceiver;

    @Override
    public void load() {
        super.load();
        
        // Register receiver to get ticker updates from the Service
        tickerReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String symbol = intent.getStringExtra("symbol");
                double price = intent.getDoubleExtra("price", 0);
                double changePercent = intent.getDoubleExtra("changePercent", 0);
                
                JSObject data = new JSObject();
                data.put("symbol", symbol);
                data.put("price", price);
                data.put("changePercent", changePercent);
                
                // Notify JS listeners
                notifyListeners("tickerUpdate", data);
            }
        };
        
        IntentFilter filter = new IntentFilter("com.binance.pricemonitor.TICKER_UPDATE");
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(tickerReceiver, filter);
    }
    
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (tickerReceiver != null) {
            LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(tickerReceiver);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        context.stopService(intent);
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

        Context context = getContext();
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
    public void updateConfig(PluginCall call) {
        float fontSize = call.getFloat("fontSize", 14f);
        float opacity = call.getFloat("opacity", 0.85f);
        boolean showSymbol = call.getBoolean("showSymbol", true);
        int itemsPerPage = call.getInt("itemsPerPage", 1);

        Context context = getContext();
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
}
