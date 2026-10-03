package fr.soaresden.fuelmap.diag;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Pont page ↔ journal de diagnostic :
 *   log({ message })            → une ligne dans le journal (événements de la page : trajet calculé, alerte, écran voiture…)
 *   marker({ what })            → un repère bien visible (« c'est là que ça a planté »)
 *   export({ version, state })  → fabrique le zip et ouvre la feuille de partage (mail, Drive, Telegram…)
 */
@CapacitorPlugin(name = "Diag")
public class DiagPlugin extends Plugin {
    @Override
    public void load() { Diag.init(getContext()); }

    @PluginMethod
    public void log(PluginCall call) { Diag.i("FuelMapWeb", String.valueOf(call.getString("message", ""))); call.resolve(); }

    @PluginMethod
    public void marker(PluginCall call) { Diag.marker(String.valueOf(call.getString("what", "repère"))); call.resolve(); }

    @PluginMethod
    public void export(PluginCall call) {
        try {
            File zip = Diag.export(getContext(), call.getString("version", "?"), call.getString("state"));
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", zip);
            Intent send = new Intent(Intent.ACTION_SEND).setType("application/zip").putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, "FuelMap — journal de diagnostic").putExtra(Intent.EXTRA_TEXT, "Journal de diagnostic FuelMap (" + zip.getName() + ").")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Envoyer le journal FuelMap"));
            JSObject r = new JSObject(); r.put("file", zip.getName()); r.put("bytes", zip.length()); call.resolve(r);
        } catch (Exception e) { Diag.e("FuelMapDiag", "export impossible", e); call.reject("Export impossible : " + e.getMessage()); }
    }
}
