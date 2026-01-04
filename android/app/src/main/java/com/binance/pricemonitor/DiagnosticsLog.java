package com.binance.pricemonitor;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class DiagnosticsLog {
    private static final String FILE_NAME = "amaze_diag.log";
    private static final long MAX_BYTES = 512 * 1024; // 512KB

    private DiagnosticsLog() {}

    private static File getFile(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    public static synchronized void append(Context context, String line) {
        if (context == null) return;
        try {
            File file = getFile(context);
            if (file.exists() && file.length() > MAX_BYTES) {
                // Simple rotation: truncate by overwriting.
                // Keep it simple and reliable; we only need recent history.
                new FileOutputStream(file, false).close();
            }
            String ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
            String payload = ts + " " + (line == null ? "" : line) + "\n";
            try (FileOutputStream fos = new FileOutputStream(file, true)) {
                fos.write(payload.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Throwable ignored) {
            // Never crash app for diagnostics logging.
        }
    }

    public static synchronized String read(Context context, int maxBytes) {
        if (context == null) return "";
        try {
            File file = getFile(context);
            if (!file.exists()) return "";
            long len = file.length();
            int cap = maxBytes > 0 ? maxBytes : 65536;
            int toRead = (int) Math.min(len, cap);
            byte[] buf = new byte[toRead];
            try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(file, "r")) {
                raf.seek(Math.max(0, len - toRead));
                raf.readFully(buf);
            }
            return new String(buf, StandardCharsets.UTF_8);
        } catch (Throwable ignored) {
            return "";
        }
    }

    public static synchronized void clear(Context context) {
        if (context == null) return;
        try {
            File file = getFile(context);
            if (file.exists()) {
                new FileOutputStream(file, false).close();
            }
        } catch (Throwable ignored) {
        }
    }
}

