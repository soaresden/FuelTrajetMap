package fr.soaresden.fuelmap.auto;

import android.Manifest;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.constraints.ConstraintManager;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.CarLocation;
import androidx.car.app.model.Distance;
import androidx.car.app.model.DistanceSpan;
import androidx.car.app.model.ForegroundCarColorSpan;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.Metadata;
import androidx.car.app.model.Place;
import androidx.car.app.model.Header;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.navigation.model.MapController;
import androidx.car.app.navigation.model.MapWithContentTemplate;
import androidx.car.app.navigation.model.PlaceListNavigationTemplate;
import androidx.car.app.model.PlaceMarker;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;


/**
 * Liste des stations autour de la voiture (30 km), tri « moins cher » (défaut) ou « plus proche ». Tap → détail + navigation.
 * Hôte API ≥ 7 : liste posée sur la carte FuelMap (MapWithContentTemplate, la surface reste la nôtre) ;
 * hôte ancien : PlaceListNavigationTemplate, carte de l'hôte avec repères numérotés (écran principal dans ce cas).
 */
public class StationsScreen extends Screen implements DefaultLifecycleObserver {
    private final Handler main = new Handler(Looper.getMainLooper());
    private Location here;
    private List<Station> stations = new ArrayList<>();
    private boolean loading = false, byDistance = false;
    private String error;
    private FuelData.Car car;
    private final LocationListener listener = loc -> { boolean first = here == null; here = loc; if (first) reload(); };

    public StationsScreen(@NonNull CarContext ctx) {
        super(ctx);
        getLifecycle().addObserver(this);
    }

    @Override
    public void onStart(@NonNull LifecycleOwner owner) {
        car = FuelData.readCar(getCarContext());
        if (ContextCompat.checkSelfPermission(getCarContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            getCarContext().requestPermissions(Collections.singletonList(Manifest.permission.ACCESS_FINE_LOCATION), (granted, rejected) -> {
                if (!granted.isEmpty()) startLocation(); else { error = "Position refusée : autorise la localisation de FuelMap sur le téléphone."; invalidate(); }
            });
        } else startLocation();
    }

    @Override
    public void onStop(@NonNull LifecycleOwner owner) {
        try { ((LocationManager) getCarContext().getSystemService(CarContext.LOCATION_SERVICE)).removeUpdates(listener); } catch (Exception ignored) { }
    }

    private void startLocation() {
        try {
            LocationManager lm = (LocationManager) getCarContext().getSystemService(CarContext.LOCATION_SERVICE);
            Location last = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last == null) last = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null && here == null) { here = last; reload(); }
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 15000, 200, listener);
        } catch (SecurityException e) { error = "Position indisponible."; invalidate(); }
    }

    private void reload() {
        if (here == null || loading) return;
        loading = true; error = null; invalidate();
        final double lat = here.getLatitude(), lon = here.getLongitude();
        final String fuel = car.fuel;
        new Thread(() -> {
            try {
                List<Station> list = FuelData.stationsAround(getCarContext(), lat, lon, fuel, 30);
                main.post(() -> { stations = list; loading = false; invalidate(); });
            } catch (Exception e) {
                main.post(() -> { loading = false; error = "Prix indisponibles (" + e.getMessage() + ")"; invalidate(); });
            }
        }).start();
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        String fuelLabel = FuelData.fuelLabel(car == null ? "e10" : car.fuel);
        String title = "FuelMap · " + fuelLabel + (byDistance ? " · plus proches" : " · moins chères");
        ActionStrip strip = new ActionStrip.Builder()
            .addAction(new Action.Builder().setTitle(byDistance ? "€ Prix" : "📍 Distance").setOnClickListener(() -> { byDistance = !byDistance; invalidate(); }).build())
            .addAction(new Action.Builder().setTitle("↻").setOnClickListener(this::reload).build())
            .build();
        boolean wait = here == null || (loading && stations.isEmpty());
        ItemList list = wait ? null : buildList(fuelLabel);
        boolean modern = getCarContext().getCarAppApiLevel() >= 7;
        Action back = modern ? Action.BACK : Action.APP_ICON; // depuis la carte plein écran on revient en arrière ; écran principal sinon

        if (modern) {
            ListTemplate.Builder lt = new ListTemplate.Builder().setHeader(new Header.Builder().setTitle(title).setStartHeaderAction(back).build());
            if (wait) lt.setLoading(true); else lt.setSingleList(list);
            return new MapWithContentTemplate.Builder().setContentTemplate(lt.build()).setActionStrip(strip)
                .setMapController(new MapController.Builder().setMapActionStrip(new ActionStrip.Builder().addAction(Action.PAN).build()).setPanModeListener(p -> { }).build())
                .build();
        }
        PlaceListNavigationTemplate.Builder tb = new PlaceListNavigationTemplate.Builder().setTitle(title).setHeaderAction(back).setActionStrip(strip).setOnContentRefreshListener(this::reload);
        if (wait) return tb.setLoading(true).build();
        return tb.setItemList(list).build();
    }

    private ItemList buildList(String fuelLabel) {
        ItemList.Builder list = new ItemList.Builder();
        if (error != null && stations.isEmpty()) return list.setNoItemsMessage(error).build();
        if (stations.isEmpty()) return list.setNoItemsMessage("Aucune station " + fuelLabel + " avec un prix récent à moins de 30 km.").build();

        List<Station> shown = new ArrayList<>(stations);
        if (byDistance) Collections.sort(shown, (a, b) -> Double.compare(a.distKm, b.distKm));
        int limit = 6;
        try { limit = getCarContext().getCarService(ConstraintManager.class).getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST); } catch (Exception ignored) { }
        double cheapestPrice = stations.get(0).price;
        for (int i = 0; i < Math.min(limit, shown.size()); i++) {
            final Station s = shown.get(i);
            String head = (s.brand.isEmpty() ? "" : s.brand + " · ") + s.ville;
            boolean cheapest = s.price <= cheapestPrice + 0.0005;
            // Titre : pas de couleur autorisée par l'hôte (seuls DistanceSpan/DurationSpan) ; la couleur va dans le texte secondaire.
            String title = FuelData.price(s.price) + "  " + head;
            SpannableString sub = new SpannableString("  · " + s.adresse + " · " + FuelData.age(s.ageDays) + (s.auto24 ? " · 24/24" : "") + (cheapest ? " · la moins chère" : ""));
            sub.setSpan(DistanceSpan.create(Distance.create(s.distKm, Distance.UNIT_KILOMETERS)), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            if (cheapest) sub.setSpan(ForegroundCarColorSpan.create(CarColor.GREEN), sub.length() - 14, sub.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            String label = String.valueOf(i + 1);
            list.addItem(new Row.Builder()
                .setTitle(title).addText(sub)
                .setMetadata(new Metadata.Builder().setPlace(new Place.Builder(CarLocation.create(s.lat, s.lon))
                    .setMarker(new PlaceMarker.Builder().setLabel(label).setColor(cheapest ? CarColor.GREEN : CarColor.PRIMARY).build()).build()).build())
                .setOnClickListener(() -> getScreenManager().push(new StationScreen(getCarContext(), s, car)))
                .build());
        }
        return list.build();
    }
}
