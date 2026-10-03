package fr.soaresden.fuelmap.auto;

import fr.soaresden.fuelmap.diag.Diag;
import android.annotation.SuppressLint;
import android.app.Presentation;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.hardware.display.VirtualDisplay;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.car.app.SurfaceCallback;
import androidx.car.app.SurfaceContainer;

import java.io.InputStream;
import java.util.Locale;

/**
 * Dessine la vraie appli web FuelMap (mode voiture) sur la surface fournie par Android Auto :
 * surface → écran virtuel privé → Presentation → WebView. C'est la technique des navigateurs web
 * pour Android Auto (AASuite, Fermata) : l'hôte affiche l'écran virtuel pixel pour pixel.
 * La page est servie depuis les fichiers embarqués sous https://localhost/ (même origine que l'appli
 * téléphone Capacitor) : véhicule, favoris et dernier trajet sont partagés avec le téléphone.
 * Les gestes de l'hôte (glisser, pincer, toucher) sont relayés à la page.
 * Journal : adb logcat -s FuelMapCar
 */
public class CarWebSurface implements SurfaceCallback {
    static final String TAG = "FuelMapCar";
    public interface TargetListener { void onTarget(double lat, double lon, String label); void onNavigate(double lat, double lon, String label); void onSearch(); void onOpenMaps(double lat, double lon, String label); }

    private final Context ctx;
    private final TargetListener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private VirtualDisplay display;
    private Presentation presentation;
    private WebView web;
    private int width, height;
    private Rect visible; // dernière zone visible annoncée par l'hôte, renvoyée à la page une fois chargée
    private long downTime; private Surface curSurface;
    private float lastTapX, lastTapY; private long lastTapAt;

    public CarWebSurface(Context ctx, TargetListener listener) { this.ctx = ctx; this.listener = listener; }

    @Override
    public void onSurfaceAvailable(@NonNull SurfaceContainer sc) {
        Surface surface = sc.getSurface();
        Diag.i(TAG, "onSurfaceAvailable " + sc.getWidth() + "x" + sc.getHeight() + " dpi=" + sc.getDpi() + " surface=" + surface);
        if (surface == null) return;
        int w = sc.getWidth(), h = sc.getHeight(), dpi = sc.getDpi();
        main.post(() -> attach(surface, w, h, dpi));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void attach(Surface surface, int w, int h, int dpi) {
        curSurface = surface;
        // Retour de l'hôte (après Y aller, un autre écran…) avec la même taille : l'écran virtuel et la page n'ont pas bougé,
        // on lui redonne simplement la nouvelle surface. Déplacer la WebView d'une fenêtre à l'autre la laisse dessinée en petit.
        if (display != null && web != null && presentation != null && width == w && height == h) {
            try { display.setSurface(surface); Diag.i(TAG, "surface rebranchée (page conservée)"); if (visible != null) sendInsets(visible); web.invalidate(); return; }
            catch (Exception e) { Diag.w(TAG, "rebranchement impossible, on recrée : " + e); }
        }
        release(true);
        width = w; height = h;
        try {
            DisplayManager dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
            // La résolution de l'écran virtuel doit être exactement celle de la surface (sinon l'hôte rogne).
            display = dm.createVirtualDisplay("FuelMapCar", w, h, dpi, surface,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY);
            Diag.i(TAG, "virtual display " + display.getDisplay());
            presentation = new Presentation(ctx, display.getDisplay());
            if (presentation.getWindow() != null) {
                presentation.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.parseColor("#0b1220"))); // jamais de blanc autour de la page
                presentation.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED); // rendu GPU : fluidité de la carte
            }
            web = new WebView(presentation.getContext());
            web.setBackgroundColor(Color.parseColor("#0b1220")); // visible même si la page ne charge pas : distingue « rien n'est dessiné » de « page vide »
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setGeolocationEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            web.setWebChromeClient(new WebChromeClient() {
                @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) { cb.invoke(origin, true, false); }
                @Override public boolean onConsoleMessage(ConsoleMessage m) { Diag.i(TAG, "js: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")"); return true; }
            });
            web.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) { return serveAsset(req); }
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) { return handleExternal(req.getUrl()); }
                @Override public void onPageFinished(WebView v, String url) { Diag.i(TAG, "page chargée " + url); if (stable != null) sendStable(stable); if (visible != null) sendInsets(visible); }
                @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) { if (!req.getUrl().getPath().startsWith("/icons/brands/")) Diag.w(TAG, "erreur " + req.getUrl() + " : " + err.getDescription()); }
                @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) { Diag.e(TAG, "renderer perdu (crash=" + d.didCrash() + ")"); main.post(() -> { release(true); attach(curSurface != null ? curSurface : surface, w, h, dpi); }); return true; }
            });
            web.addJavascriptInterface(new Object() {
                @JavascriptInterface public void setTarget(double lat, double lon, String label) { Diag.i(TAG, "cible ← page : " + label + " (" + lat + "," + lon + ")"); main.post(() -> listener.onTarget(lat, lon, label)); }
                @JavascriptInterface public void search() { main.post(listener::onSearch); }
                @JavascriptInterface public void openMaps(double lat, double lon, String label) { main.post(() -> listener.onOpenMaps(lat, lon, label)); }
            }, "AndroidAuto");
            presentation.setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            presentation.show();
            Diag.i(TAG, "presentation affichée, chargement de la page");
            web.loadUrl("https://localhost/index.html?car=1&aa=1");
        } catch (Exception e) {
            Diag.e(TAG, "échec de l'écran virtuel", e);
        }
    }

    /**
     * Un lien Waze / Google Maps de la page (boutons « Y aller ») ne doit pas ouvrir un site web sur l'écran de la voiture :
     * on en extrait la destination et on la confie à l'appli de navigation de la voiture. Tout autre lien externe est ignoré.
     */
    private boolean handleExternal(Uri u) {
        String host = u.getHost() == null ? "" : u.getHost();
        if (host.equals("localhost")) return false;
        double[] ll = null; String q;
        if (host.endsWith("waze.com") && (q = u.getQueryParameter("ll")) != null) ll = parseLatLon(q);
        else if (host.contains("google.") && (q = u.getQueryParameter("destination")) != null) ll = parseLatLon(q);
        else if ("geo".equals(u.getScheme()) && u.getSchemeSpecificPart() != null) ll = parseLatLon(u.getSchemeSpecificPart().split("\\?")[0]);
        if (ll != null) { final double[] f = ll; Diag.i(TAG, "lien de navigation vers " + f[0] + "," + f[1]); main.post(() -> listener.onOpenMaps(f[0], f[1], null)); }
        else Diag.i(TAG, "lien externe ignoré : " + u);
        return true;
    }

    private static double[] parseLatLon(String s) {
        try { String[] p = s.split(","); return new double[] { Double.parseDouble(p[0].trim()), Double.parseDouble(p[1].trim()) }; } catch (Exception e) { return null; }
    }

    /** Sert les fichiers de l'appli (assets/public) sous https://localhost, comme le fait Capacitor pour le téléphone. */
    private WebResourceResponse serveAsset(WebResourceRequest req) {
        if (!"localhost".equals(req.getUrl().getHost())) return null;
        String path = req.getUrl().getPath(); if (path == null || path.equals("/")) path = "/index.html";
        try {
            InputStream in = ctx.getAssets().open("public" + path);
            String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT), mime;
            switch (ext) {
                case "html": mime = "text/html"; break; case "js": mime = "text/javascript"; break; case "css": mime = "text/css"; break;
                case "json": mime = "application/json"; break; case "svg": mime = "image/svg+xml"; break; case "png": mime = "image/png"; break;
                case "webmanifest": mime = "application/manifest+json"; break; default: mime = "application/octet-stream";
            }
            return new WebResourceResponse(mime, "utf-8", in);
        } catch (Exception e) {
            if (!path.startsWith("/icons/brands/")) Diag.w(TAG, "fichier absent : " + path); // logos de marque : optionnels, déposés par l'utilisateur
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null);
        }
    }

    @Override
    public void onSurfaceDestroyed(@NonNull SurfaceContainer sc) {
        Diag.i(TAG, "onSurfaceDestroyed (page conservée, surface détachée)");
        main.post(() -> { try { if (display != null) display.setSurface(null); } catch (Exception e) { Diag.w(TAG, "détachement : " + e); release(true); } });
    }

    /** Fin de la session Android Auto : on détruit la page. */
    public void destroy() { Diag.i(TAG, "destruction de la page"); main.post(() -> release(true)); }
    private void release(boolean destroyWeb) {
        if (web != null && web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
        if (presentation != null) { try { presentation.dismiss(); } catch (Exception ignored) { } presentation = null; }
        if (web != null) { web.destroy(); web = null; }
        if (display != null) { display.release(); display = null; }
    }

    /** Exécute du JavaScript dans la page (ex. intention de navigation reçue par la session). */
    public void run(String code) { js(code); }
    /** Évalue du JavaScript et rend le résultat (chaîne JSON, ou null si la page n'est pas là). */
    public void eval(String code, java.util.function.Consumer<String> cb) {
        main.post(() -> { if (web == null) { cb.accept(null); return; } try { web.evaluateJavascript(code, v -> cb.accept(v == null || "null".equals(v) ? null : v)); } catch (Exception e) { Diag.w(TAG, "eval : " + e); cb.accept(null); } });
    }

    private void js(String code) { main.post(() -> { if (web != null) web.evaluateJavascript(code, null); }); }

    @Override
    public void onVisibleAreaChanged(@NonNull Rect r) { Diag.i(TAG, "zone visible " + r); visible = new Rect(r); sendInsets(r); }

    private void sendInsets(Rect r) {
        js("window.__fuelmap&&window.__fuelmap.carInsets&&window.__fuelmap.carInsets(" + r.top + "," + (width - r.right) + "," + (height - r.bottom) + "," + r.left + ")");
    }

    @Override public void onStableAreaChanged(@NonNull Rect r) { Diag.i(TAG, "zone stable " + r); stable = r; sendStable(r); }
    private Rect stable;
    private void sendStable(Rect r) { js("window.__fuelmap&&window.__fuelmap.carStable&&window.__fuelmap.carStable(" + r.top + "," + (width - r.right) + "," + (height - r.bottom) + "," + r.left + ")"); }

    /* Gestes : l'hôte envoie des déplacements sans position ; la page décide (liste de gauche si le dernier toucher y était, sinon la carte). */
    @Override
    public void onScroll(float dx, float dy) { js("window.__fuelmapCar?window.__fuelmapCar.scroll(" + dx + "," + dy + "):window.__fuelmap&&window.__fuelmap.carPan&&window.__fuelmap.carPan(" + dx + "," + dy + ")"); }

    @Override
    public void onFling(float vx, float vy) { js("window.__fuelmapCar?window.__fuelmapCar.fling(" + vx + "," + vy + "):window.__fuelmap&&window.__fuelmap.carPan&&window.__fuelmap.carPan(" + (-vx / 8) + "," + (-vy / 8) + ")"); }

    @Override
    public void onScale(float x, float y, float scale) { js("window.__fuelmapCar?window.__fuelmapCar.zoom(" + scale + "," + x + "," + y + "):window.__fuelmap&&window.__fuelmap.carZoom&&window.__fuelmap.carZoom(" + scale + "," + x + "," + y + ")"); }

    @Override
    public void onClick(float x, float y) { // un toucher sur l'écran de la voiture = un toucher dans la page
        main.post(() -> {
            View target = decor(); if (target == null) return;
            lastTapX = x; lastTapY = y; lastTapAt = SystemClock.uptimeMillis();
            downTime = SystemClock.uptimeMillis();
            dispatch(target, MotionEvent.ACTION_DOWN, x, y); dispatch(target, MotionEvent.ACTION_UP, x, y);
        });
    }

    private View decor() { return presentation == null || presentation.getWindow() == null ? null : presentation.getWindow().getDecorView(); }

    private void dispatch(View target, int action, float x, float y) {
        MotionEvent ev = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0);
        ev.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        target.dispatchTouchEvent(ev); ev.recycle();
    }
}
