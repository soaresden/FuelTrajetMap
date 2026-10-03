package fr.soaresden.fuelmap.auto;

import fr.soaresden.fuelmap.diag.Diag;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.model.NavigationTemplate;

/**
 * Écran principal : la carte FuelMap (appli web, mode voiture) sur TOUT l'écran de la voiture, sans carte d'infos
 * de l'hôte. Le NavigationTemplate est le seul modèle plein écran : il n'ajoute que des boutons flottants,
 * d'où la catégorie « navigation » du service. Boutons : « Y aller » vers la station visée par la page
 * (prochain arrêt du trajet, sinon meilleur plein) et la liste des stations proches.
 */
public class MapScreen extends Screen {
    final CarWebSurface surface;
    private double targetLat, targetLon; private String targetLabel;
    double navLat, navLon; long navAt; // dernière demande « Y aller » (pour reconnaître un renvoi de l'hôte vers nous-mêmes)

    public MapScreen(@NonNull CarContext ctx) {
        super(ctx);
        surface = new CarWebSurface(ctx, new CarWebSurface.TargetListener() {
            @Override public void onTarget(double lat, double lon, String label) { targetLat = lat; targetLon = lon; targetLabel = label; Diag.i("FuelMapCar", "cible = " + label); }
            @Override public void onNavigate(double lat, double lon, String label) { openMaps(lat, lon, label != null ? label : "Station"); }
            @Override public void onSearch() { openSearch(); }
            @Override public void onOpenMaps(double lat, double lon, String label) { openMaps(lat, lon, label); }
        });
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        return new NavigationTemplate.Builder()
            .setActionStrip(new ActionStrip.Builder()
                .addAction(new Action.Builder().setTitle("🧭 Y aller").setFlags(Action.FLAG_PRIMARY).setBackgroundColor(CarColor.GREEN).setOnClickListener(this::navigate).build())
                .addAction(new Action.Builder().setTitle("📍").setOnClickListener(() -> surface.run("window.__fuelmapAPI&&(window.__fuelmapAPI.setFollow(true),window.__fuelmapAPI.locate().catch(function(){}))")).build())
                .addAction(new Action.Builder().setTitle("🔍").setOnClickListener(this::openSearch).build())
                .addAction(new Action.Builder().setTitle("🐞").setOnClickListener(() -> { Diag.marker("bouton 🐞 dans la voiture"); surface.run("window.__fuelmapCar&&window.__fuelmapCar.dump&&window.__fuelmapCar.dump()"); CarToast.makeText(getCarContext(), "Repère noté dans le journal", CarToast.LENGTH_SHORT).show(); }).build())
                .build())
            .setMapActionStrip(new ActionStrip.Builder().addAction(Action.PAN).build()) // obligatoire pour recevoir les gestes sur la carte…
            .setPanModeListener(inPan -> { })                                            // …et l'hôte n'active le déplacement que si un écouteur existe
            .build();
    }

    /** Destination du trajet : écran de recherche de l'hôte, puis la page calcule le trajet depuis la voiture. */
    private void openSearch() {
        getScreenManager().push(new SearchScreen(getCarContext(), (lat, lon, label) ->
            surface.run("window.__fuelmapCar&&window.__fuelmapCar.setDest({lat:" + lat + ",lon:" + lon + ",label:" + org.json.JSONObject.quote(label) + "})")));
    }

    /** « Y aller » : guidage FuelMap dans la page (itinéraire dessiné, distance/temps, la carte suit la voiture). */
    private void navigate() {
        Diag.i("FuelMapCar", "Y aller → guidage FuelMap");
        surface.run("window.__fuelmapCar&&window.__fuelmapCar.go&&window.__fuelmapCar.go()");
    }

    /** Guidage par Google Maps / Waze sur le téléphone (bouton 📱 de la carte de station) : on lance, puis on s'efface. */
    void openMaps(double lat, double lon, String label) {
        navLat = lat; navLon = lon; navAt = android.os.SystemClock.uptimeMillis();
        if (phoneNavigation(lat, lon, label)) {
            CarToast.makeText(getCarContext(), "Guidage lancé dans l'appli de navigation du téléphone", CarToast.LENGTH_LONG).show();
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> { try { Diag.i("FuelMapCar", "on s'efface devant l'appli de navigation"); getCarContext().finishCarApp(); } catch (Exception e) { Diag.w("FuelMapCar", "finishCarApp : " + e); } }, 800);
        } else CarToast.makeText(getCarContext(), "Impossible de lancer Google Maps / Waze", CarToast.LENGTH_LONG).show();
    }

    /** Démarre le guidage Google Maps (ou Waze) côté téléphone : connecté à Android Auto, il prend l'écran de la voiture. */
    private boolean phoneNavigation(double lat, double lon, String label) {
        Intent[] tries = {
            new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + lat + "," + lon)).setPackage("com.google.android.apps.maps"),
            new Intent(Intent.ACTION_VIEW, Uri.parse("waze://?ll=" + lat + "," + lon + "&navigate=yes")).setPackage("com.waze"),
            new Intent(Intent.ACTION_VIEW, Uri.parse("geo:" + lat + "," + lon + "?q=" + lat + "," + lon + "(" + Uri.encode(label == null ? "Station" : label) + ")"))
        };
        // Sur l'écran du téléphone (pas celui de la voiture : interdit), depuis le contexte de l'application.
        android.content.Context app = getCarContext().getApplicationContext();
        android.os.Bundle opts = android.app.ActivityOptions.makeBasic().setLaunchDisplayId(android.view.Display.DEFAULT_DISPLAY).toBundle();
        for (Intent i : tries) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                if (i.resolveActivity(app.getPackageManager()) == null) { Diag.i("FuelMapCar", "pas d'appli pour " + i.getData()); continue; }
                app.startActivity(i, opts); Diag.i("FuelMapCar", "navigation téléphone : " + i.getData()); return true;
            } catch (Exception e) { Diag.w("FuelMapCar", "navigation téléphone refusée : " + e); }
        }
        return false;
    }
}
