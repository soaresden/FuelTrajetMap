package fr.soaresden.fuelmap.auto;

import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

import java.util.Locale;

/** Détail d'une station : prix, coût du plein pour la voiture, bouton « Y aller » (ouvre l'appli de navigation de la voiture). */
public class StationScreen extends Screen {
    private final Station s;
    private final FuelData.Car car;

    public StationScreen(@NonNull CarContext ctx, Station s, FuelData.Car car) { super(ctx); this.s = s; this.car = car; }

    @NonNull
    @Override
    public Template onGetTemplate() {
        double liters = Math.max(5, car.tank * 0.5); // hypothèse : demi-réservoir à remplir
        Pane.Builder pane = new Pane.Builder()
            .addRow(new Row.Builder().setTitle(FuelData.price(s.price) + " / L " + FuelData.fuelLabel(car.fuel)).addText(FuelData.age(s.ageDays) + (s.auto24 ? " · automate 24/24" : "")).build())
            .addRow(new Row.Builder().setTitle(s.adresse).addText(s.ville + " · " + String.format(Locale.FRANCE, "%.1f km", s.distKm)).build())
            .addRow(new Row.Builder().setTitle(car.name + " : " + String.format(Locale.FRANCE, "%.0f L", liters) + " ≈ " + String.format(Locale.FRANCE, "%.2f €", liters * s.price)).addText("estimation pour un demi-réservoir").build())
            .addAction(new Action.Builder().setTitle("🧭 Y aller").setBackgroundColor(CarColor.GREEN).setOnClickListener(this::navigate).build())
            .addAction(new Action.Builder().setTitle("Retour").setOnClickListener(() -> getScreenManager().pop()).build());
        return new PaneTemplate.Builder(pane.build())
            .setTitle((s.brand.isEmpty() ? "" : s.brand + " · ") + s.ville)
            .setHeaderAction(Action.BACK)
            .build();
    }

    private void navigate() {
        try {
            String label = Uri.encode((s.brand.isEmpty() ? "Station" : s.brand) + " " + s.ville);
            Intent i = new Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:" + s.lat + "," + s.lon + "?q=" + s.lat + "," + s.lon + "(" + label + ")"));
            getCarContext().startCarApp(i);
        } catch (Exception e) {
            CarToast.makeText(getCarContext(), "Aucune appli de navigation disponible", CarToast.LENGTH_LONG).show();
        }
    }
}
