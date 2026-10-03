package fr.soaresden.fuelmap.auto;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import fr.soaresden.fuelmap.diag.Diag;

import java.util.Locale;

/** Voix du guidage : synthèse vocale Android sur le canal « guidage de navigation » (la voiture baisse la musique le temps de la phrase). */
public class CarVoice {
    private static final String TAG = "FuelMapVoice";
    private TextToSpeech tts; private boolean ready; private String pending;
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
                ready = true; if (pending != null) { String p = pending; pending = null; speak(p); }
            });
        } catch (Exception e) { Diag.w(TAG, "TTS : " + e); }
    }

    public void speak(String text) {
        if (text == null || text.isEmpty()) return;
        if (!ready) { pending = text; return; }
        try {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
            audio.requestAudioFocus(focus);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "fm" + System.currentTimeMillis());
            Diag.i(TAG, "dit : " + text);
        } catch (Exception e) { Diag.w(TAG, "parole : " + e); }
    }

    private void release() { try { if (focus != null) audio.abandonAudioFocusRequest(focus); } catch (Exception ignored) { } }

    public void shutdown() { try { release(); if (tts != null) tts.shutdown(); } catch (Exception ignored) { } }
}
