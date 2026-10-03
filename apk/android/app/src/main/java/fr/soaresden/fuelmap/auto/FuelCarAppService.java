package fr.soaresden.fuelmap.auto;

import fr.soaresden.fuelmap.diag.Diag;
import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.AppManager;
import androidx.car.app.CarAppService;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

/**
 * Point d'entrée Android Auto (catégorie « points d'intérêt »).
 * Hôte récent (API ≥ 7) : la vraie carte FuelMap dessinée sur l'écran de la voiture (MapScreen).
 * Hôte ancien : liste des stations + carte de l'hôte (StationsScreen).
 */
public class FuelCarAppService extends CarAppService {
    @NonNull
    @Override
    public HostValidator createHostValidator() {
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
    }

    @Override
    public void onCreate() { super.onCreate(); Diag.init(this); Diag.i("FuelMapCar", "service Android Auto créé"); }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new Session() {
            MapScreen map;
            {
                getLifecycle().addObserver(new DefaultLifecycleObserver() {
                    @Override public void onCreate(@NonNull LifecycleOwner o) { askLocation(); }
                    @Override public void onDestroy(@NonNull LifecycleOwner o) { Diag.i("FuelMapCar", "session terminée"); if (map != null) map.surface.destroy(); }
                });
            }

            /** Sans la permission de localisation (première installation), la page n'a pas de GPS : l'hôte affiche la demande (à valider sur le téléphone). */
            void askLocation() {
                if (ContextCompat.checkSelfPermission(getCarContext(), android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
                Diag.w("FuelMapCar", "localisation non autorisée : demande via l'hôte");
                try {
                    getCarContext().requestPermissions(java.util.Arrays.asList(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION), (granted, rejected) -> {
                        Diag.i("FuelMapCar", "permissions : accordées " + granted + ", refusées " + rejected);
                        if (!granted.isEmpty() && map != null) map.surface.run("location.reload()");
                    });
                } catch (Exception e) { Diag.w("FuelMapCar", "demande de permission impossible : " + e); }
            }

            @Override
            public void onNewIntent(@NonNull Intent intent) { // ex. ACTION_NAVIGATE reçu de l'hôte (Assistant, ou notre propre « Y aller » renvoyé)
                Diag.i("FuelMapCar", "onNewIntent " + intent.getAction() + " " + intent.getData());
                if (map == null || intent.getData() == null) return;
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)").matcher(intent.getData().toString());
                if (!m.find()) return;
                double lat = Double.parseDouble(m.group(1)), lon = Double.parseDouble(m.group(2));
                if (android.os.SystemClock.uptimeMillis() - map.navAt < 5000 && Math.abs(lat - map.navLat) < 1e-4 && Math.abs(lon - map.navLon) < 1e-4) { Diag.i("FuelMapCar", "renvoi de notre propre demande : ignoré"); return; }
                // « Navigue vers … » venu de l'Assistant ou d'une autre appli : guidage FuelMap vers ce point
                String label = intent.getData().getQueryParameter("q"); if (label != null) label = label.replaceFirst("^[-0-9.]+,[-0-9.]+\\(?", "").replaceFirst("\\)$", "");
                map.surface.run("window.__fuelmapCar&&window.__fuelmapCar.goTo&&window.__fuelmapCar.goTo(" + lat + "," + lon + "," + org.json.JSONObject.quote(label == null || label.isEmpty() ? "Destination" : label) + ")");
            }

            @NonNull
            @Override
            public Screen onCreateScreen(@NonNull Intent intent) {
                if (getCarContext().getCarAppApiLevel() < 7) return new StationsScreen(getCarContext());
                // Le rappel de surface est enregistré une fois pour la session, avant le premier modèle :
                // l'hôte ne renvoie pas onSurfaceAvailable si le rappel change en cours de route.
                map = new MapScreen(getCarContext());
                getCarContext().getCarService(AppManager.class).setSurfaceCallback(map.surface);
                return map;
            }
        };
    }
}
