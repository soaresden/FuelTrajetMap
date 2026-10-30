package fr.soaresden.fuelmap.auto;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.SearchTemplate;
import androidx.car.app.model.Template;

/**
 * Bloc-notes dans la voiture : l'écran de saisie de l'hôte (comme la recherche 🔍). C'est l'hôte qui applique les règles
 * Android Auto : clavier seulement à l'arrêt, dictée vocale en roulant (et la musique se met en pause pendant la dictée).
 * La note est rendue à la page voiture, qui l'enregistre avec l'heure et l'endroit.
 */
public class NoteScreen extends Screen {
    public interface OnNote { void onNote(String text); }

    private final OnNote onNote;
    private String text = "";

    public NoteScreen(@NonNull CarContext ctx, OnNote onNote) { super(ctx); this.onNote = onNote; }

    @NonNull
    @Override
    public Template onGetTemplate() {
        ItemList list = new ItemList.Builder().setNoItemsMessage("📝 Dicte ta note (🎤), ou écris-la à l'arrêt. Elle sera enregistrée avec l'heure et l'endroit, à relire sur le téléphone.").build();
        return new SearchTemplate.Builder(new SearchTemplate.SearchCallback() {
            @Override public void onSearchTextChanged(@NonNull String t) { text = t; }
            @Override public void onSearchSubmitted(@NonNull String t) {
                String s = t.trim(); if (s.isEmpty()) return;
                onNote.onNote(s); getScreenManager().pop();
            }
        }).setHeaderAction(Action.BACK).setSearchHint("Note : dicte ou écris…").setInitialSearchText(text).setShowKeyboardByDefault(false).setItemList(list).build();
    }
}
