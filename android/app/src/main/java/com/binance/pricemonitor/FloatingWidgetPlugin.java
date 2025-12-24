package com.binance.pricemonitor;

import android.content.Context;
import android.content.Intent;
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

    @Override
    public void load() {
        super.load();
        
        // Register as listener for ticker updates from the Service
        FloatingWindowService.setTickerListener((symbol, price, changePercent) -> {
            JSObject data = new JSObject();
            data.put("symbol", symbol);
            data.put("price", price);
            data.put("changePercent", changePercent);
            
            // Notify JS listeners (must be on main thread for Capacitor)
            getActivity().runOnUiThread(() -> {
                notifyListeners("tickerUpdate", data);
            });
        });
    }
    
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        FloatingWindowService.setTickerListener(null);
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

        Context context = getContext();
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
    public void start(PluginCall call) {
        // Now "start" means show the floating window
        Context context = getContext();
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
        Context context = getContext();
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
