package fr.soaresden.fuelmap;

import android.content.IntentSender;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Mise à jour obligatoire : si le Play Store a une version plus récente, l'écran de mise à jour « immédiate »
 * s'affiche par-dessus l'appli et il faut l'installer pour continuer (l'utilisateur ne peut pas la refuser).
 * Sans effet sur un APK installé hors Play (là c'est version-min.json, côté page, qui bloque).
 */
public class MainActivity extends BridgeActivity {
    private AppUpdateManager updates;

    @Override
    public void onResume() {
        super.onResume();
        try {
            if (updates == null) updates = AppUpdateManagerFactory.create(this);
            updates.getAppUpdateInfo().addOnSuccessListener(info -> {
                boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    || info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS; // reprend une mise à jour interrompue
                if (available && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                    try { updates.startUpdateFlowForResult(info, this, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).setAllowAssetPackDeletion(true).build(), 4242); }
                    catch (IntentSender.SendIntentException e) { Log.w("FuelMap", "mise à jour : " + e.getMessage()); }
                }
            });
        } catch (Exception e) { Log.w("FuelMap", "vérification de mise à jour impossible : " + e.getMessage()); }
    }
}
