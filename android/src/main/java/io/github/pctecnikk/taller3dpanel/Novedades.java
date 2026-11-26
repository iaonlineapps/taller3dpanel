package io.github.pctecnikk.taller3dpanel;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Version de la app y aviso de versiones nuevas. Las versiones se publican en las Releases del repo
 * con etiquetas "android-vX.Y.Z" (las crea el workflow de GitHub al cambiar la version).
 */
final class Novedades {
    static final String REPO = "https://github.com/pctecnikk/taller3dpanel";
    static final String RELEASES_PAGE = REPO + "/releases";
    private static final String API = "https://api.github.com/repos/pctecnikk/taller3dpanel/releases?per_page=20";
    private static final String KEY_LAST = "update_last_check";
    private static final String KEY_SKIP = "update_skipped";
    private static final long EVERY_MS = 12L * 60 * 60 * 1000;

    private Novedades() { }

    /** Compara "1.2.10" con "1.2.9" numero a numero. */
    static int compare(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }
    private static int parse(String s) { try { return Integer.parseInt(s.replaceAll("\\D", "")); } catch (Exception e) { return 0; } }

    /** manual=true: lo pide la persona (muestra siempre el resultado). */
    static void check(final Activity a, final boolean manual) {
        final SharedPreferences p = a.getSharedPreferences("taller3dpanel", Activity.MODE_PRIVATE);
        if (!manual && System.currentTimeMillis() - p.getLong(KEY_LAST, 0) < EVERY_MS) return;
        p.edit().putLong(KEY_LAST, System.currentTimeMillis()).apply();
        final String mine = MainActivity.version(a);
        new Thread(new Runnable() { @Override public void run() {
            String latest = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(API).openConnection();
                c.setConnectTimeout(8000); c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "Taller3DPanelAndroid/" + mine);
                InputStream in = c.getInputStream();
                ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
                while ((n = in.read(b)) > 0) bo.write(b, 0, n);
                Matcher m = Pattern.compile("\"tag_name\"\\s*:\\s*\"android-v([0-9.]+)\"").matcher(bo.toString("UTF-8"));
                while (m.find()) if (latest == null || compare(m.group(1), latest) > 0) latest = m.group(1);
            } catch (Exception ignored) { }
            final String fLatest = latest;
            new Handler(Looper.getMainLooper()).post(new Runnable() { @Override public void run() {
                if (a.isFinishing()) return;
                boolean newer = fLatest != null && compare(fLatest, mine) > 0;
                if (newer && (manual || !fLatest.equals(p.getString(KEY_SKIP, "")))) {
                    new AlertDialog.Builder(a).setTitle("Hay una versión nueva: " + fLatest)
                            .setMessage("Tienes la " + mine + ". Descarga la nueva APK e instálala encima: no se pierde nada.")
                            .setPositiveButton("Descargar", (d, w) -> a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_PAGE + "/tag/android-v" + fLatest))))
                            .setNegativeButton("Ahora no", (d, w) -> p.edit().putString(KEY_SKIP, fLatest).apply())
                            .show();
                } else if (manual) {
                    new AlertDialog.Builder(a).setTitle("Taller3D Panel · App Android " + mine)
                            .setMessage(fLatest == null ? "No he podido comprobar si hay versiones nuevas." : "Tienes la última versión.")
                            .setPositiveButton("Ver novedades", (d, w) -> a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_PAGE))))
                            .setNegativeButton("Cerrar", null).show();
                }
            } });
        } }).start();
    }
}
