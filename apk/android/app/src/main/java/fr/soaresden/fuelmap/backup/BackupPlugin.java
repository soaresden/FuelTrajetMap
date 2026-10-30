package fr.soaresden.fuelmap.backup;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import fr.soaresden.fuelmap.diag.Diag;

/**
 * Sauvegarde gérée par l'utilisateur, jamais chez Google : il choisit un dossier (par ex. Documents/FuelMap) et l'appli y écrit
 * « FuelMap-sauvegarde.json » (véhicules, favoris, carnet de pleins, notes, réglages). Sert aussi à restaurer, depuis ce dossier
 * ou depuis n'importe quel fichier de sauvegarde (nouveau téléphone, réinstallation).
 *   pickFolder() → { folder }    info() → { folder | null }    write({ data }) → { folder, file }    read() → { data }    openFile() → { data }
 */
@CapacitorPlugin(name = "Backup")
public class BackupPlugin extends Plugin {
    static final String PREFS = "backup", KEY = "tree", FILE = "FuelMap-sauvegarde.json";

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private Uri tree() { String s = prefs().getString(KEY, null); return s == null ? null : Uri.parse(s); }

    @PluginMethod
    public void info(PluginCall call) { JSObject r = new JSObject(); Uri t = tree(); r.put("folder", t == null ? null : folderName(t)); call.resolve(r); }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null) { call.reject("Aucun dossier choisi"); return; }
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            prefs().edit().putString(KEY, uri.toString()).apply();
            JSObject r = new JSObject(); r.put("folder", folderName(uri)); r.put("hasBackup", findFile(uri) != null); call.resolve(r);
            Diag.i("FuelMapBackup", "dossier de sauvegarde : " + uri);
        } catch (Exception e) { call.reject("Dossier inutilisable : " + e.getMessage()); }
    }

    @PluginMethod
    public void write(PluginCall call) {
        Uri t = tree(); String data = call.getString("data");
        if (t == null) { call.reject("Aucun dossier de sauvegarde choisi"); return; }
        if (data == null) { call.reject("Rien à sauvegarder"); return; }
        try {
            ContentResolver cr = getContext().getContentResolver();
            Uri file = findFile(t);
            if (file == null) file = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(t, DocumentsContract.getTreeDocumentId(t)), "application/json", FILE);
            try (OutputStream os = cr.openOutputStream(file, "wt")) { os.write(data.getBytes(StandardCharsets.UTF_8)); }
            JSObject r = new JSObject(); r.put("folder", folderName(t)); r.put("file", FILE); call.resolve(r);
        } catch (Exception e) { Diag.w("FuelMapBackup", "écriture impossible : " + e); call.reject("Sauvegarde impossible : " + e.getMessage()); }
    }

    @PluginMethod
    public void read(PluginCall call) {
        Uri t = tree(); if (t == null) { call.reject("Aucun dossier de sauvegarde choisi"); return; }
        Uri f = findFile(t); if (f == null) { call.reject("Pas de « " + FILE + " » dans ce dossier"); return; }
        readUri(call, f);
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*");
        startActivityForResult(call, i, "filePicked");
    }

    @ActivityCallback
    private void filePicked(PluginCall call, ActivityResult result) {
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null) { call.reject("Aucun fichier choisi"); return; }
        readUri(call, uri);
    }

    private void readUri(PluginCall call, Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder(); String l; while ((l = br.readLine()) != null) sb.append(l).append('\n');
            JSObject r = new JSObject(); r.put("data", sb.toString()); call.resolve(r);
        } catch (Exception e) { call.reject("Lecture impossible : " + e.getMessage()); }
    }

    private Uri findFile(Uri t) {
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(t, DocumentsContract.getTreeDocumentId(t));
        try (Cursor c = getContext().getContentResolver().query(kids, new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            while (c != null && c.moveToNext()) if (FILE.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(t, c.getString(0));
        } catch (Exception e) { Diag.w("FuelMapBackup", "lecture du dossier : " + e); }
        return null;
    }

    private String folderName(Uri t) {
        try (Cursor c = getContext().getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(t, DocumentsContract.getTreeDocumentId(t)), new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return "dossier choisi";
    }
}
