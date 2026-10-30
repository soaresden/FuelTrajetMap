package fr.soaresden.fuelmap.agenda;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Pont page (téléphone) ↔ agenda : list() demande l'autorisation la première fois, puis rend les rendez-vous avec un lieu (7 jours). */
@CapacitorPlugin(name = "Agenda", permissions = { @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR }) })
public class AgendaPlugin extends Plugin {
    @PluginMethod
    public void list(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) { requestPermissionForAlias("calendar", call, "afterPermission"); return; }
        send(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) { call.reject("Agenda refusé : autorise-le pour FuelMap dans les réglages du téléphone."); return; }
        send(call);
    }

    private void send(PluginCall call) {
        try { call.resolve(new JSObject(Agenda.read(getContext(), 7))); } catch (Exception e) { call.reject("Lecture de l'agenda impossible : " + e); }
    }
}
