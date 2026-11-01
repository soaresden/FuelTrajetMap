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
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.DateTimeWithZone;
import androidx.car.app.model.Distance;
import androidx.car.app.navigation.NavigationManager;
import androidx.car.app.navigation.model.Destination;
import androidx.car.app.navigation.model.Maneuver;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.car.app.navigation.model.RoutingInfo;
import androidx.car.app.navigation.model.Step;
import androidx.car.app.navigation.model.TravelEstimate;
import androidx.car.app.navigation.model.Trip;

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
    private RoutingInfo routing; private TravelEstimate estimate; private boolean navigating; private final CarVoice voice; private final CarIcon myLocation;

    public MapScreen(@NonNull CarContext ctx) {
        super(ctx);
        voice = new CarVoice(ctx);
        myLocation = new CarIcon.Builder(androidx.core.graphics.drawable.IconCompat.createWithResource(ctx, fr.soaresden.fuelmap.R.drawable.ic_my_location)).build();
        surface = new CarWebSurface(ctx, new CarWebSurface.TargetListener() {
            @Override public void onRouting(String json) { setRouting(json); }
            @Override public void onStopRouting() { stopRouting(); }
            @Override public void onSpeak(String text) { voice.speak(text); }
            @Override public void onSpeakAs(String text, String cat, float vol) { voice.speak(text, cat, vol); }
            @Override public void onTarget(double lat, double lon, String label) { targetLat = lat; targetLon = lon; targetLabel = label; Diag.i("FuelMapCar", "cible = " + label); }
            @Override public void onNavigate(double lat, double lon, String label) { openMaps(lat, lon, label != null ? label : "Station"); }
            @Override public void onSearch() { openSearch(); }
            @Override public void onOpenMaps(double lat, double lon, String label) { openMaps(lat, lon, label); }
            @Override public void onAskAgenda() { askAgenda(); }
            @Override public void onNote() { openNote(); }
            @Override public void onBuyPlus() { PlusNotify.show(getCarContext()); CarToast.makeText(getCarContext(), "Regarde ton téléphone : touche la notification FuelMap Plus", CarToast.LENGTH_LONG).show(); }
        });
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        NavigationTemplate.Builder b = new NavigationTemplate.Builder();
        // Seulement la fiche de manœuvre (en haut à gauche). Pas de setDestinationTravelEstimate : sa carte « temps restant » en bas à
        // gauche faisait réserver par l'hôte toute la colonne de gauche, et la page se retrouvait poussée vers le milieu. L'arrivée est
        // écrite par la page (bandeau du bas) ; le tableau de bord de la voiture la reçoit toujours par updateTrip.
        if (routing != null) b.setNavigationInfo(routing);
        return b
            .setActionStrip(new ActionStrip.Builder()
                .addAction(routing != null
                    ? new Action.Builder().setTitle("⏹ Arrêter").setFlags(Action.FLAG_PRIMARY).setBackgroundColor(CarColor.RED).setOnClickListener(() -> surface.run("window.__fuelmapCar&&window.__fuelmapCar.stopGuide()")).build()
                    : new Action.Builder().setTitle("🧭 Y aller").setFlags(Action.FLAG_PRIMARY).setBackgroundColor(CarColor.GREEN).setOnClickListener(this::navigate).build())
                // « ma position » : cercle avec un point, comme Google Maps
                .addAction(new Action.Builder().setIcon(myLocation).setOnClickListener(() -> surface.run("window.__fuelmapCar&&window.__fuelmapCar.recenter?window.__fuelmapCar.recenter():window.__fuelmapAPI&&(window.__fuelmapAPI.setFollow(true),window.__fuelmapAPI.locate().catch(function(){}))")).build())
                // 🔍 (Trajet › Destination) et 📝 (colonne de la page) ne sont plus ici : la barre de l'hôte prend moins de place
                .build())
            .setMapActionStrip(new ActionStrip.Builder().addAction(Action.PAN).build()) // obligatoire pour recevoir les gestes sur la carte…
            .setPanModeListener(inPan -> { })                                            // …et l'hôte n'active le déplacement que si un écouteur existe
            .build();
    }

    /** Fiche de manœuvre + arrivée, dessinées par l'hôte à partir de ce que la page calcule (voir car.js updateGuide). */
    void setRouting(String json) {
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            String kind = o.optString("kind", "straight"), cue = o.optString("cue", "Continuez"), road = o.optString("road", "");
            int distM = o.optInt("distM", 0); double remainKm = o.optDouble("remainKm", 0); double remainMin = o.optDouble("remainMin", 0); long eta = o.optLong("etaMs", System.currentTimeMillis());
            Maneuver.Builder mb = new Maneuver.Builder(maneuverType(kind));
            if (kind.equals("roundabout")) mb.setRoundaboutExitNumber(Math.max(1, o.optInt("exit", 1)));
            Step.Builder sb = new Step.Builder(cue).setManeuver(mb.build()); if (!road.isEmpty()) sb.setRoad(road);
            Step step = sb.build();
            Distance toNext = distM >= 1000 ? Distance.create(distM / 1000.0, Distance.UNIT_KILOMETERS) : Distance.create(Math.max(0, distM), Distance.UNIT_METERS);
            Distance remain = remainKm >= 1 ? Distance.create(remainKm, Distance.UNIT_KILOMETERS) : Distance.create(Math.max(0, remainKm * 1000), Distance.UNIT_METERS);
            estimate = new TravelEstimate.Builder(remain, DateTimeWithZone.create(eta, java.util.TimeZone.getDefault())).setRemainingTimeSeconds((long) Math.max(0, remainMin * 60)).build();
            routing = new RoutingInfo.Builder().setCurrentStep(step, toNext).build();
            NavigationManager nm = getCarContext().getCarService(NavigationManager.class);
            if (!navigating) { navigating = true; nm.navigationStarted(); Diag.i("FuelMapCar", "guidage démarré (hôte)"); }
            nm.updateTrip(new Trip.Builder().addStep(step, estimate).addDestination(new Destination.Builder().setName(o.optString("label", "Station")).build(), estimate).setCurrentRoad(road).build());
            invalidate();
        } catch (Exception e) { Diag.w("FuelMapCar", "fiche de guidage refusée : " + e + " ← " + json); }
    }
    void stopRouting() {
        routing = null; estimate = null;
        if (navigating) { navigating = false; try { getCarContext().getCarService(NavigationManager.class).navigationEnded(); } catch (Exception e) { Diag.w("FuelMapCar", "navigationEnded : " + e); } Diag.i("FuelMapCar", "guidage arrêté (hôte)"); }
        invalidate();
    }
    private static int maneuverType(String k) {
        switch (k) {
            case "depart": return Maneuver.TYPE_DEPART;
            case "left": return Maneuver.TYPE_TURN_NORMAL_LEFT; case "right": return Maneuver.TYPE_TURN_NORMAL_RIGHT;
            case "slight-left": return Maneuver.TYPE_TURN_SLIGHT_LEFT; case "slight-right": return Maneuver.TYPE_TURN_SLIGHT_RIGHT;
            case "sharp-left": return Maneuver.TYPE_TURN_SHARP_LEFT; case "sharp-right": return Maneuver.TYPE_TURN_SHARP_RIGHT;
            case "uturn-left": return Maneuver.TYPE_U_TURN_LEFT; case "uturn-right": return Maneuver.TYPE_U_TURN_RIGHT;
            case "roundabout": return Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW; case "exit-roundabout": return Maneuver.TYPE_ROUNDABOUT_EXIT_CCW;
            case "merge-left": return Maneuver.TYPE_MERGE_LEFT; case "merge-right": return Maneuver.TYPE_MERGE_RIGHT; case "merge": return Maneuver.TYPE_MERGE_SIDE_UNSPECIFIED;
            case "on-ramp-left": return Maneuver.TYPE_ON_RAMP_NORMAL_LEFT; case "on-ramp-right": return Maneuver.TYPE_ON_RAMP_NORMAL_RIGHT;
            case "off-ramp-left": return Maneuver.TYPE_OFF_RAMP_NORMAL_LEFT; case "off-ramp-right": return Maneuver.TYPE_OFF_RAMP_NORMAL_RIGHT;
            case "fork-left": return Maneuver.TYPE_FORK_LEFT; case "fork-right": return Maneuver.TYPE_FORK_RIGHT;
            case "arrive-left": return Maneuver.TYPE_DESTINATION_LEFT; case "arrive-right": return Maneuver.TYPE_DESTINATION_RIGHT; case "arrive": return Maneuver.TYPE_DESTINATION;
            default: return Maneuver.TYPE_STRAIGHT;
        }
    }

    /** Agenda : autorisation demandée sur le téléphone (invite de l'hôte), puis la page relit les rendez-vous. */
    private void askAgenda() {
        try {
            getCarContext().requestPermissions(java.util.Collections.singletonList(android.Manifest.permission.READ_CALENDAR), (granted, rejected) -> {
                Diag.i("FuelMapCar", "agenda : accordé " + granted + ", refusé " + rejected);
                surface.run("window.__fuelmapCar&&window.__fuelmapCar.render()");
            });
        } catch (Exception e) { Diag.w("FuelMapCar", "demande d'accès à l'agenda impossible : " + e); }
    }

    /** Bloc-notes : écran de saisie de l'hôte, la note revient à la page qui l'enregistre (heure, endroit). */
    private void openNote() {
        getScreenManager().push(new NoteScreen(getCarContext(), text ->
            surface.run("window.__fuelmapCar&&window.__fuelmapCar.addNote(" + org.json.JSONObject.quote(text) + ")")));
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
