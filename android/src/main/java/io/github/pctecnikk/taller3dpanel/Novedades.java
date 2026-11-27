package io.github.pctecnikk.taller3dpanel;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Versión de la app y aviso de versiones nuevas.
 * La APK nueva viaja con la web: el servidor sirve app/version.json ({"version":"x.y.z"}) y
 * app/Taller3DPanel.apk. Al abrir la app se compara con la propia versión y, si hay una nueva,
 * sale «Hay una actualización» con «Actualizar»: se descarga y se abre el instalador.
 * Si el servidor no la tiene, se mira en las Releases de GitHub (etiquetas android-vX.Y.Z).
 */
final class Novedades {
    static final String REPO = "https://github.com/iaonlineapps/taller3dpanel";
    static final String RELEASES_PAGE = REPO + "/releases";
    private static final String API = "https://api.github.com/repos/iaonlineapps/taller3dpanel/releases?per_page=20";
    private static final String KEY_SKIP = "update_skipped";
    private static final String KEY_SKIP_AT = "update_skipped_at";
    private static final long SKIP_MS = 24L * 60 * 60 * 1000;

    private Novedades() { }

    /** Compara "1.2.10" con "1.2.9" número a número. */
    static int compare(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }
    private static int parse(String s) { try { return Integer.parseInt(s.replaceAll("\\D", "")); } catch (Exception e) { return 0; } }

    private static String get(String url, String ua) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(8000);
        c.setUseCaches(false);
        c.setRequestProperty("User-Agent", ua);
        c.setRequestProperty("Accept", "application/json, application/vnd.github+json");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        InputStream in = c.getInputStream();
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) > 0) bo.write(b, 0, n);
        return bo.toString("UTF-8");
    }

    /** manual=true: lo pide la persona (muestra siempre el resultado). base: dirección del servidor (o null). */
    static void check(final Activity a, final boolean manual, final String base) {
        final SharedPreferences p = a.getSharedPreferences("taller3dpanel", Activity.MODE_PRIVATE);
        final String mine = MainActivity.version(a);
        final String ua = "Taller3DPanelAndroid/" + mine;
        new Thread(new Runnable() { @Override public void run() {
            String latest = null, apk = null;
            if (base != null) try {
                Matcher m = Pattern.compile("\"version\"\\s*:\\s*\"([0-9.]+)\"").matcher(get(base + "/app/version.json", ua));
                if (m.find()) { latest = m.group(1); apk = base + "/app/Taller3DPanel.apk"; }
            } catch (Exception ignored) { }
            try {
                Matcher m = Pattern.compile("\"tag_name\"\\s*:\\s*\"android-v([0-9.]+)\"").matcher(get(API, ua));
                String gh = null;
                while (m.find()) if (gh == null || compare(m.group(1), gh) > 0) gh = m.group(1);
                if (gh != null && (latest == null || compare(gh, latest) > 0)) { latest = gh; apk = null; }
            } catch (Exception ignored) { }
            final String fLatest = latest, fApk = apk;
            new Handler(Looper.getMainLooper()).post(new Runnable() { @Override public void run() {
                if (a.isFinishing()) return;
                boolean newer = fLatest != null && compare(fLatest, mine) > 0;
                boolean skipped = fLatest != null && fLatest.equals(p.getString(KEY_SKIP, ""))
                        && System.currentTimeMillis() - p.getLong(KEY_SKIP_AT, 0) < SKIP_MS;
                if (newer && (manual || !skipped)) {
                    new AlertDialog.Builder(a)
                            .setTitle(Lang.t(a, "Hay una actualización: ", "Update available: ") + fLatest)
                            .setMessage(Lang.t(a, "Tienes la " + mine + ". Pulsa «Actualizar»: se descarga la nueva y se abre el instalador. Se instala encima y no se pierde nada.",
                                    "You have " + mine + ". Tap «Update»: the new one is downloaded and the installer opens. It installs on top and nothing is lost."))
                            .setPositiveButton(Lang.t(a, "Actualizar", "Update"), (d, w) -> {
                                if (fApk != null) install(a, fApk, fLatest);
                                else a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(RELEASES_PAGE + "/tag/android-v" + fLatest)));
                            })
                            .setNegativeButton(Lang.t(a, "Ahora no", "Not now"), (d, w) -> p.edit().putString(KEY_SKIP, fLatest).putLong(KEY_SKIP_AT, System.currentTimeMillis()).apply())
                            .show();
                } else if (manual) {
                    new AlertDialog.Builder(a).setTitle(Lang.t(a, "Taller3D Panel · App Android ", "Taller3D Panel · Android app ") + mine)
                            .setMessage(fLatest == null ? Lang.t(a, "No he podido comprobar si hay versiones nuevas.", "I could not check for new versions.") : Lang.t(a, "Tienes la última versión.", "You have the latest version."))
                            .setNegativeButton(Lang.t(a, "Cerrar", "Close"), null).show();
                }
            } });
        } }).start();
    }

    /** Descarga la APK con el gestor de descargas y, al terminar, abre el instalador de Android. */
    static void install(final Activity a, String url, String ver) {
        try {
            final DownloadManager dm = (DownloadManager) a.getSystemService(Context.DOWNLOAD_SERVICE);
            String name = "Taller3DPanel-" + ver + ".apk";
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle(name);
            r.setMimeType("application/vnd.android.package-archive");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            final long id = dm.enqueue(r);
            Toast.makeText(a, Lang.t(a, "Descargando la actualización…", "Downloading the update…"), Toast.LENGTH_LONG).show();
            BroadcastReceiver done = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                    try { a.getApplicationContext().unregisterReceiver(this); } catch (Exception ignored) { }
                    Uri u = dm.getUriForDownloadedFile(id);
                    if (u == null) { Toast.makeText(a, Lang.t(a, "No se pudo descargar la actualización", "Could not download the update"), Toast.LENGTH_LONG).show(); return; }
                    Intent in = new Intent(Intent.ACTION_VIEW);
                    in.setDataAndType(u, "application/vnd.android.package-archive");
                    in.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { a.startActivity(in); }
                    catch (Exception e) { Toast.makeText(a, Lang.t(a, "Ábrela desde Descargas para instalarla", "Open it from Downloads to install it"), Toast.LENGTH_LONG).show(); }
                }
            };
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) a.getApplicationContext().registerReceiver(done, f, Context.RECEIVER_EXPORTED);
            else a.getApplicationContext().registerReceiver(done, f);
        } catch (Exception e) {
            Toast.makeText(a, Lang.t(a, "No se pudo descargar: ", "Could not download: ") + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
