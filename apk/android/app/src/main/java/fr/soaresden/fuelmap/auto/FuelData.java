package fr.soaresden.fuelmap.auto;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Données pour l'écran voiture. Indépendant de la WebView : l'écran Android Auto peut s'ouvrir sans que
 * l'appli téléphone soit lancée. Prix : API open data de l'État autour de la position (France uniquement).
 * Enseignes : data/fr-brands.json du site publié, gardé 7 jours.
 */
public class FuelData {
    static final String SITE = "https://soaresden.github.io/FuelTrajetMap/";
    static final String ODS = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
    static final String[] FUEL_KEYS = {"gazole", "sp95", "e10", "sp98", "e85", "gplc"};
    static final String[] FUEL_LABELS = {"Gazole", "SP95", "SP95-E10", "SP98", "E85", "GPLc"};

    /** Véhicule actif, écrit par l'appli web via le plugin Preferences (clé « car » du CapacitorStorage). */
    public static class Car { public String name = "Ma voiture", fuel = "e10"; public double tank = 50, cons = 7; }

    public static Car readCar(Context ctx) {
        Car c = new Car();
        try {
            SharedPreferences sp = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            String raw = sp.getString("car", null);
            if (raw != null) {
                JSONObject j = new JSONObject(raw);
                c.name = j.optString("name", c.name); c.fuel = j.optString("fuel", c.fuel);
                c.tank = j.optDouble("tank", c.tank); c.cons = j.optDouble("cons", c.cons);
            }
        } catch (Exception ignored) { }
        return c;
    }

    /**
     * Abonnement FuelMap Plus : l'appli téléphone écrit { owned, until } (clé « license ») à chaque vérification auprès
     * de Google Play. Valide si possédé et pas expiré depuis plus de 3 jours (marge si le téléphone n'a pas relancé l'appli).
     */
    public static boolean licensed(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("license", null);
            if (raw == null) return false;
            JSONObject j = new JSONObject(raw);
            return j.optBoolean("owned") && j.optLong("until", Long.MAX_VALUE) + 3L * 86400000 > System.currentTimeMillis();
        } catch (Exception e) { return false; }
    }

    public static String fuelLabel(String key) {
        for (int i = 0; i < FUEL_KEYS.length; i++) if (FUEL_KEYS[i].equals(key)) return FUEL_LABELS[i];
        return key;
    }

    static String fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000); c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "FuelTrajetMap Android Auto");
        c.setRequestProperty("Accept-Encoding", "identity");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String line; while ((line = r.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    /** Stations avec un prix récent (≤ 7 jours) pour `fuel`, dans un rayon de `radiusKm`, triées par prix. */
    public static List<Station> stationsAround(Context ctx, double lat, double lon, String fuel, int radiusKm) throws Exception {
        SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd", Locale.US); df.setTimeZone(TimeZone.getTimeZone("UTC"));
        String since = df.format(new Date(System.currentTimeMillis() - 7L * 86400000));
        String where = "within_distance(geom, geom'POINT(" + lon + " " + lat + ")', " + radiusKm + "km) AND " + fuel + "_prix IS NOT NULL AND " + fuel + "_maj >= '" + since + "' AND " + fuel + "_rupture_type IS NULL"; // rupture déclarée : pas proposée
        String url = ODS + "?select=" + enc("id,latitude,longitude,adresse,ville,cp," + fuel + "_prix," + fuel + "_maj,horaires_automate_24_24")
            + "&where=" + enc(where) + "&order_by=" + enc(fuel + "_prix") + "&limit=100";
        JSONArray rows = new JSONObject(fetch(url)).getJSONArray("results");
        JSONObject brands = brands(ctx);
        List<Station> out = new ArrayList<>();
        long today = System.currentTimeMillis() / 86400000L;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.getJSONObject(i);
            Station s = new Station();
            s.id = String.valueOf(r.optLong("id"));
            s.lat = r.optDouble("latitude") / 1e5; s.lon = r.optDouble("longitude") / 1e5;
            s.price = r.optDouble(fuel + "_prix");
            if (!(s.price > 0.3 && s.price < 5)) continue;
            s.ville = title(r.optString("ville")); s.adresse = title(r.optString("adresse"));
            s.auto24 = "Oui".equals(r.optString("horaires_automate_24_24"));
            s.brand = brands != null ? brands.optString(s.id, "") : "";
            s.distKm = haversine(lat, lon, s.lat, s.lon);
            try {
                String maj = r.optString(fuel + "_maj").substring(0, 10);
                SimpleDateFormat d2 = new SimpleDateFormat("yyyy-MM-dd", Locale.US); d2.setTimeZone(TimeZone.getTimeZone("UTC"));
                s.ageDays = (int) Math.max(0, today - d2.parse(maj).getTime() / 86400000L);
            } catch (Exception e) { s.ageDays = 0; }
            out.add(s);
        }
        return out;
    }

    static JSONObject brandsCache;
    static JSONObject brands(Context ctx) {
        if (brandsCache != null) return brandsCache;
        File f = new File(ctx.getFilesDir(), "fr-brands.json");
        try {
            if (!f.exists() || System.currentTimeMillis() - f.lastModified() > 7L * 86400000) {
                String body = fetch(SITE + "data/fr-brands.json");
                Files.write(f.toPath(), body.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { }
        try {
            if (f.exists()) brandsCache = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)).getJSONObject("map");
        } catch (Exception ignored) { }
        return brandsCache;
    }

    static String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }

    static double haversine(double aLat, double aLon, double bLat, double bLon) {
        double R = 6371, dLat = Math.toRadians(bLat - aLat), dLon = Math.toRadians(bLon - aLon);
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(aLat)) * Math.cos(Math.toRadians(bLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    static String title(String s) {
        StringBuilder b = new StringBuilder(); boolean up = true;
        for (char ch : s.toLowerCase(Locale.FRANCE).toCharArray()) {
            b.append(up ? Character.toUpperCase(ch) : ch);
            up = ch == ' ' || ch == '-' || ch == '\'';
        }
        return b.toString();
    }

    public static String price(double p) { return String.format(Locale.FRANCE, "%.3f €", p); }
    public static String age(int d) { return d == 0 ? "prix du jour" : d == 1 ? "prix d'hier" : "prix d'il y a " + d + " j"; }
}
