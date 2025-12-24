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
    public void update(PluginCall call) {
        String symbol = call.getString("symbol");
        String price = call.getString("price");
        String change = call.getString("change");

        Context context = getContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_UPDATE);
        intent.putExtra(FloatingWindowService.EXTRA_SYMBOL, symbol);
        intent.putExtra(FloatingWindowService.EXTRA_PRICE, price);
        intent.putExtra(FloatingWindowService.EXTRA_CHANGE, change);
        
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

        Context context = getContext();
        Intent intent = new Intent(context, FloatingWindowService.class);
        intent.setAction(FloatingWindowService.ACTION_CONFIG);
        intent.putExtra(FloatingWindowService.EXTRA_FONT_SIZE, fontSize);
        intent.putExtra(FloatingWindowService.EXTRA_OPACITY, opacity);
        intent.putExtra(FloatingWindowService.EXTRA_SHOW_SYMBOL, showSymbol);
        
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
