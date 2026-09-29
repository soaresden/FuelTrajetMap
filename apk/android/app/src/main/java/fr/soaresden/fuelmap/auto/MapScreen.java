package fr.soaresden.fuelmap.auto;

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

    public MapScreen(@NonNull CarContext ctx) {
        super(ctx);
        surface = new CarWebSurface(ctx, new CarWebSurface.TargetListener() {
            @Override public void onTarget(double lat, double lon, String label) { targetLat = lat; targetLon = lon; targetLabel = label; invalidate(); }
            @Override public void onNavigate(double lat, double lon, String label) { navigateTo(lat, lon, label != null ? label : (targetLabel != null && lat == targetLat && lon == targetLon ? targetLabel : "Station")); }
        });
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        return new NavigationTemplate.Builder()
            .setActionStrip(new ActionStrip.Builder()
                .addAction(new Action.Builder().setTitle("🧭 Y aller").setFlags(Action.FLAG_PRIMARY).setBackgroundColor(CarColor.GREEN).setOnClickListener(this::navigate).build())
                .addAction(new Action.Builder().setTitle("📋 Liste").setOnClickListener(() -> getScreenManager().push(new StationsScreen(getCarContext()))).build())
                .build())
            .setMapActionStrip(new ActionStrip.Builder().addAction(Action.PAN).build()) // obligatoire pour recevoir les gestes sur la carte…
            .setPanModeListener(inPan -> { })                                            // …et l'hôte n'active le déplacement que si un écouteur existe
            .build();
    }

    private void navigate() {
        if (targetLabel == null) { CarToast.makeText(getCarContext(), "Touche une station sur la carte", CarToast.LENGTH_SHORT).show(); return; }
        navigateTo(targetLat, targetLon, targetLabel);
    }

    /** Confie la destination à l'appli de navigation choisie dans Android Auto (Google Maps, Waze…). */
    private void navigateTo(double lat, double lon, String label) {
        try {
            getCarContext().startCarApp(new Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:" + lat + "," + lon + "?q=" + lat + "," + lon + "(" + Uri.encode(label) + ")")));
        } catch (Exception e) { CarToast.makeText(getCarContext(), "Aucune appli de navigation disponible", CarToast.LENGTH_LONG).show(); }
    }
}
