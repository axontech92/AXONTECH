package com.kiu.agent;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Wake word 100% local y offline (Vosk, gramática cerrada, loop AudioRecord propio).
 *
 * Alternativa al KiuService (SpeechRecognizer de Google) para el modo manos
 * libres: no depende de los servicios de Google ni de red.
 *
 * Modelo: vosk-model-small-es-0.42 (~40 MB descomprimido) colocado en
 *   <.getExternalFilesDir>/models/vosk-es-small/
 * con la estructura del zip oficial, OJO que final.mdl va en am/final.mdl y no
 * en la raíz (v2.9.3: el chequeo miraba la raíz y no encontraba un modelo que
 * estaba perfectamente puesto).
 * (se puede bajar con el gestor de descargas de la app e importar con KiuImport)
 *
 * Uso desde el puente JS: kiuWWStart() / kiuWWStop() / kiuWWState()
 * Al detectar "kiu" dispara el mismo hook que el servicio: nexoWakeHit() y,
 * además, MainActivity.wakeHitAndListen() abre el micrófono del comando (v2.8.1:
 * antes solo encendía un toast y se quedaba ahí, sin forma de pedir nada).
 */
public class WakeWordEngine {
    private static final String DIR_NAME = "vosk-es-small";
    private static final long COOLDOWN_MS = 4000;
    private static final int SAMPLE_RATE = 16000;
    private static final String GRAMMAR = "[\"kiu\",\"hey kiu\",\"iu\",\"ki\"]";

    private static volatile WakeWordEngine inst;

    private volatile Model model;
    private volatile Recognizer recognizer;
    private volatile AudioRecord mic;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean paused = new AtomicBoolean(false);
    private volatile boolean loading = false;
    private volatile String err = "";
    private long lastHit = 0;

    public static WakeWordEngine get() {
        if (inst == null) {
            synchronized (WakeWordEngine.class) {
                if (inst == null) {
                    inst = new WakeWordEngine();
                }
            }
        }
        return inst;
    }

    /* v2.9.3 · BUG REAL: el chequeo del modelo miraba el lugar equivocado.

       El modelo oficial (vosk-model-small-es-0.42) tiene esta estructura:

           vosk-model-small-es-0.42/
             am/final.mdl      <-- acá está
             conf/mfcc.conf
             conf/model.conf
             graph/...

       El código chequeaba <dir>/final.mdl, o sea la RAÍZ. Con el modelo puesto
       exactamente donde dice la documentación, ese archivo no existe: el chequeo
       daba false, el arranque se negaba, y el error que llegaba decía "falta el
       modelo" — que es una mentira: el modelo estaba, en su sitio, y la app
       no lo veía. Encima el síntoma es exactamente el reportado: la palabra de
       activación nunca dispara y no hay forma de saber por qué.

       Se aceptan los dos layouts a propósito: el oficial (am/final.mdl) y el
       "aplanado" (final.mdl en la raíz), que es lo que queda si alguien copió
       el contenido de am/ a mano. La app carga siempre la RAÍZ del modelo en
       Model(), que es lo que Vosk espera. */
    private static File modelRoot(Context ctx) {
        return new File(modelDir(ctx));
    }

    /** ¿Está el modelo local? Acepta el layout oficial (am/final.mdl) y el aplanado. */
    public static boolean modelPresent(Context ctx) {
        try {
            File d = modelRoot(ctx);
            return new File(d, "am/final.mdl").exists() || new File(d, "final.mdl").exists();
        } catch (Throwable th) {
            return false;
        }
    }

    public static String modelDir(Context ctx) {
        File base = KiuDownload.modelsDir(ctx);
        return new File(base, DIR_NAME).getAbsolutePath();
    }

    public String getErr() {
        return err;
    }

    /** Arranca la escucha local (idempotente). Devuelve false si falta modelo o mic. */
    public boolean start(Context ctx) {
        final Context app = ctx.getApplicationContext();
        if (running.get() || loading) {
            return true;
        }
        try {
            if (app.checkSelfPermission("android.permission.RECORD_AUDIO") != 0) {
                err = "falta permiso de microfono";
                return false;
            }
            String dir = modelDir(app);
            if (!new File(dir, "am/final.mdl").exists() && !new File(dir, "final.mdl").exists()) {
                err = "modelo wake word no instalado (models/" + DIR_NAME + ")";
                return false;
            }
            err = "";
            paused.set(false);
            lastHit = 0;
            loading = true;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    WakeWordEngine.this.run(app, dir);
                }
            }, "kiu-wakeword").start();
            return true;
        } catch (Throwable th) {
            loading = false;
            err = String.valueOf(th);
            return false;
        }
    }

    /* v2.9.5 · RECUPERACIÓN DEL MICRÓFONO.
       BUG REAL: cuando AudioRecord.read() devuelve un error (ERROR_DEAD_OBJECT
       cuando el mic lo toma una llamada o otra app), el código ponía el mensaje
       y hacía `continue` SOBRE EL MISMO AudioRecord. Un AudioRecord en estado de
       error no se recupera: hay que stop()/release() y crear otro. Seguir leyendo
       del mismo devuelve el error para siempre.

       El síntoma era el peor posible: atendías un teléfono, cortabas, y la
       palabra de activación no volvía más — hasta que la apagabas y la prendías
       a mano, sin ningún mensaje en el medio.

       Ahora el read-loop se ROTA al primer error de mic y el loop de afuera
       reconstruye el AudioRecord con backoff. Si no vuelve después de varios
       intentos, se rinde y lo DICE (running=false), en vez de quedarse mudo
       fingiendo que escucha. */
    private static final int MIC_RETRY_BASE_MS = 500;
    private static final int MIC_RETRY_MAX_MS = 8000;
    private static final int MIC_MAX_RETRIES = 8;

    /* Estado que devuelve el read-loop. Un int plano, no un enum: lo más simple
       es lo que menos se rompe.
       Son SOLO DOS, a propósito. Había un tercer estado (OK) que nadie
       devolvía, y el `reset()` del backoff estaba colgado de él: el backoff
       nunca se reiniciaba, así que después de 8 micro-fallos repartidos a lo
       largo de una sesión, Kiu se rendía para siempre. El backoff se resetea
       en el sitio donde tiene sentido: cuando el micrófono ABRE, no cuando la
       sesión termina. */
    private static final int LECHO_MIC_MUERTO = 1;   // hay que reconstruir el AudioRecord
    private static final int LECHO_PARADO = 2;       // el usuario apagó la palabra de activación

    private void run(Context app, String dir) {
        try {
            model = new Model(dir);
            recognizer = new Recognizer(model, (float) SAMPLE_RATE, GRAMMAR);
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            int bufSize = Math.max(minBuf, SAMPLE_RATE); // 1s
            short[] buf = new short[3200];                 // 200 ms
            running.set(true);
            loading = false;

            Backoff espera = new Backoff(MIC_RETRY_BASE_MS, MIC_RETRY_MAX_MS, MIC_MAX_RETRIES);

            while (running.get()) {
                int st = escucharUnaVez(bufSize, buf, espera);
                if (st != LECHO_MIC_MUERTO) {
                    break;   // LECHO_PARADO: lo apagó el usuario
                }
                /* LECHO_MIC_MUERTO: el read-loop ya terminó y soltó el AudioRecord.
                   Se reconstruye con backoff; si se agotan los intentos se RINDE
                   Y LO DICE, en vez de quedarse mudo fingiendo que escucha. */
                long d = espera.siguiente();
                if (d < 0) {
                    err = "el microfono no volvio (ocupado por otra app o por el sistema)";
                    running.set(false);
                    break;
                }
                avisar("nexoWakeError('" + err.replace("'", "") + "')");
                dormir(d);
            }
        } catch (Throwable th) {
            err = "wake word: " + th;
        } finally {
            running.set(false);
            loading = false;
            mic = null;
            cerrarRecon();
            cerrarModelo();
            if (MainActivity.inst != null) {
                MainActivity.inst.js("nexoWakeState(false)");
            }
        }
    }

    /** Crea un AudioRecord, escucha hasta que algo pare, y devuelve el estado. */
    private int escucharUnaVez(int bufSize, short[] buf, Backoff espera) {
        AudioRecord a = null;
        KiuAudioEffects audioEffects = null;
        try {
            a = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (a.getState() != AudioRecord.STATE_INITIALIZED) {
                err = "microfono ocupado por otra app";
                return LECHO_MIC_MUERTO;
            }
            mic = a;
            audioEffects = KiuAudioEffects.attach(a);
            a.startRecording();
            /* el mic abrió de verdad: el error anterior (si hubo) ya no dice
               nada. Sin esto el mensaje quedaba pegado para toda la sesión
               aunque todo volviera a funcionar (bug 2 de esta tanda).

               Y el backoff arranca de cero: los fallos anteriores quedaron
               atrás. El motivo es que el presupuesto de reintentos es POR
               MICROFONO, no por sesión: si una app toma el micro un rato y lo
               suelta, ese contratiempo no puede gastar los reintentos de los
               próximos treinta minutos. */
            err = "";
            espera.reset();
            avisar("nexoWakeState(true)");

            boolean limpio = true;
            long lastRmsSent = 0;
            while (running.get()) {
                /* v2.11.6 · BUG REAL «código 7 / no me escucha»: pause() solo levantaba una bandera y este
                   AudioRecord seguía GRABANDO mientras el reconocedor de Google intentaba oírte. Con dos
                   clientes de micrófono, Android (10+ / HyperOS) silencia al segundo: el reconocedor recibía
                   silencio y devolvía «no te entendí». Ahora, mientras hay un comando en curso, el micrófono
                   se SUELTA de verdad (stop) y se vuelve a abrir al terminar. */
                if (paused.get() || MainActivity.COMMAND_BUSY) {
                    try { a.stop(); } catch (Throwable ignored) { }
                    while (running.get() && (paused.get() || MainActivity.COMMAND_BUSY)) {
                        if (!dormir(60L)) {
                            return LECHO_PARADO;
                        }
                    }
                    if (!running.get()) {
                        return LECHO_PARADO;
                    }
                    try {
                        a.startRecording();
                    } catch (Throwable t) {
                        err = "microfono: " + t;
                        return LECHO_MIC_MUERTO;
                    }
                    reseteaRecon();
                    limpio = true;
                    continue;
                }
                int n = a.read(buf, 0, buf.length);
                if (n <= 0) {
                    if (paused.get() || MainActivity.COMMAND_BUSY) {
                        continue; /* lo paró pause() desde otro hilo: lo atiende el bloque de arriba */
                    }
                    if (n == AudioRecord.ERROR_INVALID_OPERATION || n == AudioRecord.ERROR_BAD_VALUE
                            || n == AudioRecord.ERROR_DEAD_OBJECT) {
                        /* El mic murió. NO se sigue leyendo: hay que liberar y
                           reconstruir, y de eso se encarga el loop de arriba. */
                        err = "microfono no disponible (lo tomo otra app o el sistema)";
                        return LECHO_MIC_MUERTO;
                    }
                    /* elsewhere: buffer a medio llenar. Antes esto era un
                       busy-spin (100 % de CPU de un hilo, para siempre). */
                    if (!dormir(80L)) {
                        return LECHO_PARADO;
                    }
                    continue;
                }
                /* RMS del micrófono (dBFS), limitado a 2 muestras/segundo para no
                   añadir carga apreciable al hilo de escucha. Solo se emite telemetría.
                   No se guarda ni se envía audio crudo. */
                long rmsNow = System.currentTimeMillis();
                if (rmsNow - lastRmsSent >= 500L && MainActivity.inst != null) {
                    double sumSquares = 0.0;
                    for (int ri = 0; ri < n; ri++) { double sample = buf[ri]; sumSquares += sample * sample; }
                    double rms = Math.sqrt(sumSquares / Math.max(1, n));
                    double dbfs = rms > 0 ? 20.0 * Math.log10(rms / 32768.0) : -96.0;
                    if (dbfs < -96.0) dbfs = -96.0;
                    if (dbfs > 0.0) dbfs = 0.0;
                    try {
                        MainActivity activity = MainActivity.inst;
                        if (activity != null) activity.js("if(window.nexoVoiceRms)window.nexoVoiceRms(" + String.format(java.util.Locale.US, "%.1f", dbfs) + ")");
                    } catch (Throwable ignored) { }
                    lastRmsSent = rmsNow;
                }
                /* Mientras Kiu habla por TTS no escuchamos (evita auto-disparo),
                   y tampoco mientras el reconocedor de comando tiene el micro: este
                   bucle ya lo consumió, así que no puede volver a activarse. */
                if (MainActivity.SPEAKING || MainActivity.COMMAND_BUSY || paused.get()) {
                    /* Al entrar en silencio se resetea el decodificador UNA vez: si
                       no, la palabra a medio decir de antes se junta con la próxima
                       frase y «Kiu» vuelve a dispararse solo. (org.vosk.Recognizer
                       no tiene setPartialHypothesis; reset() sí, y es lo correcto.) */
                    if (!limpio) {
                        reseteaRecon();
                        limpio = true;
                    }
                    continue;
                }
                limpio = false;
                Recognizer r = recognizer;
                if (r == null) {
                    return LECHO_PARADO;
                }
                if (r.acceptWaveForm(buf, n)) {
                    check(r.getResult());
                } else {
                    check(r.getPartialResult());
                }
            }
            return LECHO_PARADO;
        } catch (Throwable th) {
            err = "microfono: " + th;
            return LECHO_MIC_MUERTO;
        } finally {
            mic = null;
            try { if (audioEffects != null) audioEffects.close(); } catch (Throwable ignored) { }
            try {
                if (a != null) {
                    a.stop();
                    a.release();
                }
            } catch (Throwable unused) {
            }
        }
    }

    private void reseteaRecon() {
        Recognizer rr = recognizer;
        if (rr != null) {
            try {
                rr.reset();
            } catch (Throwable ignored) {
            }
        }
    }

    private void cerrarRecon() {
        try {
            Recognizer r = recognizer;
            if (r != null) {
                r.close();
            }
        } catch (Throwable unused) {
        }
        recognizer = null;
    }

    private void cerrarModelo() {
        try {
            Model m = model;
            if (m != null) {
                m.close();
            }
        } catch (Throwable unused) {
        }
        model = null;
    }

    private void avisar(String js) {
        MainActivity m = MainActivity.inst;
        if (m != null) {
            m.js(js);
        }
    }

    /** Duerme. Devuelve false si lo interrumpieron (o si hay que parar). */
    private boolean dormir(long ms) {
        try {
            Thread.sleep(ms);
            return true;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void check(String json) {
        try {
            if (json == null) {
                return;
            }
            JSONObject o = new JSONObject(json);
            String text = o.optString("partial", o.optString("text", ""));
            if (text.length() > 0 && text.toLowerCase().contains("kiu")) {
                long now = System.currentTimeMillis();
                if (now - lastHit > COOLDOWN_MS) {
                    lastHit = now;
                    /* v2.8.1: antes esto solo encendía nexoWakeHit() (un toast) y
                       se moría ahí. La palabra de activación sin comando detrás no
                       sirve de nada. Ahora el mismo hook del servicio: avisar que
                       te escuchan Y abrir el micrófono para que digas el pedido.
                       El bucle se pausa solo mientras el comando se escucha
                       (MainActivity.COMMAND_BUSY) para no pelear por el micro. */
                    MainActivity.wakeHitAndListen(appCtx());
                }
            }
        } catch (Throwable unused) {
        }
    }

    /** Cede el micrófono mientras otro reconocedor (el del comando) está activo. */
    public void pause() {
        paused.set(true);
        /* v2.11.6: soltar el micrófono YA, no esperar a que el bucle de lectura lo note */
        try {
            AudioRecord a = mic;
            if (a != null) {
                a.stop();
            }
        } catch (Throwable ignored) {
        }
    }

    public void resume() {
        paused.set(false);
    }

    public boolean isPaused() {
        return paused.get();
    }

    private Context appCtx() {
        MainActivity m = MainActivity.inst;
        return m != null ? m.getApplicationContext() : null;
    }

    /** Detiene la escucha local y libera el modelo (idempotente). */
    public void stop() {
        running.set(false);
        paused.set(false);
        try {
            AudioRecord a = mic;
            if (a != null) {
                a.stop();
            }
        } catch (Throwable unused) {
        }
    }

    public boolean isRunning() {
        return running.get() || loading;
    }

    /** JSON de estado para el puente JS. */
    public String statusJson(Context ctx) {
        boolean present = modelPresent(ctx);
        String s = running.get() ? (paused.get() ? "pause" : "run") : (loading ? "load" : "idle");
        StringBuilder sb = new StringBuilder();
        sb.append("{\"st\":\"").append(s).append("\"");
        sb.append(",\"present\":").append(present);
        sb.append(",\"err\":\"").append(err.replace("\"", "'")).append("\"");
        sb.append(",\"path\":\"").append(modelDir(ctx).replace("\"", "'")).append("\"");
        sb.append("}");
        return sb.toString();
    }
}
