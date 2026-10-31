package fr.soaresden.fuelmap.auto;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

import fr.soaresden.fuelmap.MainActivity;
import fr.soaresden.fuelmap.R;
import fr.soaresden.fuelmap.diag.Diag;

/**
 * « Acheter Plus » touché sur l'écran de la voiture : on ne peut pas payer dans la voiture (Google n'y affiche pas sa fenêtre
 * de paiement), alors une notification arrive sur le téléphone ; la toucher ouvre FuelMap sur l'écran d'abonnement.
 */
public final class PlusNotify {
    private static final String CHANNEL = "fuelmap_plus";
    private PlusNotify() { }

    public static void show(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "FuelMap Plus", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Demandé depuis l'écran de la voiture : ouvrir l'abonnement FuelMap Plus sur le téléphone."); nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(ctx, MainActivity.class).putExtra("plus", "auto").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            Notification n = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_fuel).setContentTitle("⭐ FuelMap Plus")
                .setContentText("Touche ici pour essayer FuelMap Plus : 7 jours gratuits.")
                .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(ctx, 7, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .build();
            nm.notify(4220, n);
            Diag.i("FuelMapCar", "Plus : notification envoyée au téléphone");
        } catch (Exception e) { Diag.w("FuelMapCar", "Plus : notification impossible : " + e.getMessage()); }
    }
}
