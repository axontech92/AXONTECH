package com.kiu.agent;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/* loaded from: classes.dex */
public class KiuService extends Service {
    public static volatile boolean ACTIVE;
    public static volatile boolean AWAKE;
    private static KiuService SELF;
    public static volatile boolean SUSPENDED;
    private static final Pattern WAKE = Pattern.compile("\\b(?:kiu|ky[uúo]|k[ií][oóu]|q[ií][uo]|qui[uúo]|ci[uú]|chi[uú]|kiw[iy]|k iu|ki u|kiubo|kyuvi)\\b");
    private SpeechRecognizer sr;
    private final Handler h = new Handler(Looper.getMainLooper());
    private int fails = 0;
    private long wakeAt = 0;
    private boolean started = false;
    private boolean listening = false;
    /* v2.11.2: idioma con respaldo. Con es-AR fijo, un teléfono sin ese paquete daba error 12/13
       en bucle y Kiu no escuchaba nunca. */
    private static final String[] LANGS = {"es-US", "es-419", "es-AR", "es-MX", "es-ES", "es"};
    private int langIdx = 0;

    /* v2.9.3 · WATCHDOG. BUG REAL encontrado auditando el arranque de voz.

       El bucle se rearma SOLO desde onResults() y onError(): cycle() pone
       listening=true y vuelve SIN reprogramar, confiando en que el motor de
       voz llame a alguno de los dos. Ese supuesto no siempre se cumple: si
       startListening() arranca y el recognizer se queda colgado (sin red, motor
       Google que no responde, se queda pensando en silencio), NO llega ni
       onResults ni onError. Entonces listening queda en true para siempre,
       cycle() sigue volviendo por el `if (listening) return` y Kiu deja de
       escuchar en silencio: sin error, sin log, sin aviso en pantalla.

       Es el peor modo de falla posible para algo que el usuario describe como
       "no me reconoce la voz": no hay nada que reportar porque nada falló.

       El watchdog no arregla el motor, pero convierte un colgado silencioso e
       infinito en un reintento con backoff que por lo menos se puede ver. */
    private static final long MAX_SESSION_MS = 12000L;
    private long listenSince = 0L;
    private final Runnable cycleR = new Runnable() { // from class: com.kiu.agent.KiuService.1
        @Override // java.lang.Runnable
        public void run() {
            KiuService.this.cycle();
        }
    };
    private final RecognitionListener lis = new RecognitionListener() { // from class: com.kiu.agent.KiuService.2
        @Override // android.speech.RecognitionListener
        public void onBeginningOfSpeech() {
        }

        @Override // android.speech.RecognitionListener
        public void onBufferReceived(byte[] bArr) {
        }

        @Override // android.speech.RecognitionListener
        public void onEndOfSpeech() {
        }

        @Override // android.speech.RecognitionListener
        public void onEvent(int i, Bundle bundle) {
        }

        @Override // android.speech.RecognitionListener
        public void onRmsChanged(float f) {
        }

        @Override // android.speech.RecognitionListener
        public void onReadyForSpeech(Bundle bundle) {
            KiuService.this.fails = Math.max(0, KiuService.this.fails - 1);
        }

        @Override // android.speech.RecognitionListener
        public void onPartialResults(Bundle bundle) {
            KiuService.this.check(bundle, false); /* v2.7.3: los parciales solo detectan "Kiu"; el comando se entrega con el resultado final */
        }

        @Override // android.speech.RecognitionListener
        public void onError(int i) {
            KiuService.this.listening = false;
            if (i == 12 || i == 13) {
                KiuService.this.langIdx = (KiuService.this.langIdx + 1) % KiuService.LANGS.length;
            }
            if (i == 6 || i == 7) {
                KiuService.this.fails = 0;
                KiuService.this.schedule(300L);
            } else {
                KiuService.this.destroy();
                KiuService.access$108(KiuService.this);
                KiuService.this.schedule(i == 8 ? 700L : (Math.min(KiuService.this.fails, 5) * 400) + 300);
            }
        }

        @Override // android.speech.RecognitionListener
        public void onResults(Bundle bundle) {
            KiuService.this.listening = false;
            KiuService.this.fails = 0;
            KiuService.this.check(bundle, true);
            KiuService.this.schedule(KiuService.AWAKE ? 150L : 300L);
        }
    };

    @Override // android.app.Service
    public IBinder onBind(Intent intent) {
        return null;
    }

    static /* synthetic */ int access$108(KiuService kiuService) {
        int i = kiuService.fails;
        kiuService.fails = i + 1;
        return i;
    }

    @Override // android.app.Service
    public void onCreate() {
        super.onCreate();
        SELF = this;
    }

    @Override // android.app.Service
    public int onStartCommand(Intent intent, int i, int i2) {
        /* v2.11.2 · BUG REAL: startForeground() fallaba en silencio. Desde Android 12/14 un
           servicio de MICRÓFONO no puede pasar a primer plano si se arrancó desde segundo plano
           (tras actualizar la app, al reiniciar, o desde la alarma de onTaskRemoved). El catch
           vacío dejaba al servicio vivo SIN foreground: el sistema lo mataba o cerraba la app
           (ForegroundServiceDidNotStartInTimeException) y los ajustes seguían diciendo
           «escuchando». Ahora, si no puede, se apaga limpio, se desmarca «wake» y se avisa. */
        try {
            startForeground(2001, notif());
        } catch (Exception unused) {
            ACTIVE = false;
            try { getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", false).apply(); } catch (Exception ignored) { }
            BootReceiver.askToReactivate(this);
            stopSelf();
            return 2; /* START_NOT_STICKY */
        }
        ACTIVE = true;
        if (!this.started) {
            this.started = true;
            this.h.postDelayed(this.cycleR, 500L);
        }
        return 1;
    }

    @Override // android.app.Service
    public void onDestroy() {
        ACTIVE = false;
        destroy();
        // v2.6.1 (auditoría de memoria): si el sistema destruye el servicio sin
        // actividad viva (deslizar la app de recientes, fin del proceso), liberar
        // el GGUF de la RAM. Si la app sigue abierta (stopWake desde Ajustes) NO
        // se libera: el chat sigue usando el modelo cargado.
        if (MainActivity.inst == null) {
            KiuGenJob.freeAsync();
        }
        SELF = null;
        super.onDestroy();
    }

    @Override // android.app.Service
    public void onTaskRemoved(Intent intent) {
        try {
            AlarmManager alarmManager = (AlarmManager) getSystemService("alarm");
            /* v2.11.2: desde Android 14 no se puede reabrir un servicio de micrófono desde una alarma */
            if (alarmManager != null && Build.VERSION.SDK_INT < 34) {
                alarmManager.setExactAndAllowWhileIdle(2, SystemClock.elapsedRealtime() + 2000, (Build.VERSION.SDK_INT >= 26
                    ? PendingIntent.getForegroundService(this, 99, new Intent(this, (Class<?>) KiuService.class), 1140850688)
                    : PendingIntent.getService(this, 99, new Intent(this, (Class<?>) KiuService.class), 1140850688)) /* v2.7.3: getService desde segundo plano falla en Android 8+ */);
            }
        } catch (Exception unused) {
        }
        super.onTaskRemoved(intent);
    }

    /* v2.11.13: desde cuándo está suspendido (ver la red de seguridad en cycle()) */
    private static volatile long suspendedAt = 0L;

    public static void suspend() {
        SUSPENDED = true;
        suspendedAt = SystemClock.elapsedRealtime();
        KiuService kiuService = SELF;
        if (kiuService != null) {
            kiuService.destroy();
        }
    }

    public static void resumeSoon() {
        SUSPENDED = false;
        KiuService kiuService = SELF;
        if (kiuService != null) {
            kiuService.h.postDelayed(kiuService.cycleR, 500L);
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void schedule(long j) {
        this.h.postDelayed(this.cycleR, j);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void cycle() {
        if (ACTIVE) {
            /* v2.11.13 · BUG: si después de un comando NADIE llamaba a resumeSoon() (respuesta sin voz, voz
               apagada, dictado sin conexión, error), SUSPENDED quedaba en true PARA SIEMPRE y «Kiu» dejaba
               de oírse hasta reiniciar la app. Si lleva más de 20 s suspendido y no hay comando ni voz
               en curso, se reanuda solo. */
            if (SUSPENDED && !MainActivity.COMMAND_BUSY && !MainActivity.SPEAKING
                    && SystemClock.elapsedRealtime() - suspendedAt > 20000L) {
                SUSPENDED = false;
            }
            if (SUSPENDED) {
                schedule(700L);
                return;
            }
            if (MainActivity.SPEAKING && !MainActivity.bargeInOn(this)) {
                schedule(700L);
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                schedule(6000L);
                return;
            }
            if (this.sr == null) {
                try {
                    SpeechRecognizer createSpeechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
                    this.sr = createSpeechRecognizer;
                    createSpeechRecognizer.setRecognitionListener(this.lis);
                } catch (Exception unused) {
                    this.sr = null;
                    schedule(2500L);
                    return;
                }
            }
            if (this.listening) {
                /* watchdog: si la sesión se pasó de tiempo, el motor no avisó.
                   Se destructura y se reintenta con backoff, en vez de quedarse
                   mudo para siempre. */
                if (listenSince > 0L && System.currentTimeMillis() - listenSince > MAX_SESSION_MS) {
                    listening = false;
                    listenSince = 0L;
                    destroy();
                    fails++;
                    schedule(Math.min(fails, 5) * 400L + 300L);
                }
                return;
            }
            Intent intent = new Intent("android.speech.action.RECOGNIZE_SPEECH");
            intent.putExtra("android.speech.extra.LANGUAGE_MODEL", "free_form");
            intent.putExtra("android.speech.extra.LANGUAGE", LANGS[langIdx]);
            intent.putExtra("android.speech.extra.LANGUAGE_PREFERENCE", LANGS[langIdx]);
            intent.putExtra("android.speech.extra.PARTIAL_RESULTS", true);
            intent.putExtra("android.speech.extra.PREFER_OFFLINE", true); /* v2.11.4 */
            intent.putExtra("calling_package", getPackageName());
            intent.putExtra("android.speech.extra.MAX_RESULTS", 3);
            try {
                this.sr.startListening(intent);
                this.listening = true;
                listenSince = System.currentTimeMillis();
            } catch (Exception unused2) {
                destroy();
                schedule(2500L);
            }
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void destroy() {
        this.listening = false;
        listenSince = 0L;
        SpeechRecognizer speechRecognizer = this.sr;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.destroy();
            } catch (Exception unused) {
            }
            this.sr = null;
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public boolean check(Bundle bundle, boolean fin) {
        ArrayList<String> stringArrayList;
        if (!ACTIVE || SUSPENDED || (stringArrayList = bundle.getStringArrayList("results_recognition")) == null) {
            return false;
        }
        if (MainActivity.SPEAKING) {
            return bargeIn(stringArrayList);
        }
        for (int i = 0; i < stringArrayList.size() && i < 3; i++) {
            String str = stringArrayList.get(i);
            if (str != null && !str.trim().isEmpty() && process(str, fin)) {
                return true;
            }
        }
        return false;
    }

    /* v2.11.8 · INTERRUMPIR A KIU: mientras habla, el servicio sigue oyendo. Solo se corta con «Kiu»
       suelto o con una palabra de parada dicha SOLA (el eco de la voz de Kiu llega como frases enteras,
       no como una palabra), y nunca si esa palabra está en lo que Kiu está diciendo ahora. */
    private static final Pattern STOP = Pattern.compile("^(para|basta|silencio|detente|callate|alto|stop|espera|ya basta|ya esta)$");
    /* v2.11.13: despedidas: callan a Kiu Y cuelgan (antes «chao» / «cuelga» no estaban en la lista) */
    private static final Pattern END = Pattern.compile("^(chau|chao|adios|cuelga|cuelgue|colgar|cuelgalo|cortar|corta|termina|terminar|terminemos|hasta luego|nos vemos|eso es todo|listo kiu|gracias kiu)( kiu| ya| por favor)?$");

    private boolean bargeIn(ArrayList<String> list) {
        if (!MainActivity.bargeInOn(this)) {
            return false;
        }
        String said = norm(MainActivity.lastSpokenText());
        for (int i = 0; i < list.size() && i < 3; i++) {
            String n = norm(list.get(i)).trim();
            if (n.isEmpty()) {
                continue;
            }
            Matcher m = WAKE.matcher(n);
            boolean wakeOnly = false;
            if (m.find()) {
                wakeOnly = n.substring(m.end()).trim().length() <= 2 && !WAKE.matcher(said).find();
            }
            boolean inSaid = Pattern.compile("\\b" + Pattern.quote(n) + "\\b").matcher(said).find();
            boolean stopWord = STOP.matcher(n).find() && !inSaid;
            boolean endWord = END.matcher(n).find() && !inSaid;
            if (endWord) {
                beepWake();
                MainActivity.endCallByVoice(getApplicationContext());
                return true;
            }
            if (wakeOnly || stopWord) {
                beepWake();
                MainActivity.interruptSpeech(getApplicationContext(), wakeOnly);
                return true;
            }
        }
        return false;
    }

    private boolean process(String str, boolean fin) {
        String norm = norm(str);
        if (norm.isEmpty()) {
            return false;
        }
        if (AWAKE && System.currentTimeMillis() - this.wakeAt > 10000) {
            AWAKE = false;
        }
        Matcher matcher = WAKE.matcher(norm);
        String replaceFirst = matcher.find() ? norm.substring(matcher.end()).trim().replaceFirst("^[,:.\\-¡!?¿\"']+\\s*", "") : null;
        if (AWAKE) {
            if (replaceFirst != null) {
                norm = replaceFirst;
            }
            if (norm.isEmpty()) {
                schedule(140L);
                return true;
            }
            if (!fin) return false; /* esperar el final: un parcial es una frase a medias */
            AWAKE = false;
            MainActivity.wakeDeliver(getApplicationContext(), norm);
            return true;
        }
        if (replaceFirst == null) {
            return false;
        }
        if (replaceFirst.length() >= 3) {
            if (!fin) return false; /* v2.7.3: antes "kiu llama" se ejecutaba y luego "kiu llama a mama" otra vez */
            AWAKE = false;
            beepWake();
            MainActivity.wakeDeliver(getApplicationContext(), replaceFirst);
            return true;
        }
        AWAKE = true;
        this.wakeAt = System.currentTimeMillis();
        beepWake();
        MainActivity.wakePing(getApplicationContext());
        return true;
    }

    private static String norm(String str) {
        if (str == null) {
            return "";
        }
        String lowerCase = str.toLowerCase();
        StringBuilder sb = new StringBuilder(lowerCase.length());
        for (int i = 0; i < lowerCase.length(); i++) {
            char charAt = lowerCase.charAt(i);
            switch (charAt) {
                case 224:
                case 225:
                case 228:
                    charAt = 'a';
                    break;
                case 232:
                case 233:
                case 235:
                    charAt = 'e';
                    break;
                case 236:
                case 237:
                case 239:
                    charAt = 'i';
                    break;
                case 241:
                    charAt = 'n';
                    break;
                case 242:
                case 243:
                case 246:
                    charAt = 'o';
                    break;
                case 249:
                case 250:
                case 252:
                    charAt = 'u';
                    break;
            }
            sb.append(charAt);
        }
        return sb.toString().trim();
    }

    private void beepWake() {
        try {
            final ToneGenerator toneGenerator = new ToneGenerator(3, 92);
            toneGenerator.startTone(24, 130);
            this.h.postDelayed(new Runnable() { // from class: com.kiu.agent.KiuService.3
                @Override // java.lang.Runnable
                public void run() {
                    try {
                        toneGenerator.release();
                    } catch (Exception unused) {
                    }
                }
            }, 500L);
        } catch (Exception unused) {
        }
        try {
            Vibrator vibrator = (Vibrator) getSystemService("vibrator");
            if (vibrator != null) {
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator.vibrate(VibrationEffect.createOneShot(80L, -1));
                } else {
                    vibrator.vibrate(80L);
                }
            }
        } catch (Exception unused2) {
        }
    }

    private Notification notif() {
        Notification.Builder builder;
        NotificationManager notificationManager = (NotificationManager) getSystemService("notification");
        if (Build.VERSION.SDK_INT >= 26 && notificationManager != null) {
            NotificationChannel notificationChannel = new NotificationChannel("kiu_wake", "Despertar por voz", 2);
            notificationChannel.setDescription("Kiu escucha por la palabra «Kiu»");
            notificationChannel.setSound(null, null);
            notificationChannel.enableVibration(false);
            notificationManager.createNotificationChannel(notificationChannel);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            builder = new Notification.Builder(this, "kiu_wake");
        } else {
            builder = new Notification.Builder(this);
        }
        builder.setContentTitle("Kiu está atento").setContentText("Decí «Kiu» en cualquier momento para activarlo").setSmallIcon(R.drawable.ic_notif).setOngoing(true).setPriority(-1);
        return builder.build();
    }
}
