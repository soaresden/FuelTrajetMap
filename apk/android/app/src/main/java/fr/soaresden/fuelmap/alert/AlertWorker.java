package fr.soaresden.fuelmap.alert;

import fr.soaresden.fuelmap.diag.Diag;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import fr.soaresden.fuelmap.R;
import fr.soaresden.fuelmap.auto.FuelData;

/**
 * Alerte carburant : toutes les 15 min (WorkManager), on demande à l'État les stations de la zone choisie
 * (clé « alert » des Preferences : { lat, lon, radiusKm, fuels[], label }) dont un prix compatible a été mis à jour
 * depuis le dernier passage et qui ne déclarent pas de rupture : un prix tout frais = il y a du carburant.
 * Une notification par passage au plus, pour la moins chère ; les stations déjà annoncées avec la même heure de prix
 * ne sont pas répétées. Aucune position en arrière-plan : la zone est fixée au moment de l'activation.
 */
public class AlertWorker extends Worker {
    static final String TAG = "FuelMapAlert", CHANNEL = "fuel_alert", PREFS = "fuelmap_alert";

    public AlertWorker(@NonNull Context ctx, @NonNull WorkerParameters p) { super(ctx, p); }

    @NonNull
    @Override
    public Result doWork() {
        Diag.init(getApplicationContext());
        Context ctx = getApplicationContext();
        try {
            JSONObject a = config(ctx); if (a == null) return Result.success();
            SharedPreferences st = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            boolean test = getInputData().getBoolean("test", false);
            long since = test ? System.currentTimeMillis() - 6L * 3600000 : st.getLong("since", System.currentTimeMillis() - 3600000);
            List<Hit> hits = query(ctx, a, since - 120000); // 2 min de recouvrement
            st.edit().putLong("since", System.currentTimeMillis()).apply();
            JSONObject seen = new JSONObject(st.getString("seen", "{}"));
            List<Hit> fresh = new ArrayList<>();
            for (Hit h : hits) if (test || !h.maj.equals(seen.optString(h.id))) fresh.add(h);
            if (fresh.isEmpty()) { Diag.i(TAG, "rien de neuf (" + hits.size() + " à jour, déjà annoncées)"); return Result.success(); }
            for (Hit h : fresh) seen.put(h.id, h.maj);
            st.edit().putString("seen", seen.toString()).apply();
            notifyUser(ctx, a, fresh);
            return Result.success();
        } catch (Exception e) {
            Diag.w(TAG, "échec : " + e.getMessage());
            return Result.retry();
        }
    }

    static JSONObject config(Context ctx) {
        try { String raw = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("alert", null); return raw == null ? null : new JSONObject(raw); }
        catch (Exception e) { return null; }
    }

    static class Hit { String id, fuel, maj, ville, adresse, brand; double price, lat, lon, distKm; Boolean open; }

    /** Stations de la zone avec un prix compatible mis à jour depuis `sinceMs` et sans rupture, la moins chère d'abord. */
    static List<Hit> query(Context ctx, JSONObject a, long sinceMs) throws Exception {
        SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US); df.setTimeZone(TimeZone.getTimeZone("Europe/Paris")); // heures publiées = heure de Paris
        String since = df.format(new Date(sinceMs));
        JSONArray fuels = a.getJSONArray("fuels"); double lat = a.getDouble("lat"), lon = a.getDouble("lon"), radius = a.optDouble("radiusKm", 2);
        StringBuilder or = new StringBuilder(), sel = new StringBuilder("id,latitude,longitude,adresse,ville,horaires_jour,horaires_automate_24_24");
        for (int i = 0; i < fuels.length(); i++) {
            String f = fuels.getString(i);
            or.append(i > 0 ? " OR " : "").append("(").append(f).append("_maj >= '").append(since).append("' AND ").append(f).append("_prix IS NOT NULL AND ").append(f).append("_rupture_type IS NULL)");
            sel.append(",").append(f).append("_prix,").append(f).append("_maj");
        }
        String where = "within_distance(geom, geom'POINT(" + lon + " " + lat + ")', " + radius + "km) AND (" + or + ")";
        String url = FuelData.ODS + "?select=" + URLEncoder.encode(sel.toString(), "UTF-8") + "&where=" + URLEncoder.encode(where, "UTF-8") + "&limit=50";
        JSONArray rows = new JSONObject(FuelData.fetch(url)).getJSONArray("results");
        JSONObject brands = FuelData.brands(ctx), habits = FuelData.habits(ctx);
        List<Hit> out = new ArrayList<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.getJSONObject(i); Hit best = null;
            for (int k = 0; k < fuels.length(); k++) {
                String f = fuels.getString(k); double p = r.optDouble(f + "_prix"); String maj = r.optString(f + "_maj", "");
                if (!(p > 0.3 && p < 5) || maj.compareTo(since) < 0) continue;
                if (best == null || p < best.price) { best = new Hit(); best.fuel = f; best.price = p; best.maj = maj; }
            }
            if (best == null) continue;
            best.id = String.valueOf(r.optLong("id"));
            if (FuelData.isAutoUpdate(habits, best.id, best.maj.length() >= 16 ? best.maj.substring(11, 16) : "")) { Diag.i(TAG, "passage automatique ignoré : " + best.id + " " + best.maj); continue; } // TotalEnergies 00:01 & co : ne prouve rien
            Boolean open = FuelData.openNow(r.optString("horaires_jour", ""), "Oui".equals(r.optString("horaires_automate_24_24")));
            if (Boolean.FALSE.equals(open)) { Diag.i(TAG, "fermée à cette heure, ignorée : " + best.id); continue; } // inutile d'y aller
            best.open = open;
            best.ville = FuelData.title(r.optString("ville")); best.adresse = FuelData.title(r.optString("adresse"));
            best.lat = r.optDouble("latitude") / 1e5; best.lon = r.optDouble("longitude") / 1e5; best.distKm = FuelData.haversine(lat, lon, best.lat, best.lon);
            best.brand = brands != null ? brands.optString(best.id, "") : "";
            out.add(best);
        }
        out.sort((x, y) -> Double.compare(x.price, y.price));
        return out;
    }

    void notifyUser(Context ctx, JSONObject a, List<Hit> fresh) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Alerte carburant", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Une station proche vient de mettre son prix à jour : il y a du carburant."); nm.createNotificationChannel(ch);
        }
        Hit h = fresh.get(0);
        String label = FuelData.fuelLabel(h.fuel), price = String.format(Locale.FRANCE, "%.3f", h.price), hm = h.maj.length() >= 16 ? localTime(h.maj) : "";
        String title = "⛽ " + label + " à " + price + " € à " + h.ville + " — gogogo !";
        String text = (h.brand.isEmpty() ? "" : h.brand + " · ") + h.adresse + " · " + String.format(Locale.FRANCE, "%.1f", h.distKm) + " km · prix mis à jour à " + hm + (Boolean.TRUE.equals(h.open) ? " · ouverte" : " · horaires inconnus")
            + (fresh.size() > 1 ? " · +" + (fresh.size() - 1) + " autre" + (fresh.size() > 2 ? "s" : "") + " station" + (fresh.size() > 2 ? "s" : "") + " à jour" : "");
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("fuelmap://station/" + h.id)).setPackage(ctx.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Intent nav = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:" + h.lat + "," + h.lon + "?q=" + h.lat + "," + h.lon + "(" + Uri.encode((h.brand.isEmpty() ? "" : h.brand + " ") + h.ville) + ")")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_fuel).setContentTitle(title).setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_RECOMMENDATION).setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(ctx, 1, open, flags))
            .addAction(0, "🧭 Y aller", PendingIntent.getActivity(ctx, 2, nav, flags))
            .build();
        nm.notify(4210, n);
        Diag.i(TAG, "notification : " + title);
    }

    static String localTime(String iso) { return iso.length() >= 16 ? iso.substring(11, 16) : ""; } // déjà en heure de Paris
}
