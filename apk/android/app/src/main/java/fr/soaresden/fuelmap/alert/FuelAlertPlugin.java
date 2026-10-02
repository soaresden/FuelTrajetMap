package fr.soaresden.fuelmap.alert;

import android.Manifest;
import android.os.Build;

import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.TimeUnit;

/**
 * Pont page ↔ alerte carburant. La page écrit la zone dans les Preferences (clé « alert ») puis appelle :
 *   enable()  → demande la permission de notifier (Android 13+) et programme la vérification toutes les 15 min
 *   disable() → arrête la vérification
 *   test()    → lance une vérification tout de suite, qui notifie la station la mieux placée des 6 dernières heures
 */
@CapacitorPlugin(name = "FuelAlert", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class FuelAlertPlugin extends Plugin {
    static final String WORK = "fuelmap-alert";

    @PluginMethod
    public void enable(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) { requestPermissionForAlias("notifications", call, "afterPermission"); return; }
        schedule(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) { call.reject("Notifications refusées : autorise-les pour FuelMap dans les réglages du téléphone."); return; }
        schedule(call);
    }

    private void schedule(PluginCall call) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(AlertWorker.class, 15, TimeUnit.MINUTES).build();
        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req);
        getContext().getSharedPreferences(AlertWorker.PREFS, 0).edit().putLong("since", System.currentTimeMillis()).putString("seen", "{}").apply();
        JSObject r = new JSObject(); r.put("enabled", true); call.resolve(r);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        WorkManager.getInstance(getContext()).cancelUniqueWork(WORK);
        JSObject r = new JSObject(); r.put("enabled", false); call.resolve(r);
    }

    @PluginMethod
    public void test(PluginCall call) {
        WorkManager.getInstance(getContext()).enqueue(new OneTimeWorkRequest.Builder(AlertWorker.class).setInputData(new Data.Builder().putBoolean("test", true).build()).build());
        call.resolve();
    }
}
