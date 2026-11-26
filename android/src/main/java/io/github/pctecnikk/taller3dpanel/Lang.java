package io.github.pctecnikk.taller3dpanel;

import android.content.Context;
import android.webkit.JavascriptInterface;

import java.util.Locale;

/**
 * Idioma de la app: español (España) o inglés. La app está siempre en los dos idiomas.
 * Se guarda en las preferencias ("lang"). Si no hay nada guardado, sigue el idioma del móvil.
 * La web lo lee y lo cambia con window.T3DApp (getLang / setLang), así el selector de la web y el de la app van juntos.
 */
final class Lang {
    private static final String KEY = "lang";

    static String get(Context c) {
        String l = c.getSharedPreferences("taller3dpanel", Context.MODE_PRIVATE).getString(KEY, null);
        if ("es".equals(l) || "en".equals(l)) return l;
        return "es".equals(Locale.getDefault().getLanguage()) ? "es" : "en";
    }

    static void set(Context c, String l) {
        if (!"es".equals(l) && !"en".equals(l)) return;
        c.getSharedPreferences("taller3dpanel", Context.MODE_PRIVATE).edit().putString(KEY, l).apply();
    }

    static boolean en(Context c) { return "en".equals(get(c)); }

    /** Texto en el idioma elegido. */
    static String t(Context c, String es, String en) { return en(c) ? en : es; }

    /** Puente para la web: window.T3DApp.getLang() / setLang("es"|"en"). */
    static final class Bridge {
        private final Context c;
        Bridge(Context c) { this.c = c.getApplicationContext(); }
        @JavascriptInterface public String getLang() { return get(c); }
        @JavascriptInterface public void setLang(String l) { set(c, l); }
    }

    private Lang() { }
}
