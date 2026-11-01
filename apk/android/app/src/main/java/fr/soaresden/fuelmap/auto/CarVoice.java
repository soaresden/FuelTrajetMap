package fr.soaresden.fuelmap.auto;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import fr.soaresden.fuelmap.diag.Diag;

import java.util.Locale;

/** Voix du guidage : synthèse vocale Android sur le canal « guidage de navigation » (la voiture baisse la musique le temps de la phrase).
 *  Volume choisi dans la voiture (relatif au volume du guidage de la voiture). Pendant un appel : seulement les directions, plus bas. */
public class CarVoice {
    private static final String TAG = "FuelMapVoice";
    private TextToSpeech tts; private boolean ready; private String pending, pendingCat = "turn"; private float pendingVol = 1f;
    private final AudioManager audio; private AudioFocusRequest focus;

    public CarVoice(Context ctx) {
        audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        try {
            tts = new TextToSpeech(ctx.getApplicationContext(), status -> {
                if (status != TextToSpeech.SUCCESS) { Diag.w(TAG, "synthèse vocale indisponible (" + status + ")"); return; }
                int r = tts.setLanguage(Locale.FRANCE); Diag.i(TAG, "voix prête, français : " + r);
                tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { release(); }
                    @Override public void onError(String id) { release(); }
                });
                ready = true; if (pending != null) { String p = pending; pending = null; speak(p, pendingCat, pendingVol); }
            });
        } catch (Exception e) { Diag.w(TAG, "TTS : " + e); }
    }

    public void speak(String text) { speak(text, "turn", 1f); }

    /** cat : turn (manœuvre), pre (annonce avant), alert, info, extra — voir car.js. vol : 0,2 à 1. */
    public void speak(String text, String cat, float vol) {
        if (text == null || text.isEmpty()) return;
        if (!ready) { pending = text; pendingCat = cat; pendingVol = vol; return; }
        boolean call = inCall();
        if (call && !"turn".equals(cat) && !"pre".equals(cat)) { Diag.i(TAG, "appel en cours, pas dit : " + text); return; }
        float v = Math.max(0.05f, Math.min(1f, vol)) * (call ? 0.4f : 1f);
        try {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
            audio.requestAudioFocus(focus);
            Bundle p = new Bundle(); p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, v);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, "fm" + System.currentTimeMillis());
            Diag.i(TAG, "dit (" + cat + ", " + Math.round(v * 100) + " %" + (call ? ", appel" : "") + ") : " + text);
        } catch (Exception e) { Diag.w(TAG, "parole : " + e); }
    }

    /** Appel téléphonique (réseau) ou appel par une appli (WhatsApp…) en cours. */
    private boolean inCall() { try { int m = audio.getMode(); return m == AudioManager.MODE_IN_CALL || m == AudioManager.MODE_IN_COMMUNICATION; } catch (Exception e) { return false; } }

    private void release() { try { if (focus != null) audio.abandonAudioFocusRequest(focus); } catch (Exception ignored) { } }

    public void shutdown() { try { release(); if (tts != null) tts.shutdown(); } catch (Exception ignored) { } }
}
