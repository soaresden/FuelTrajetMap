package fr.soaresden.fuelmap.auto;

import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.Row;
import androidx.car.app.model.SearchTemplate;
import androidx.car.app.model.Template;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Destination du trajet : l'écran de recherche de l'hôte (clavier à l'arrêt, voix en roulant), adresses de la Base
 * Adresse Nationale. Le choix revient à la page voiture (setDest) qui calcule le trajet depuis la position.
 */
public class SearchScreen extends Screen {
    public interface OnPick { void onPick(double lat, double lon, String label); }

    private final OnPick onPick;
    private final List<String[]> results = new ArrayList<>(); // label, lat, lon
    private String query = "", status = null;
    private boolean loading;

    public SearchScreen(@NonNull CarContext ctx, OnPick onPick) { super(ctx); this.onPick = onPick; }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ItemList.Builder list = new ItemList.Builder();
        if (loading) list.setNoItemsMessage("⏳ Recherche de « " + query + " »…");
        else if (status != null) list.setNoItemsMessage(status);
        else if (results.isEmpty()) list.setNoItemsMessage("Tape ou dicte une ville, une adresse, un lieu.");
        for (String[] r : results) {
            final String[] rr = r;
            list.addItem(new Row.Builder().setTitle(rr[0]).setBrowsable(false).setOnClickListener(() -> {
                onPick.onPick(Double.parseDouble(rr[1]), Double.parseDouble(rr[2]), rr[0]);
                getScreenManager().pop();
            }).build());
        }
        return new SearchTemplate.Builder(new SearchTemplate.SearchCallback() {
            @Override public void onSearchTextChanged(@NonNull String t) { query = t; }
            @Override public void onSearchSubmitted(@NonNull String t) { query = t; search(t); }
        }).setHeaderAction(Action.BACK).setSearchHint("Destination : ville, adresse…").setInitialSearchText(query).setShowKeyboardByDefault(true).setItemList(list.build()).build();
    }

    private void search(String q) {
        if (q.trim().length() < 2) return;
        loading = true; status = null; results.clear(); invalidate();
        new Thread(() -> {
            List<String[]> out = new ArrayList<>(); String err = null;
            try {
                String body = FuelData.fetch("https://api-adresse.data.gouv.fr/search/?limit=6&q=" + Uri.encode(q.trim()));
                JSONArray feats = new JSONObject(body).getJSONArray("features");
                for (int i = 0; i < feats.length(); i++) {
                    JSONObject f = feats.getJSONObject(i), p = f.getJSONObject("properties");
                    JSONArray c = f.getJSONObject("geometry").getJSONArray("coordinates");
                    out.add(new String[]{ p.optString("label", q), String.valueOf(c.getDouble(1)), String.valueOf(c.getDouble(0)) });
                }
            } catch (Exception e) { err = "Recherche impossible (" + e.getMessage() + ")"; }
            final String fe = err; final List<String[]> fo = out;
            getCarContext().getMainExecutor().execute(() -> {
                loading = false; results.clear(); results.addAll(fo);
                status = fe != null ? "⚠️ " + fe : fo.isEmpty() ? "Rien trouvé pour « " + q + " »." : null;
                invalidate();
            });
        }).start();
    }
}
