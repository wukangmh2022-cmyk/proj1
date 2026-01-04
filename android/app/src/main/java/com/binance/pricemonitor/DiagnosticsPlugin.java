package com.binance.pricemonitor;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Diagnostics")
public class DiagnosticsPlugin extends Plugin {

    @PluginMethod
    public void appendLog(PluginCall call) {
        String text = call.getString("text", "");
        DiagnosticsLog.append(getContext().getApplicationContext(), "[js] " + text);
        call.resolve();
    }

    @PluginMethod
    public void getLogs(PluginCall call) {
        int maxBytes = call.getInt("maxBytes", 65536);
        String logs = DiagnosticsLog.read(getContext().getApplicationContext(), maxBytes);
        JSObject ret = new JSObject();
        ret.put("text", logs);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearLogs(PluginCall call) {
        DiagnosticsLog.clear(getContext().getApplicationContext());
        call.resolve();
    }
}

