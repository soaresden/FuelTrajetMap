package fr.soaresden.fuelmap.auto;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Template;

/** Écran affiché dans la voiture quand l'abonnement FuelMap Plus n'est pas actif : tout se règle sur le téléphone. */
public class PlusScreen extends Screen {
    public PlusScreen(@NonNull CarContext ctx) { super(ctx); }

    @NonNull
    @Override
    public Template onGetTemplate() {
        return new MessageTemplate.Builder("FuelMap sur l'écran de la voiture fait partie de FuelMap Plus.\nSur le téléphone, touche « Mode voiture » ou « Proposer mes arrêts » : 7 jours d'essai gratuit, puis 4,99 €/an ou 0,99 €/mois.")
            .setTitle("FuelMap Plus")
            .setHeaderAction(Action.APP_ICON)
            .addAction(new Action.Builder().setTitle("Fermer").setOnClickListener(() -> getCarContext().finishCarApp()).build())
            .build();
    }
}
