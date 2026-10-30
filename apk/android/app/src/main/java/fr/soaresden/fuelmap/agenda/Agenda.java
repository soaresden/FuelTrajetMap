package fr.soaresden.fuelmap.agenda;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import fr.soaresden.fuelmap.diag.Diag;

/**
 * Rendez-vous à venir qui ont un lieu (agenda du téléphone), pour choisir une destination sans rien écrire.
 * Rien ne quitte le téléphone ici : la page géocode seulement le lieu que l'utilisateur touche.
 * Résultat JSON : {"perm":false} sans autorisation, sinon {"perm":true,"events":[{"title","where","begin","allDay"}]}.
 */
public final class Agenda {
    private Agenda() { }

    public static boolean allowed(Context ctx) { return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED; }

    public static String read(Context ctx, int days) {
        JSONObject out = new JSONObject();
        try {
            if (!allowed(ctx)) { out.put("perm", false); return out.toString(); }
            long now = System.currentTimeMillis(), from = now - 3600_000L, to = now + days * 86_400_000L;
            Uri.Builder b = CalendarContract.Instances.CONTENT_URI.buildUpon();
            android.content.ContentUris.appendId(b, from); android.content.ContentUris.appendId(b, to);
            String[] cols = { CalendarContract.Instances.TITLE, CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.BEGIN, CalendarContract.Instances.ALL_DAY };
            JSONArray ev = new JSONArray();
            try (Cursor c = ctx.getContentResolver().query(b.build(), cols, CalendarContract.Instances.EVENT_LOCATION + " != ''", null, CalendarContract.Instances.BEGIN + " ASC")) {
                while (c != null && c.moveToNext() && ev.length() < 15) {
                    String where = c.getString(1); if (where == null || where.trim().isEmpty()) continue;
                    JSONObject o = new JSONObject();
                    o.put("title", c.getString(0) == null ? "" : c.getString(0)); o.put("where", where.trim()); o.put("begin", c.getLong(2)); o.put("allDay", c.getInt(3) == 1);
                    ev.put(o);
                }
            }
            out.put("perm", true); out.put("events", ev);
        } catch (Exception e) {
            Diag.w("FuelMapAgenda", "lecture de l'agenda impossible : " + e);
            try { out.put("perm", allowed(ctx)); out.put("events", new JSONArray()); out.put("error", String.valueOf(e)); } catch (Exception ignored) { }
        }
        return out.toString();
    }
}
