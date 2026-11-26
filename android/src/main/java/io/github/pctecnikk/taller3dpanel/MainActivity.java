package io.github.pctecnikk.taller3dpanel;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Taller3D Panel para Android: una ventana (WebView) que abre el Taller3D Panel instalado en tu servidor.
 * La primera vez pide la direccion del servidor y la guarda. Para cambiarla: boton Atras en la
 * pantalla principal, o mantener pulsado el icono de la app ("Cambiar servidor").
 * La web ve la version de la app en el User-Agent ("Taller3DPanelAndroid/x.y.z") y la muestra junto a la suya.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "taller3dpanel";
    private static final String KEY_URL = "server_url";
    static final String ACTION_CHANGE_SERVER = "io.github.pctecnikk.taller3dpanel.CHANGE_SERVER";
    private static final int REQ_FILES = 1;
    private static final int REQ_CAMERA = 2;
    private static final int BRAND = 0xFF5750F1;

    private SharedPreferences prefs;
    private FrameLayout root;
    private WebView web;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private boolean errorShown;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f3f4f8"));
        setContentView(root);
        String url = prefs.getString(KEY_URL, null);
        if (url == null || ACTION_CHANGE_SERVER.equals(getIntent().getAction())) askServer(url, null);
        else showWeb(url, state);
        if (state == null) Novedades.check(this, false, url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_CHANGE_SERVER.equals(intent.getAction())) askServer(prefs.getString(KEY_URL, null), null);
    }

    static String version(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    private int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }
    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    // ------------------------------------------------------------------ Pantalla de la direccion

    private void askServer(String current, String error) {
        if (web != null) { web.destroy(); web = null; }
        root.removeAllViews();
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(28), dp(48), dp(28), dp(28));
        box.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView logo = new TextView(this);
        logo.setText("Taller3D Panel");
        logo.setTextSize(26);
        logo.setTypeface(Typeface.DEFAULT_BOLD);
        logo.setTextColor(BRAND);
        box.addView(logo);

        TextView sub = new TextView(this);
        sub.setText(Lang.t(this, "Escribe la dirección de tu servidor Taller3D Panel.\nEn casa, por ejemplo 192.168.1.x:8095. Fuera de casa, tu dirección pública (https://…).",
                "Type the address of your Taller3D Panel server.\nAt home, for example 192.168.1.x:8095. Away from home, your public address (https://…)."));
        sub.setTextSize(15);
        sub.setTextColor(Color.parseColor("#646b80"));
        sub.setPadding(0, dp(12), 0, dp(20));
        box.addView(sub);

        final EditText input = new EditText(this);
        input.setHint("192.168.1.x:8095");
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        if (current != null) input.setText(current);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        final TextView err = new TextView(this);
        err.setTextColor(Color.parseColor("#ef4b4b"));
        err.setPadding(0, dp(8), 0, dp(8));
        if (error != null) err.setText(error);
        box.addView(err);

        final Button go = new Button(this);
        go.setText(Lang.t(this, "Conectar", "Connect"));
        go.setTextColor(Color.WHITE);
        go.setBackgroundColor(BRAND);
        box.addView(go, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        TextView ver = new TextView(this);
        ver.setText(Lang.t(this, "App Android ", "Android app ") + version(this) + Lang.t(this, "  ·  ¿Aún no tienes servidor? Mira github.com/pctecnikk/taller3dpanel", "  ·  No server yet? See github.com/pctecnikk/taller3dpanel"));
        ver.setTextSize(12);
        ver.setTextColor(Color.parseColor("#646b80"));
        ver.setPadding(0, dp(24), 0, 0);
        ver.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { openExternal(Uri.parse(Novedades.REPO)); } });
        box.addView(ver);

        // Idioma: español o inglés (la web usa el mismo)
        final TextView lang = new TextView(this);
        lang.setText(Lang.en(this) ? "🇪🇸  Cambiar a español" : "🇬🇧  Switch to English");
        lang.setTextSize(15);
        lang.setTextColor(BRAND);
        lang.setPadding(0, dp(20), 0, dp(8));
        lang.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) {
            Lang.set(MainActivity.this, Lang.en(MainActivity.this) ? "es" : "en");
            askServer(input.getText().toString(), null);
        } });
        box.addView(lang);

        final Runnable submit = new Runnable() { @Override public void run() {
            final String u = normalize(input.getText().toString());
            if (u == null) { err.setText(Lang.t(MainActivity.this, "Escribe una dirección válida", "Type a valid address")); return; }
            go.setEnabled(false); go.setText(Lang.t(MainActivity.this, "Comprobando…", "Checking…")); err.setText("");
            check(u, new Done() { @Override public void done(boolean ok, String msg) {
                go.setEnabled(true); go.setText(Lang.t(MainActivity.this, "Conectar", "Connect"));
                if (ok) { prefs.edit().putString(KEY_URL, u).apply(); showWeb(u, null); }
                else err.setText(msg);
            } });
        } };
        go.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { submit.run(); } });
        input.setOnEditorActionListener(new TextView.OnEditorActionListener() { @Override public boolean onEditorAction(TextView v, int a, KeyEvent e) { submit.run(); return true; } });
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    static String normalize(String s) {
        s = s == null ? "" : s.trim();
        if (s.isEmpty()) return null;
        if (!s.matches("(?i)^https?://.*")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        try { Uri u = Uri.parse(s); if (u.getHost() == null || u.getHost().isEmpty()) return null; } catch (Exception e) { return null; }
        return s;
    }

    interface Done { void done(boolean ok, String msg); }

    /** Comprueba que en esa direccion responde un Taller3D Panel (GET /api/me). */
    private void check(final String base, final Done cb) {
        new Thread(new Runnable() { @Override public void run() {
            boolean ok = false; String msg;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/me").openConnection();
                c.setConnectTimeout(6000); c.setReadTimeout(6000);
                int code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                byte[] b = new byte[4096]; int n = in == null ? 0 : in.read(b);
                String body = n > 0 ? new String(b, 0, n, "UTF-8") : "";
                ok = code == 200 && body.contains("\"version\"");
                msg = ok ? null : Lang.t(MainActivity.this, "En esa dirección no hay un Taller3D Panel (respuesta ", "There is no Taller3D Panel at that address (response ") + code + ")";
            } catch (Exception e) {
                msg = Lang.t(MainActivity.this, "No se puede conectar. ¿Está encendido el servidor y estás en la misma red?", "Cannot connect. Is the server on and are you on the same network?");
            }
            final boolean fOk = ok; final String fMsg = msg;
            main.post(new Runnable() { @Override public void run() { cb.done(fOk, fMsg); } });
        } }).start();
    }

    // ------------------------------------------------------------------ La web

    private void showWeb(final String base, Bundle state) {
        root.removeAllViews();
        errorShown = false;
        web = new WebView(this);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(progress, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " Taller3DPanelAndroid/" + version(this));
        web.addJavascriptInterface(new Lang.Bridge(this), "T3DApp");
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        final String host = Uri.parse(base).getHost();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String sc = u.getScheme();
                if (("http".equals(sc) || "https".equals(sc)) && host != null && host.equalsIgnoreCase(u.getHost())) return false;
                openExternal(u); // WhatsApp, enlaces de fabricantes, mailto:, tel:...
                return true;
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError e) {
                if (req.isForMainFrame()) showConnectionError(base);
            }
            @Override
            public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }
            /** Cámara para leer QR y códigos de barras desde la web. */
            @Override
            public void onPermissionRequest(final PermissionRequest r) {
                main.post(new Runnable() { @Override public void run() {
                    boolean wantsCam = false;
                    for (String res : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) wantsCam = true;
                    if (!wantsCam) { r.deny(); return; }
                    if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        pendingPermission = r;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    } else r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } });
            }
            /** Elegir fotos (piezas, logo), archivos STL/3MF y copias de seguridad. */
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i;
                try { i = params.createIntent(); } catch (Exception e) { i = new Intent(Intent.ACTION_GET_CONTENT); i.setType("*/*"); }
                String[] types = params.getAcceptTypes();
                boolean image = types != null && types.length > 0 && types[0] != null && types[0].startsWith("image");
                if (!image) { i = new Intent(Intent.ACTION_GET_CONTENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*"); }
                try { startActivityForResult(Intent.createChooser(i, "Elegir archivo"), REQ_FILES); }
                catch (ActivityNotFoundException e) { fileCallback = null; toast(Lang.t(MainActivity.this, "No hay ninguna app para elegir archivos", "There is no app to choose files")); return false; }
                return true;
            }
        });

        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String disposition, String mime, long length) {
                download(url, userAgent, disposition, mime);
            }
        });

        if (state == null) Toast.makeText(this, Lang.t(this, "Taller3D Panel · App Android ", "Taller3D Panel · Android app ") + version(this), Toast.LENGTH_SHORT).show();
        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(base + "/");
    }

    /** Tickets, presupuestos, CSV y etiquetas: se guardan en Descargas con el gestor de descargas de Android. */
    private void download(String url, String ua, String disposition, String mime) {
        if (url != null && url.matches("(?i).*/app/Taller3DPanel\\.apk(\\?.*)?$")) { Novedades.install(this, url, "nueva"); return; }
        try {
            String name = fileName(disposition);
            if (name == null) name = URLUtil.guessFileName(url, disposition, mime);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            r.addRequestHeader("User-Agent", ua);
            r.setTitle(name);
            r.setMimeType(mime);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            toast(Lang.t(this, "Descargando " + name + " en Descargas", "Downloading " + name + " to Downloads"));
        } catch (Exception e) {
            toast(Lang.t(this, "No se pudo descargar: ", "Could not download: ") + e.getMessage());
        }
    }

    static String fileName(String disposition) {
        if (disposition == null) return null;
        Matcher m = Pattern.compile("filename\\*=UTF-8''([^;]+)").matcher(disposition);
        try { if (m.find()) return java.net.URLDecoder.decode(m.group(1), "UTF-8"); } catch (Exception ignored) { }
        m = Pattern.compile("filename=\"?([^\";]+)\"?").matcher(disposition);
        return m.find() ? m.group(1) : null;
    }

    private void openExternal(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) { toast(Lang.t(this, "No hay ninguna app para abrir este enlace", "There is no app to open this link")); }
    }

    private void showConnectionError(final String base) {
        if (errorShown) return;
        errorShown = true;
        new AlertDialog.Builder(this)
                .setTitle(Lang.t(this, "No se puede conectar", "Cannot connect"))
                .setMessage(Lang.t(this, "No responde " + base + ".\n¿Está encendido el servidor? Si estás fuera de casa, usa tu dirección pública.", base + " is not responding.\nIs the server on? If you are away from home, use your public address."))
                .setPositiveButton(Lang.t(this, "Reintentar", "Retry"), (d, w) -> { errorShown = false; if (web != null) web.loadUrl(base + "/"); })
                .setNeutralButton(Lang.t(this, "Cambiar dirección", "Change address"), (d, w) -> askServer(base, null))
                .setCancelable(false)
                .show();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILES && fileCallback != null) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    out = new Uri[data.getClipData().getItemCount()];
                    for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) out = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_CAMERA && pendingPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
                pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else { pendingPermission.deny(); toast(Lang.t(this, "Sin permiso de cámara no se pueden leer códigos con la cámara", "Without camera permission codes cannot be read with the camera")); }
            pendingPermission = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        if (web != null) {
            new AlertDialog.Builder(this)
                    .setItems(Lang.en(this) ? new String[]{"Exit the app", "Change server", "What's new and version", "Idioma: español"}
                                            : new String[]{"Salir de la app", "Cambiar servidor", "Novedades y versión", "Language: English"}, (d, w) -> {
                        if (w == 0) finish();
                        else if (w == 1) askServer(prefs.getString(KEY_URL, null), null);
                        else if (w == 2) Novedades.check(this, true, prefs.getString(KEY_URL, null));
                        else { String nl = Lang.en(this) ? "es" : "en"; Lang.set(this, nl); if (web != null) web.evaluateJavascript("window.setLang&&setLang('" + nl + "')", null); }
                    }).show();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
