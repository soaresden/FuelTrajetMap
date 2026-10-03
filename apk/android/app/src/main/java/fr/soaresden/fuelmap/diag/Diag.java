package fr.soaresden.fuelmap.diag;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Journal de diagnostic embarqué : tout ce que l'appli note (Android Auto, alertes, plantages) va dans logcat ET dans un
 * fichier tournant (files/diag/fuelmap-log.txt, 1 Mo + 1 Mo d'archive), qui survit aux redémarrages du téléphone.
 * export() fabrique un zip (journal, logcat récent du processus, infos appareil, état de l'appli) à envoyer.
 */
public final class Diag {
    private static final String TAG = "FuelMapDiag";
    private static final long MAX = 1024 * 1024;
    private static File dir; private static File file;
    private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.FRANCE);

    private Diag() { }

    public static synchronized void init(Context ctx) {
        if (dir != null) return;
        dir = new File(ctx.getApplicationContext().getFilesDir(), "diag"); if (!dir.exists()) dir.mkdirs();
        file = new File(dir, "fuelmap-log.txt");
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> { write("E", "CRASH", "thread " + t.getName() + " : " + Log.getStackTraceString(e)); if (prev != null) prev.uncaughtException(t, e); });
        write("I", TAG, "--- démarrage du processus (" + Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE + ") ---");
    }

    public static void i(String tag, String msg) { Log.i(tag, msg); write("I", tag, msg); }
    public static void w(String tag, String msg) { Log.w(tag, msg); write("W", tag, msg); }
    public static void e(String tag, String msg) { Log.e(tag, msg); write("E", tag, msg); }
    public static void e(String tag, String msg, Throwable t) { Log.e(tag, msg, t); write("E", tag, msg + "\n" + Log.getStackTraceString(t)); }
    public static void marker(String what) { write("M", "MARQUEUR", "=================== " + what + " ==================="); Log.i(TAG, "marqueur : " + what); }

    private static synchronized void write(String level, String tag, String msg) {
        if (file == null) return;
        try {
            if (file.length() > MAX) { File old = new File(dir, "fuelmap-log.1.txt"); if (old.exists()) old.delete(); file.renameTo(old); }
            try (Writer w = new OutputStreamWriter(new FileOutputStream(file, true), StandardCharsets.UTF_8)) {
                w.write(FMT.format(new Date()) + " " + level + "/" + tag + " [" + Thread.currentThread().getName() + "] " + msg + "\n");
            }
        } catch (Exception ignored) { }
    }

    /** Zip de diagnostic dans le cache (partageable via FileProvider). `extra` : état côté page (JSON) ou null. */
    public static File export(Context ctx, String appVersion, String extra) throws Exception {
        init(ctx);
        File out = new File(ctx.getCacheDir(), "diag"); if (!out.exists()) out.mkdirs();
        for (File f : out.listFiles() == null ? new File[0] : out.listFiles()) if (f.getName().endsWith(".zip")) f.delete();
        File zip = new File(out, "fuelmap-diag-" + new SimpleDateFormat("yyyyMMdd-HHmm", Locale.FRANCE).format(new Date()) + ".zip");
        try (ZipOutputStream z = new ZipOutputStream(new FileOutputStream(zip))) {
            put(z, "appareil.txt", "FuelMap " + appVersion + "\n" + Build.MANUFACTURER + " " + Build.MODEL + " (" + Build.DEVICE + ")\nAndroid " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")\n" +
                "Généré le " + FMT.format(new Date()) + "\nAndroid Auto installé : " + installed(ctx, "com.google.android.projection.gearhead") + "\nGoogle Maps : " + installed(ctx, "com.google.android.apps.maps") + "\nWaze : " + installed(ctx, "com.waze") + "\n");
            if (file != null && file.exists()) putFile(z, "journal.txt", file);
            File old = new File(dir, "fuelmap-log.1.txt"); if (old.exists()) putFile(z, "journal-precedent.txt", old);
            put(z, "logcat.txt", logcat());
            if (extra != null) put(z, "etat-appli.json", extra);
        }
        return zip;
    }

    private static String installed(Context ctx, String pkg) {
        try { return ctx.getPackageManager().getPackageInfo(pkg, 0).versionName; } catch (Exception e) { return "non"; }
    }
    private static String logcat() {
        StringBuilder sb = new StringBuilder();
        try {
            Process p = Runtime.getRuntime().exec(new String[]{ "logcat", "-d", "-v", "threadtime", "-t", "4000" });
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) { String l; while ((l = r.readLine()) != null) sb.append(l).append('\n'); }
        } catch (Exception e) { sb.append("logcat indisponible : ").append(e).append('\n'); }
        return sb.toString();
    }
    private static void put(ZipOutputStream z, String name, String content) throws Exception { z.putNextEntry(new ZipEntry(name)); z.write(content.getBytes(StandardCharsets.UTF_8)); z.closeEntry(); }
    private static void putFile(ZipOutputStream z, String name, File f) throws Exception {
        z.putNextEntry(new ZipEntry(name));
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) { byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) z.write(b, 0, n); }
        z.closeEntry();
    }
}
