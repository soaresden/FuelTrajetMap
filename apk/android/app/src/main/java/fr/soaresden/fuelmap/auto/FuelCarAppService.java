package fr.soaresden.fuelmap.auto;

import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.car.app.AppManager;
import androidx.car.app.CarAppService;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

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

    @NonNull
    @Override
    public Session onCreateSession() {
        return new Session() {
            @NonNull
            @Override
            public Screen onCreateScreen(@NonNull Intent intent) {
                if (!FuelData.licensed(getCarContext())) return new PlusScreen(getCarContext());
                if (getCarContext().getCarAppApiLevel() < 7) return new StationsScreen(getCarContext());
                // Le rappel de surface est enregistré une fois pour la session, avant le premier modèle :
                // l'hôte ne renvoie pas onSurfaceAvailable si le rappel change en cours de route.
                MapScreen screen = new MapScreen(getCarContext());
                getCarContext().getCarService(AppManager.class).setSurfaceCallback(screen.surface);
                return screen;
            }
        };
    }
}
