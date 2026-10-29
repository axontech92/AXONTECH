package com.kiu.agent;

import android.content.Context;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

/* v2.11.12 · DICTADO SIN GOOGLE.
   Si el reconocedor de Google falla (sin Internet, VPN, español sin descargar, servicio caído), Kiu
   escucha igual con el modelo Vosk que ya tiene instalado para la palabra de activación: 100% en el
   teléfono, sin conexión. Es menos preciso que el de Google, pero responde.
   Una sola escucha: habla → silencio de 1,5 s → texto. Libera todo al terminar. */
public class OfflineDictation {
    public interface Cb {
        void onText(String text);

        void onFail(String why);
    }

    private static volatile boolean running = false;
    private static volatile boolean cancel = false;

    public static boolean available(Context c) {
        return WakeWordEngine.modelPresent(c);
    }

    public static boolean busy() {
        return running;
    }

    public static void cancel() {
        cancel = true;
    }

    public static void listen(final Context app, final Cb cb) {
        if (running) {
            return;
        }
        running = true;
        cancel = false;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                Model model = null;
                Recognizer rec = null;
                AudioRecord ar = null;
                KiuAudioEffects audioEffects = null;
                String result = "";
                String why = "no te escuché";
                try {
                    model = new Model(WakeWordEngine.modelDir(app));
                    rec = new Recognizer(model, 16000.0f);
                    int min = AudioRecord.getMinBufferSize(16000, 16, 2);
                    int size = Math.max(min, 8000) * 2;
                    ar = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000, 16, 2, size);
                    if (ar.getState() != AudioRecord.STATE_INITIALIZED) {
                        throw new IllegalStateException("micrófono ocupado");
                    }
                    audioEffects = KiuAudioEffects.attach(ar);
                    ar.startRecording();
                    short[] buf = new short[4000];
                    long t0 = System.currentTimeMillis();
                    long lastVoice = t0;
                    boolean spoke = false;
                    String lastPartial = "";
                    while (!cancel) {
                        long now = System.currentTimeMillis();
                        if (now - t0 > 14000L) {
                            break;
                        }
                        if (!spoke && now - t0 > 8000L) {
                            break;
                        }
                        int n = ar.read(buf, 0, buf.length);
                        if (n <= 0) {
                            Thread.sleep(20L);
                            continue;
                        }
                        if (rec.acceptWaveForm(buf, n)) {
                            String fin = new JSONObject(rec.getResult()).optString("text", "").trim();
                            if (!fin.isEmpty()) {
                                result = fin;
                                break;
                            }
                        } else {
                            String part = new JSONObject(rec.getPartialResult()).optString("partial", "").trim();
                            if (!part.isEmpty()) {
                                spoke = true;
                                if (!part.equals(lastPartial)) {
                                    lastPartial = part;
                                    lastVoice = now;
                                }
                            }
                        }
                        if (spoke && now - lastVoice > 1500L) {
                            result = new JSONObject(rec.getFinalResult()).optString("text", "").trim();
                            break;
                        }
                    }
                } catch (Throwable th) {
                    why = String.valueOf(th.getMessage() == null ? th.toString() : th.getMessage());
                } finally {
                    try { if (audioEffects != null) audioEffects.close(); } catch (Throwable ignored) { }
                    try { if (ar != null) { ar.stop(); } } catch (Throwable ignored) { }
                    try { if (ar != null) { ar.release(); } } catch (Throwable ignored) { }
                    try { if (rec != null) { rec.close(); } } catch (Throwable ignored) { }
                    try { if (model != null) { model.close(); } } catch (Throwable ignored) { }
                    running = false;
                }
                if (cancel) {
                    return;
                }
                if (result == null || result.trim().isEmpty()) {
                    cb.onFail(why);
                } else {
                    cb.onText(result.trim());
                }
            }
        }, "kiu-offline-dictation");
        t.setDaemon(true);
        t.start();
    }
}
