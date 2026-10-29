package com.kiu.agent;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.SharedPreferences;
import android.content.IntentFilter;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.ToneGenerator;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.CalendarContract;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.text.TextUtils;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/* loaded from: classes.dex */
public class MainActivity extends Activity {
    private static final Map<String, String> APP_MAP;
    private static final int REQ_CONTACTS = 4244;
    /* v2.9.0: leer la agenda ("¿qué tengo mañana?") */
    private static final int REQ_CALENDAR = 4245;
    /* v2.17.0: leer SMS y ubicación aproximada */
    private static final int REQ_SMS = 4246;
    private static final int REQ_LOCATION = 4247;
    private static final int REQ_MIC = 4242;
    private static final int REQ_NOTIF = 4243;
    public static volatile boolean SPEAKING;
    /* v2.8.1: hay UN solo micrófono. Cuando el motor de wake word local (Vosk) tiene
       el suyo agarrado, el reconocedor del comando no puede abrirlo; esta bandera le
       dice a WakeWordEngine que ceda el paso y espere. */
    public static volatile boolean COMMAND_BUSY;
    /* v2.4.0: JSON de la copia en vuelo entre kiuDataExport y onActivityResult(7102) */
    volatile String pendingExport = null;
    static MainActivity inst;
    private BroadcastReceiver alarmFired;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    /* visible-de-paquete: KiuJsPost (mismo paquete) necesita inyectar JS */
    WebView web;
    /* v2.11.0: último aviso de nivel de voz enviado a la UI (para no inundar el puente) */
    private long lastRmsMs = 0L;
    /* v2.11.1: idiomas a probar si el servicio de voz rechaza el anterior, y si hay que
       volver al reconocedor por defecto cuando el elegido no se deja usar. */
    /* v2.11.5: es-US primero. El paquete sin conexión más común (y el único que traía el teléfono de
       quien reportó el fallo) es «Español (EE.UU.)»; pedir es-AR/es-ES sin Internet daba error 12/13. */
    private static final String[] SPEECH_LANGS = {"es-US", "es-419", "es-AR", "es-MX", "es-ES", "es"};
    private int speechLangIdx = 0;
    /* v2.11.12: lo que muestra la pantalla «Estado y diagnóstico» */
    static volatile int LAST_ERR = 0;
    static volatile long LAST_ERR_AT = 0L;
    static volatile String LAST_REC = "";
    static volatile long LAST_TTS_ERR_AT = 0L;
    static volatile String LAST_OFFLINE = "";
    private boolean recForceDefault = false;
    /* v2.3.0 (sección 2 · seguridad): sirve la UI por https://appassets.androidplatform.net
       (origen seguro gestionado por androidx.webkit) en vez de file:// — así la WebView
       no necesita permisos universales de lectura de archivos. */
    WebViewAssetLoader assetLoader;
    static final String ASSET_BASE = "https://appassets.androidplatform.net/assets/";
    private boolean ttsReady = false;
    private String ttsErr = "";
    private Runnable ttsRetry;   // reintento de arranque del TTS, pendiente de correr

    /* v2.10.1 · EL SALUDO SE PERDIA EN SILENCIO.
       El saludo sale a los 1,6 s de abrir la app, y el TTS de Android tarda
       1-3 s en arrancar en frio. speak() hacia `return` si ttsReady era false,
       pero el JS creia que habia hablado (un metodo void devuelve undefined y
       bridge() lo toma como exito): el saludo se perdia, se marcaba como ya
       dado (20 min de espera) y, como nunca llegaba onDone, tampoco se abria el
       micro: la conversacion continua moria en el primer turno.
       Ahora la frase se guarda y se dice apenas el TTS esta listo. */
    private volatile String pendingSpeak = null;
    private volatile long pendingSpeakAt = 0L;
    private volatile boolean ttsGaveUp = false;
    private boolean micAskedOnce = false;
    private Runnable micWatch = null;
    private static final long MIC_WATCHDOG_MS = 20000L;

    /* v2.9.3: escape para armar JSON a mano desde Java.
       Los nombres de paquete de los servicios de voz y el motor de TTS vienen
       del sistema: son valores que NO controlamos nosotros y un nombre raro (con
       comilla o barra) rompería el JSON entero y el diagnóstico volvería a ser
       inútil justo cuando hay que usarlo. */
    static String q(String s) {
        if (s == null) {
            return "\"\"";
        }
        StringBuilder b = new StringBuilder(s.length() + 8);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c == '\n') {
                b.append("\\n");
            } else if (c == '\r') {
                b.append("\\r");
            } else if (c == '\t') {
                b.append("\\t");
            } else if (c < 0x20) {
                b.append(String.format(java.util.Locale.US, "\\u%04x", (int) c));
            } else {
                b.append(c);
            }
        }
        return b.append('"').toString();
    }
    private float ttsRate = 1.0f;
    private boolean pendingListen = false;
    private boolean pendingWake = false;
    private volatile boolean handsFree = true;
    private boolean convArmed = false;
    private long lastConvBeat = 0;
    private volatile boolean resumed = true;
    private String pendingCmd = null;
    private boolean pageReady = false;
    private float ttsPitch = 1.0f;
    private final Handler tHandler = new Handler(Looper.getMainLooper());
    private Runnable tRun = null;
    private final Runnable convOpen = new Runnable() { // from class: com.kiu.agent.MainActivity.4
        @Override // java.lang.Runnable
        public void run() {
            MainActivity.this.openConvMic();
        }
    };

    private void fatalUi(Throwable th) {
        try {
            TextView textView = new TextView(this);
            textView.setGravity(17);
            textView.setTextSize(14.0f);
            textView.setBackgroundColor(-16777216);
            textView.setTextColor(-1);
            textView.setPadding(48, 32, 48, 32);
            textView.setText("Kiu no pudo iniciar\n\n" + th.toString() + "\n\n(Enviar captura de esta pantalla al soporte)");
            setContentView(textView);
        } catch (Throwable th2) {
        }
    }

    @Override // android.app.Activity
    protected void onActivityResult(int i, int i2, Intent intent) {
        Uri data;
        super.onActivityResult(i, i2, intent);
        if (i2 != -1 || intent == null || (data = intent.getData()) == null) {
            return;
        }
        if (i == 7101) {
            KiuImport.begin(this, data);
            return;
        }
        /* v2.10.1: modelo de voz (zip) elegido desde el selector, sin volver a descargarlo */
        if (i == KiuVoskInstall.REQ_PICK) {
            KiuVoskInstall.importFrom(this, data);
            return;
        }
        /* v2.4.0 (sección 1): copia de seguridad completa vía SAF */
        if (i == 7102) {
            writeDataBackup(data);
            return;
        }
        if (i == 7103) {
            readDataBackup(data);
            return;
        }
        /* v2.5.0 (sección 4-a): skill instalable desde archivo */
        if (i == 7104) {
            readSkillFile(data);
        }
    }

    /* v2.5.0: lee el JSON del skill (SAF) y se lo entrega a KiuSkills */
    private void readSkillFile(Uri uri) {
        try {
            java.io.InputStream is = getContentResolver().openInputStream(uri);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            int cap = 512 * 1024;
            while ((n = is.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > cap) throw new IllegalStateException("skill demasiado grande");
            }
            is.close();
            String json = new String(bos.toByteArray(), "UTF-8");
            new Thread(new KiuJsPost("window.kiuSkillInstall && window.kiuSkillInstall(" + jsonQuote(json) + ");")).start();
        } catch (Throwable t) {
            String msg = "No pude leer el skill: " + t.getMessage();
            new Thread(new KiuJsPost("window.App && App.toast(" + jsq(msg) + ");")).start();
        }
    }

    /* v2.4.0: escribe el JSON de la copia (kiuDataExport) en el documento elegido */
    private void writeDataBackup(Uri uri) {
        String json = this.pendingExport;
        this.pendingExport = null;
        boolean ok = false;
        String msg;
        try {
            if (json != null && json.length() > 2) {
                java.io.OutputStream os = getContentResolver().openOutputStream(uri, "wt");
                if (os != null) {
                    os.write(json.getBytes("UTF-8"));
                    os.flush();
                    os.close();
                    ok = true;
                }
            }
        } catch (Throwable t) {
            ok = false;
        }
        msg = ok ? "Copia completa guardada ✓ (ajustes, memoria, chats, documentos)"
                 : "No pude escribir la copia en el archivo elegido";
        new Thread(new KiuJsPost("window.App && App.toast(" + jsq(msg) + ");")).start();
    }

    /* v2.4.0: lee el JSON de la copia y se lo entrega a la UI para restaurar */
    private void readDataBackup(Uri uri) {
        try {
            java.io.InputStream is = getContentResolver().openInputStream(uri);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            int cap = 30 * 1048576;
            while ((n = is.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > cap) throw new IllegalStateException("copia demasiado grande");
            }
            is.close();
            String json = new String(bos.toByteArray(), "UTF-8");
            new Thread(new KiuJsPost("window.kiuDataRestore && window.kiuDataRestore(" + jsonQuote(json) + ");")).start();
        } catch (Throwable t) {
            String msg = "No pude leer la copia: " + t;
            new Thread(new KiuJsPost("window.App && App.toast(" + jsq(msg) + ");")).start();
        }
    }

    private static String jsq(String s) {
        return jsonQuote(s == null ? "" : s);
    }

    private static String jsonQuote(String s) {
        try {
            return org.json.JSONObject.quote(s == null ? "" : s);
        } catch (Throwable t) {
            return "\"\"";
        }
    }

    @Override // android.app.Activity
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        KiuCrypto.init(this); /* v2.11.10: respaldo de claves si el Keystore falla */
        try {
            getWindow().setStatusBarColor(-16777216);
            getWindow().setNavigationBarColor(-16777216);
            WebView webView = new WebView(this);
            this.web = webView;
            setContentView(webView);
            WebSettings settings = this.web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(false);
            /* v2.3.0: el origen nuevo es https (appassets.androidplatform.net); ya no
               hace falta —y no conviene— el acceso universal desde file://. Se deja
               allowFileAccess=true SOLO para el ferry único de migración de datos. */
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setCacheMode(-1);
            settings.setTextZoom(100);
            this.web.setBackgroundColor(-16777216);
            this.web.setOverScrollMode(2);
            this.web.setWebViewClient(new WebViewClient() { // from class: com.kiu.agent.MainActivity.1
                /* v2.3.0: cada petición (html/js/css/img/fetch a assets) pasa por el
                   AssetLoader; lo que no es del origen seguro sigue su curso. */
                @Override // android.webkit.WebViewClient
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    try {
                        WebResourceResponse r = assetLoader.shouldInterceptRequest(request.getUrl());
                        if (r != null) return r;
                    } catch (Throwable ignored) { }
                    return null;
                }

                @Override // android.webkit.WebViewClient
                public boolean shouldOverrideUrlLoading(WebView webView2, String str) {
                    if (str == null) return false;
                    if (str.startsWith("appassets.androidplatform.net") || Uri.parse(str).getHost() != null
                            && "appassets.androidplatform.net".equals(Uri.parse(str).getHost())) return false;
                    if (str.startsWith("file://")) return true; /* sin navegación file:// */
                    try {
                        MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(str)));
                        return true;
                    } catch (Exception unused) {
                        return true;
                    }
                }
            });
            this.web.setWebChromeClient(new WebChromeClient() { // from class: com.kiu.agent.MainActivity.2
                @Override // android.webkit.WebChromeClient
                public void onPermissionRequest(final PermissionRequest permissionRequest) {
                    MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.2.1
                        @Override // java.lang.Runnable
                        public void run() {
                            if (MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") == 0) {
                                /* v2.7.2: solo audio, y solo desde nuestro origen; nunca camara u otros recursos */
                                java.util.ArrayList<String> okRes = new java.util.ArrayList<String>();
                                boolean ownOrigin = permissionRequest.getOrigin() != null
                                        && "appassets.androidplatform.net".equals(permissionRequest.getOrigin().getHost());
                                if (ownOrigin) {
                                    for (String r : permissionRequest.getResources()) {
                                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) okRes.add(r);
                                    }
                                }
                                if (okRes.isEmpty()) permissionRequest.deny();
                                else permissionRequest.grant(okRes.toArray(new String[0]));
                            } else {
                                permissionRequest.deny();
                            }
                        }
                    });
                }
            });
            this.web.addJavascriptInterface(new Bridge(), "KiuBridge");
            inst = this;
            initTts();
            Alarms.rescheduleAll(this);
            /* v2.8.0: si hay una alarma disparada mientras la app está viva, el bot
               se entera (estado 'Disparado'). El broadcast es interno. */
            alarmFired = new BroadcastReceiver() {
                @Override // android.content.BroadcastReceiver
                public void onReceive(Context ctx, Intent i) {
                    String id = i.getStringExtra("id");
                    String t = i.getStringExtra("title");
                    MainActivity.this.js("nexoAlarmFired(" + MainActivity.this.jsStr(t == null ? "" : t)
                            + "," + MainActivity.this.jsStr(id == null ? "" : id) + ")");
                }
            };
            try {
                IntentFilter af = new IntentFilter(ReminderReceiver.ACTION_FIRED);
                if (Build.VERSION.SDK_INT >= 33) {
                    registerReceiver(alarmFired, af, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    registerReceiver(alarmFired, af);
                }
            } catch (Exception ignored) {
            }
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
            }
            /* v2.3.0: primer arranque de la app nueva → un único pase "ferry" por el
               origen viejo (file://) para llevar localStorage al origen seguro; después
               se sirve todo por https://appassets.androidplatform.net para siempre. */
            assetLoader = new WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                    .build();
            if (getSharedPreferences("kiu_ferry", 0).getBoolean("done", false)) {
                this.web.loadUrl(ASSET_BASE + "www/index.html");
            } else {
                this.web.loadUrl("file:///android_asset/www/index.html?ferry=1");
            }
            handleExtras(getIntent());
        } catch (Throwable th) {
            fatalUi(th);
        }
    }

    private void handleExtras(Intent intent) {
        String stringExtra;
        if (intent == null || (stringExtra = intent.getStringExtra("cmd")) == null || stringExtra.trim().isEmpty()) {
            return;
        }
        intent.removeExtra("cmd");
        if (this.pageReady) {
            js("nexoWakeCmd(" + jsStr(stringExtra) + ")");
            return;
        }
        this.pendingCmd = stringExtra;
    }

    /* v2.9.5 · EL TTS PODÍA NO ARRANCAR NUNCA, EN SILENCIO.

       initTts() se llamaba UNA sola vez, en onCreate. ttsReady se ponía en true
       únicamente dentro de la rama `i == 0`. Si el motor de TTS no estaba listo
       en ese instante —muy común en arranque en frío, y también cuando el
       servicio de voz se instala o actualiza después de la app— el init
       fallaba, ttsReady quedaba false PARA TODA LA VIDA de la app, speak()
       hacía return en la primera línea, y no había toast, ni error, ni
       reintento: nadie se enteraba.

       El síntoma era exactamente el reportado: "el audio no funciona".

       Ahora reintenta con backoff y, si de verdad no arranca, lo DICE por el
       puente (nexoVoiceError) para que se vea en el diagnóstico de voz. Un
       fallo que no se anuncia no se puede arreglar: el usuario no tiene forma
       de distinguir "Kiu está pensando" de "Kiu no tiene voz". */
    private static final int TTS_RETRY_BASE_MS = 700;
    private static final int TTS_RETRY_MAX_MS = 5000;
    private static final int TTS_MAX_RETRIES = 4;

    private Backoff ttsBackoff;
    /* v2.11.4: lo último que se dijo y si ya se reintentó con una voz local */
    private volatile String lastSpoken = "";
    private volatile boolean ttsRetried = false;

    private void initTts() {
        this.ttsBackoff = new Backoff(TTS_RETRY_BASE_MS, TTS_RETRY_MAX_MS, TTS_MAX_RETRIES);
        doInitTts();
    }

    /** Un intento de arranque del TTS. Reintenta solo mientras `ttsPending`. */
    private void doInitTts() {
        /* Reintentar sin cerrar el anterior deja un motor de voz vivo por
           intento: cada uno tiene su binder y su proceso. Con cuatro intentos no
           es una-catástrofe, pero el leak es gratis de evitar. */
        if (this.tts != null) {
            try {
                this.tts.shutdown();
            } catch (Throwable ignored) {
            }
            this.tts = null;
        }
        this.tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() { // from class: com.kiu.agent.MainActivity.3
            @Override // android.speech.tts.TextToSpeech.OnInitListener
            public void onInit(int i) {
                if (i == 0) {
                    Locale[] localeArr = {new Locale("es", "US"), new Locale("es", "AR"), new Locale("es", "MX"), new Locale("es", "ES"), new Locale("es")};
                    for (int i2 = 0; i2 < 5; i2++) {
                        int language = MainActivity.this.tts.setLanguage(localeArr[i2]);
                        if (language != -1 && language != -2) {
                            break;
                        }
                    }
                    MainActivity.this.pickBestVoice();
                    MainActivity.this.tts.setSpeechRate(MainActivity.this.ttsRate);
                    MainActivity.this.tts.setPitch(MainActivity.this.ttsPitch);
                    MainActivity.this.tts.setOnUtteranceProgressListener(new UtteranceProgressListener() { // from class: com.kiu.agent.MainActivity.3.1
                        @Override // android.speech.tts.UtteranceProgressListener
                        public void onStart(String str) {
                            MainActivity.this.ttsRetried = false;
                            MainActivity.SPEAKING = true;
                            MainActivity.this.js("nexoTtsStart()");
                        }

                        @Override // android.speech.tts.UtteranceProgressListener
                        public void onDone(String str) {
                            MainActivity.SPEAKING = false;
                            MainActivity.this.js("nexoTtsDone()");
                            KiuService.resumeSoon();
                            MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
                            if (MainActivity.this.handsFree && MainActivity.this.resumed) {
                                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                                MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 700L);
                            }
                        }

                        @Override // android.speech.tts.UtteranceProgressListener
                        public void onError(String str) {
                            MainActivity.LAST_TTS_ERR_AT = System.currentTimeMillis();
                            MainActivity.SPEAKING = false;
                            /* v2.11.4 · antes un fallo al hablar era silencioso. Primero se reintenta UNA vez
                               con una voz instalada en el teléfono; si tampoco, se avisa con el motivo. */
                            final String again = MainActivity.this.lastSpoken;
                            if (!MainActivity.this.ttsRetried && again != null && again.length() > 0) {
                                MainActivity.this.ttsRetried = true;
                                MainActivity.this.runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        try {
                                            MainActivity.this.pickVoice(false);
                                            MainActivity.this.speakNow(again);
                                        } catch (Throwable ignored) {
                                        }
                                    }
                                });
                                return;
                            }
                            MainActivity.this.js("nexoVoiceError('sin voz: el motor de voz no pudo hablar. Probá sin VPN o instalá la voz en español sin conexión')");
                            MainActivity.this.js("nexoTtsDone()");
                            KiuService.resumeSoon();
                            MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
                            if (MainActivity.this.handsFree && MainActivity.this.resumed) {
                                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                                MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 700L);
                            }
                        }
                    });
                    MainActivity.this.ttsReady = true;
                    MainActivity.this.ttsGaveUp = false;
                    MainActivity.this.ttsErr = "";
                    MainActivity.this.flushPendingSpeak();
                } else {
                    /* no arrancó: se intenta de nuevo con backoff. Al agotar los
                       intentos se avisa, porque "no tengo voz" y "estoy pensando"
                       se ven igual desde afuera. */
                    MainActivity.this.ttsReady = false;
                    MainActivity.this.ttsErr = "el motor de voz no arranco (codigo " + i + ")";
                    MainActivity.this.retryTts();
                }
            }
        });
    }

    /** Dice `str` ya. Solo se llama con el TTS listo. */
    private void speakNow(final String str) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                tHandler.removeCallbacks(convOpen);
                stopSpeech();
            }
        });
        this.tts.setSpeechRate(this.ttsRate);
        this.tts.setPitch(this.ttsPitch);
        this.lastSpoken = str;
        Bundle bundle = new Bundle();
        if (this.tts.speak(str, 0, bundle, "kiu_utt") == -1) {
            /* speak() devolvió ERROR de inmediato: mismo trato que un fallo al hablar */
            js("nexoVoiceError('sin voz: el motor de voz rechazó el texto')");
        }
    }

    /** TTS todavia no listo: guarda la frase (solo la ultima) para decirla al arrancar.
        Si el TTS ya se rindio, avisa fin igual para que la conversacion no se corte. */
    private void queueSpeak(String str) {
        if (this.ttsGaveUp) {
            js("nexoTtsDone()");
            this.lastConvBeat = SystemClock.elapsedRealtime();
            if (this.handsFree && this.resumed) {
                this.tHandler.removeCallbacks(this.convOpen);
                this.tHandler.postDelayed(this.convOpen, 700L);
            }
            return;
        }
        this.pendingSpeak = str;
        this.pendingSpeakAt = SystemClock.elapsedRealtime();
    }

    /** Dice lo que quedo en cola, salvo que ya este viejo (mas de 20 s). */
    private void flushPendingSpeak() {
        String p = this.pendingSpeak;
        this.pendingSpeak = null;
        if (p == null) {
            return;
        }
        if (SystemClock.elapsedRealtime() - this.pendingSpeakAt > 20000L) {
            return;
        }
        speakNow(p);
    }

    /** Reintenta el arranque del TTS. Si no queda nada, lo dice una vez. */
    private void retryTts() {
        if (this.ttsBackoff == null) {
            return;
        }
        long d = this.ttsBackoff.siguiente();
        if (d < 0) {
            this.ttsGaveUp = true;
            this.pendingSpeak = null;
            js("nexoVoiceError('sin voz: el motor de TTS no arranco')");
            return;
        }
        if (this.ttsRetry != null) {
            this.tHandler.removeCallbacks(this.ttsRetry);
        }
        this.ttsRetry = new Runnable() { // from class: com.kiu.agent.MainActivity.3.2
            @Override // java.lang.Runnable
            public void run() {
                MainActivity.this.ttsRetry = null;
                doInitTts();
            }
        };
        this.tHandler.postDelayed(this.ttsRetry, d);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void pickBestVoice() {
        /* v2.11.4 · Kiu daba +10 a las voces «network» de Google, que necesitan Internet de Google. Con
           una VPN o sin datos esas voces fallan y Kiu se quedaba MUDO sin avisar. Ahora se prefiere
           una voz instalada en el teléfono; la de red solo si no hay ninguna local.
           *
           * v2.14.6 · SE INVIERTE: PRIMERO LA DE RED.
           El miedo era infundado: el TTS YA REINTENTA con una voz local cuando la
           de red falla (onError → ttsRetried → pickVoice(false) → speakNow). O sea
           que se podía usar la voz buena sin riesgo de dejar a Kiu mudo.
           Y la diferencia se oye muchísimo: las voces «network»/«neural» de
           Google suenan como una persona; la del sistema suena a robot. Con
           internet: la mejor. Sin internet: la local, como antes. */
        if (hayRed() && pickVoice(true)) {
            return;   /* la que suena natural */
        }
        if (!pickVoice(false)) {
            pickVoice(true);
        }
    }

    /* v2.14.6 · ¿ESTÁ EL TELÉFONO CONECTADO? Para decidir si se puede usar
       una voz de red (que necesita internet) o hay que quedarse con la local. */
    private boolean hayRed() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) {
                return false;
            }
            Network n = cm.getActiveNetwork();
            if (n == null) {
                return false;
            }
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean pickVoice(boolean allowNet) {
        try {
            Set<Voice> voices = this.tts.getVoices();
            if (voices != null && !voices.isEmpty()) {
                Voice voice = null;
                int i = -1;
                for (Voice voice2 : voices) {
                    Locale locale = voice2.getLocale();
                    if (locale != null && locale.getLanguage().startsWith("es")) {
                        boolean needNet = false;
                        boolean notInst = false;
                        try {
                            needNet = voice2.isNetworkConnectionRequired();
                            Set<String> ft = voice2.getFeatures();
                            notInst = ft != null && ft.contains("notInstalled");
                        } catch (Throwable ignored) {
                        }
                        if (notInst || (needNet && !allowNet)) {
                            continue;
                        }
                        String lowerCase = voice2.getName().toLowerCase(Locale.US);
                        int i2 = lowerCase.contains("network") ? 10 : 0;
                        if (lowerCase.contains("neural") || lowerCase.contains("journey") || lowerCase.contains("studio") || lowerCase.contains("wave")) {
                            i2 += 6;
                        }
                        if (lowerCase.contains("google")) {
                            i2 += 5;
                        }
                        if (lowerCase.contains("female")) {
                            i2++;
                        }
                        String country = locale.getCountry() == null ? "" : locale.getCountry();
                        if ("AR".equals(country)) {
                            i2 += 3;
                        } else if ("MX".equals(country) || "ES".equals(country) || "US".equals(country)) {
                            i2 += 2;
                        }
                        if (voice2.getQuality() >= 400) {
                            i2 += 4;
                        } else if (voice2.getQuality() >= 300) {
                            i2++;
                        }
                        if (i2 > i) {
                            voice = voice2;
                            i = i2;
                        }
                    }
                }
                if (voice != null) {
                    this.tts.setVoice(voice);
                    return true;
                }
            }
        } catch (Exception unused) {
        }
        return false;
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void openConvMic() {
        /* v2.8.1: si el micrófono del comando ya está abierto, no lo reabrimos. El
           rearme lo disparan dos cosas (el fin del TTS en Java y, sin voz, el propio
           JS): con dos reconocidores vivos el segundo destruye al primero a mitad de
           frase y la conversación se corta sola. */
        if (COMMAND_BUSY) {
            return;
        }
        if (this.handsFree && this.resumed && !SPEAKING) {
            /* v2.10.1: sin permiso de micro, startSpeech() fallaba con
               ERROR_INSUFFICIENT_PERMISSIONS y el bucle de conversacion reintentaba
               14 s sin decir nada. Se pide una vez; al aceptar, escucha. */
            if (checkSelfPermission("android.permission.RECORD_AUDIO") != 0) {
                if (!this.micAskedOnce) {
                    this.micAskedOnce = true;
                    this.pendingListen = true;
                    requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, REQ_MIC);
                }
                return;
            }
            startSpeech();
        }
    }

    /* v2.10.1 · PERRO GUARDIAN DEL MICROFONO. Si el reconocedor se cuelga sin
       llamar a onResults ni a onError (pasa tras destroy()+create() seguidos),
       COMMAND_BUSY quedaba en true para siempre y openConvMic() volvia siempre por
       su primera linea: la conversacion continua se apagaba sin ningun mensaje.
       KiuService ya tenia su watchdog; el reconocedor del comando no. */
    private void armMicWatch(final SpeechRecognizer owner) {
        if (this.micWatch != null) {
            this.tHandler.removeCallbacks(this.micWatch);
        }
        this.micWatch = new Runnable() {
            @Override
            public void run() {
                micWatch = null;
                if (recognizer != owner) {
                    return;
                }
                stopSpeech();
                boolean again = convArmed && handsFree && resumed && convWindowOpen(lastConvBeat);
                js("nexoListenEnd()");
                if (again) {
                    tHandler.removeCallbacks(convOpen);
                    tHandler.postDelayed(convOpen, 800L);
                    return;
                }
                convArmed = false;
                KiuService.resumeSoon();
                if (pendingListen) {
                    pendingListen = false;
                    js("nexoVoiceError('error')");
                }
            }
        };
        this.tHandler.postDelayed(this.micWatch, MIC_WATCHDOG_MS);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public static boolean convWindowOpen(long j) {
        /* v2.11.11: 30 s (antes 14) para empezar a contestar; en 14 s la charla se cortaba sola */
        return SystemClock.elapsedRealtime() - j < 30000;
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void timerFire(String str) {
        this.tRun = null;
        new Thread(new Runnable() { // from class: com.kiu.agent.MainActivity.5
            @Override // java.lang.Runnable
            public void run() {
                try {
                    ToneGenerator toneGenerator = new ToneGenerator(4, 100);
                    for (int i = 0; i < 3; i++) {
                        toneGenerator.startTone(28, 320);
                        try {
                            Thread.sleep(480L);
                        } catch (Exception unused) {
                        }
                    }
                    toneGenerator.release();
                } catch (Exception unused2) {
                }
            }
        }).start();
        vibrateNow(600);
        try {
            ReminderReceiver.notify(this, "Temporizador: " + str);
        } catch (Exception unused) {
        }
        MainActivity mainActivity = inst;
        if (mainActivity != null) {
            mainActivity.js("nexoTimerDone(" + jsStr(str) + ")");
        }
    }

    private void vibrateNow(int i) {
        try {
            Vibrator vibrator = (Vibrator) getSystemService("vibrator");
            if (vibrator == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createOneShot(i, -1));
            } else {
                vibrator.vibrate(i);
            }
        } catch (Exception unused) {
        }
    }

    /* v2.7.3: antirrebote — el mismo comando dos veces en 4 s (motores Vosk/SpeechRecognizer
       que repiten el final) no se ejecuta dos veces. */
    private static String lastWakeCmd = "";
    private static long lastWakeAt = 0;
    private static synchronized boolean wakeDup(String s) {
        long now = SystemClock.elapsedRealtime();
        String k = s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
        if (k.equals(lastWakeCmd) && now - lastWakeAt < 4000) return true;
        lastWakeCmd = k;
        lastWakeAt = now;
        return false;
    }

    static void wakeDeliver(Context context, String str) {
        if (wakeDup(str)) return;
        MainActivity mainActivity = inst;
        if (mainActivity != null) {
            /* v2.14.2 · EL COMANDO NO SE PIERDE EN UN ARRANQUE EN FRÍO.
               `inst` puede existir sin que la página esté lista: la actividad
               se creó y el WebView todavía está cargando. evaluateJavascript
               sobre una página a medio cargar no ejecuta nada, así que el
               comando se descartaba EN SILENCIO: la persona decía "Kiu, poné
               una alarma" y no pasaba nada.
               Ahora, si la página no está lista, el comando queda en
               pendingCmd y lo entrega pageReady(), igual que el extra del
               Intent. */
            if (mainActivity.pageReady) {
                mainActivity.js("nexoWakeCmd(" + mainActivity.jsStr(str) + ")");
            } else {
                mainActivity.pendingCmd = str;
            }
            return;
        }
        try {
            Intent intent = new Intent(context, (Class<?>) MainActivity.class);
            intent.addFlags(805306368);
            intent.putExtra("cmd", str);
            context.startActivity(intent);
        } catch (Exception unused) {
        }
    }

    static void wakePing(Context context) {
        MainActivity mainActivity = inst;
        if (mainActivity != null) {
            mainActivity.js("nexoWakeHit()");
            /* v2.11.8 · decir solo «Kiu» sonaba el pitido y no abría nada: el servicio se quedaba esperando
               el comando él mismo, sin pantalla ni conversación. Con Kiu abierto, ahora abre el micrófono
               de la app (igual que el motor local) y el servicio no entrega el mismo comando dos veces. */
            if (mainActivity.resumed && !SPEAKING && !COMMAND_BUSY) {
                KiuService.AWAKE = false;
                wakeHitAndListen(context);
            }
        }
    }

    /* v2.11.8 · poder cortar a Kiu mientras habla (con la voz, con «Kiu» o una palabra de parada) */
    static String lastSpokenText() {
        MainActivity m = inst;
        return m == null ? "" : String.valueOf(m.lastSpoken);
    }

    static boolean bargeInOn(Context context) {
        try {
            return context.getSharedPreferences("kiu_native", 0).getBoolean("bargein", true);
        } catch (Throwable t) {
            return true;
        }
    }

    /* v2.11.13: «chao», «cuelga»… dichos mientras Kiu habla: lo callan Y terminan la charla */
    static void endCallByVoice(Context context) {
        MainActivity m = inst;
        interruptSpeech(context, false);
        if (m != null) {
            m.js("nexoEndCall()");
        }
    }

    static void interruptSpeech(Context context, boolean thenListen) {
        final MainActivity m = inst;
        if (m == null) {
            return;
        }
        SPEAKING = false;
        try {
            if (m.tts != null) {
                m.tts.stop();
            }
        } catch (Throwable ignored) {
        }
        m.js("nexoTtsDone()");
        m.js("nexoWakeHit()");
        if (thenListen && m.resumed) {
            m.tHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (!COMMAND_BUSY) {
                        m.startSpeech();
                    }
                }
            }, 350L);
        }
    }

    /* v2.8.1 — la palabra de activación tiene que abrir la puerta, no solo tocar el
       timbre. Antes (y sobre todo en el motor local Vosk) «Kiu» encendía un toast y se
       quedaba ahí: el usuario no tenía forma de decir el pedido. Ahora:
         1) avisa que te escucha (nexoWakeHit → el bot se pone en 'Escuchando'),
         2) cede el micro al reconocedor del comando,
         3) abre el micrófono para que digas lo que querés,
         4) como el comando llega por nexoOnVoice, Kiu contesta; que después siga
            escuchando es lo que decide el modo manos libres (startSpeech arma
            convArmed con handsFree), no esta llamada.
       No lo hace con la app en segundo plano ni mientras suena el TTS: una sesión
       de manos libres no interrumpe lo que Kiu está diciendo. */
    static void wakeHitAndListen(Context context) {
        final MainActivity m = inst;
        if (m == null) {
            return;
        }
        m.js("nexoWakeHit()");
        if (!m.resumed || SPEAKING || COMMAND_BUSY) {
            return;
        }
        m.tHandler.post(new Runnable() {
            @Override // java.lang.Runnable
            public void run() {
                if (COMMAND_BUSY) {
                    return;
                }
                m.startSpeech();
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void startWakeNow() {
        runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.6
            @Override // java.lang.Runnable
            public void run() {
                /* v2.8.1: wake word 100% local (Vosk) sin Google ni red, si el modelo
                   está instalado. Antes esto solo ocurría con la preferencia wwLocal
                   puesta, y esa preferencia solo la ponía kiuWWStart(), que la UI
                   nunca llamaba: el motor local era código muerto. Ahora que el modelo
                   esté en la carpeta alcanza, y se recuerda que ya se eligió local. */
                SharedPreferences sp = MainActivity.this.getSharedPreferences("kiu_native", 0);
                /* v2.11.13 · EL MOTOR POR DEFECTO ES EL DE GOOGLE (servicio), no Vosk. Con el modelo Vosk
                   instalado, Kiu pasaba SOLO al motor local, que (1) depende de que «kiu» exista en el
                   vocabulario del modelo (no es una palabra del español), y (2) NO puede oír «chao» /
                   «basta» mientras Kiu habla. Resultado: «Kiu» no activaba y no se lo podía cortar.
                   Vosk queda como respaldo si Google no está, o si se elige a propósito (wwLocalPref). */
                boolean googleOk = SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
                boolean wwLocal = sp.getBoolean("wwLocalPref", false) || !googleOk;
                if (wwLocal && WakeWordEngine.modelPresent(MainActivity.this)) {
                    boolean ok = WakeWordEngine.get().start(MainActivity.this);
                    MainActivity.this.getSharedPreferences("kiu_native", 0)
                            .edit().putBoolean("wwLocal", true).putBoolean("wake", ok).apply();
                    if (!ok) {
                        MainActivity.this.js("nexoWakeError('"
                                + WakeWordEngine.get().getErr().replace("'", "") + "')");
                    }
                    MainActivity.this.js("nexoWakeState(" + ok + ")");
                    return;
                }
                if (!SpeechRecognizer.isRecognitionAvailable(MainActivity.this)) {
                    /* v2.8.1: sin motor de reconocimiento no hay palabra de activación
                       posible, y antes arrancaba igual el servicio: la app figuraba
                       "despierta" para siempre sin escuchar nada. */
                    MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", false).apply();
                    MainActivity.this.js("nexoWakeError('no hay servicio de voz en el sistema')");
                    MainActivity.this.js("nexoWakeState(false)");
                    return;
                }
                if (Build.VERSION.SDK_INT >= 33 && MainActivity.this.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
                    MainActivity.this.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, MainActivity.REQ_NOTIF);
                    return;
                }
                try {
                    try { WakeWordEngine.get().stop(); } catch (Throwable ignored) { } /* un solo micrófono */
                    sp.edit().putBoolean("wwLocal", false).apply();
                    Intent intent = new Intent(MainActivity.this, (Class<?>) KiuService.class);
                    if (Build.VERSION.SDK_INT >= 26) {
                        MainActivity.this.startForegroundService(intent);
                    } else {
                        MainActivity.this.startService(intent);
                    }
                    MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", true).apply();
                    MainActivity.this.js("nexoWakeState(true)");
                } catch (Exception unused) {
                    MainActivity.this.js("nexoWakeState(false)");
                }
            }
        });
    }

    static {
        HashMap hashMap = new HashMap();
        APP_MAP = hashMap;
        hashMap.put("whatsapp", "com.whatsapp");
        hashMap.put("wsp", "com.whatsapp");
        hashMap.put("instagram", "com.instagram.android");
        hashMap.put("insta", "com.instagram.android");
        hashMap.put("facebook", "com.facebook.katana");
        hashMap.put("youtube", "com.google.android.youtube");
        hashMap.put("spotify", "com.spotify.music");
        hashMap.put("gmail", "com.google.android.gm");
        hashMap.put("correo", "com.google.android.gm");
        hashMap.put("mapas", "com.google.android.apps.maps");
        hashMap.put("chrome", "com.android.chrome");
        hashMap.put("telegram", "org.telegram.messenger");
        hashMap.put("tiktok", "com.zhiliaoapp.musically");
        hashMap.put("netflix", "com.netflix.mediaclient");
        hashMap.put("twitter", "com.twitter.android");
        hashMap.put("play store", "com.android.vending");
        hashMap.put("tienda", "com.android.vending");
        hashMap.put("reloj", "com.google.android.deskclock");
        hashMap.put("calendario", "com.google.android.calendar");
        hashMap.put("agenda", "com.google.android.calendar");
        hashMap.put("calculadora", "com.google.android.calculator");
        hashMap.put("notas", "com.google.android.keep");
        hashMap.put("musica", "com.google.android.apps.youtube.music");
    }

    static String javaNorm(String str) {
        if (str == null) {
            return "";
        }
        String trim = str.toLowerCase().trim();
        StringBuilder sb = new StringBuilder(trim.length());
        for (int i = 0; i < trim.length(); i++) {
            char charAt = trim.charAt(i);
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
            if (Character.isLetterOrDigit(charAt) || charAt == ' ') {
                sb.append(charAt);
            }
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    private class Bridge {
        @JavascriptInterface
        public String decSec(String str) {
            try {
                return KiuCrypto.dec(str);
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public void dlCancel(String str) {
            try {
                KiuDownload.cancel(str);
            } catch (Throwable th) {
            }
        }

        @JavascriptInterface
        public boolean dlDel(String str) {
            try {
                return KiuDownload.del(MainActivity.this, str);
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public long dlFree() {
            try {
                return KiuDownload.free(MainActivity.this);
            } catch (Throwable th) {
                return 0L;
            }
        }

        @JavascriptInterface
        public String dlList() {
            try {
                return KiuDownload.list(MainActivity.this);
            } catch (Throwable th) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String dlStart(String str, String str2, String str3) {
            try {
                return KiuDownload.start(MainActivity.this, str, str2, str3);
            } catch (Throwable th) {
                return "{\"st\":\"error\",\"err\":\"no se pudo iniciar\"}";
            }
        }

        /* v2.4.0: con SHA-256 esperado del catálogo (sección 1) */
        @JavascriptInterface
        public String dlStart2(String str, String str2, String str3, String str4) {
            try {
                return KiuDownload.start(MainActivity.this, str, str2, str3, str4);
            } catch (Throwable th) {
                return "{\"st\":\"error\",\"err\":\"no se pudo iniciar\"}";
            }
        }

        /* v2.11.3: actualizar la app sin salir de ella. updStart baja el APK (se consulta con
           dlStatus y se cancela con dlCancel); updInstall lo entrega al instalador de Android. */
        /* v2.11.12 · pantalla «Estado y diagnóstico»: todo lo que importa de la voz, los permisos y las
           claves en un solo JSON (sin claves ni datos personales) */
        @JavascriptInterface
        public String kiuStatus() {
            try {
                MainActivity a = MainActivity.this;
                JSONObject o = new JSONObject();
                android.content.pm.PackageInfo pi = a.getPackageManager().getPackageInfo(a.getPackageName(), 0);
                o.put("version", pi.versionName);
                o.put("android", Build.VERSION.SDK_INT);
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("mic", a.checkSelfPermission("android.permission.RECORD_AUDIO") == 0);
                o.put("notif", Build.VERSION.SDK_INT < 33 || a.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == 0);
                o.put("installOk", Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls());
                o.put("sttAvail", SpeechRecognizer.isRecognitionAvailable(a));
                o.put("rec", LAST_REC);
                o.put("errCode", LAST_ERR);
                o.put("errAgo", LAST_ERR_AT == 0L ? -1L : (System.currentTimeMillis() - LAST_ERR_AT) / 1000L);
                String vn = "";
                try {
                    Voice v = a.tts == null ? null : a.tts.getVoice();
                    vn = v == null ? "" : v.getName() + (v.isNetworkConnectionRequired() ? " (usa Internet)" : " (en el teléfono)");
                } catch (Throwable ignored) { }
                o.put("ttsVoice", vn);
                o.put("ttsErrAgo", LAST_TTS_ERR_AT == 0L ? -1L : (System.currentTimeMillis() - LAST_TTS_ERR_AT) / 1000L);
                o.put("wakeSvc", KiuService.ACTIVE);
                o.put("voskModel", WakeWordEngine.modelPresent(a));
                o.put("voskRun", WakeWordEngine.get().isRunning());
                o.put("offline", LAST_OFFLINE);
                o.put("bargeIn", bargeInOn(a));
                o.put("crypto", KiuCrypto.selfTest());
                return o.toString();
            } catch (Throwable th) {
                return "{\"err\":\"" + String.valueOf(th).replace("\"", "'") + "\"}";
            }
        }

        /* v2.11.8: aviso de versión nueva en la barra de notificaciones */
        @JavascriptInterface
        public void notifyUpdate(String str, String str2) {
            KiuUpdate.notifyAvailable(MainActivity.this.getApplicationContext(), str, str2);
        }

        /* v2.11.8: interrumpir a Kiu con la voz mientras habla (interruptor en Ajustes) */
        @JavascriptInterface
        public void setBargeIn(boolean z) {
            MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("bargein", z).apply();
        }

        @JavascriptInterface
        public String updStart(String str, String str2, String str3, String str4) {
            try {
                return KiuDownload.startApk(MainActivity.this, str, str2, str3, str4);
            } catch (Throwable th) {
                return "{\"id\":\"\",\"st\":\"error\",\"err\":\"no se pudo iniciar\"}";
            }
        }

        @JavascriptInterface
        public String updInstall(String str) {
            try {
                return KiuUpdate.install(MainActivity.this, str);
            } catch (Throwable th) {
                return "err:" + th;
            }
        }

        @JavascriptInterface
        public String dlStatus(String str) {
            try {
                return KiuDownload.status(str);
            } catch (Throwable th) {
                return "{\"st\":\"error\"}";
            }
        }

        @JavascriptInterface
        public String encSec(String str) {
            try {
                return KiuCrypto.enc(str);
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public void gc() {
            Runtime.getRuntime().gc();
        }

        @JavascriptInterface
        public String impStatus() {
            try {
                return KiuImport.status();
            } catch (Throwable th) {
                return "{\"st\":\"err\"}";
            }
        }

        @JavascriptInterface
        public void importCancel() {
            try {
                KiuImport.cancel();
            } catch (Throwable unused) {
            }
        }

        @JavascriptInterface
        public void importModel() {
            try {
                KiuImport.pick(MainActivity.this);
            } catch (Throwable unused) {
            }
        }

        /* v2.4.0 (sección 1): copia de seguridad completa vía SAF.
           kiuDataExport(json): abre "Crear documento" (.json) y escribe el JSON.
           kiuDataImport(): abre "Abrir documento" y entrega el JSON a la UI vía
           window.kiuDataRestore(...) (KiuJsPost). Sin claves API: quedan en el
           Keystore del teléfono y nunca viajan en el archivo. */
        @JavascriptInterface
        public boolean kiuDataExport(String json) {
            try {
                if (json == null || json.length() < 2 || json.length() > 30 * 1048576) return false;
                MainActivity.this.pendingExport = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                String stamp = new java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(new java.util.Date());
                i.putExtra(Intent.EXTRA_TITLE, "kiu-copia-" + stamp + ".json");
                MainActivity.this.startActivityForResult(i, 7102);
                return true;
            } catch (Throwable t) {
                MainActivity.this.pendingExport = null;
                return false;
            }
        }

        @JavascriptInterface
        public boolean kiuDataImport() {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                MainActivity.this.startActivityForResult(i, 7103);
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        /* ============ v2.5.0 · sección 4 (funciones nuevas) ============ */

        /* 4-b: resumen matutino — agenda/cancela la alarma diaria */
        @JavascriptInterface
        public boolean kiuMorningSet(final int hour, final int minute, final boolean on) {
            try {
                if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
                MainActivity.this.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        MorningReceiver.set(MainActivity.this, hour, minute, on);
                    }
                });
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public String kiuMorningGet() {
            try {
                return MorningReceiver.get(MainActivity.this);
            } catch (Throwable t) {
                return "{\"on\":false,\"hour\":8,\"minute\":0}";
            }
        }

        /* 4-a: skills — abre "Abrir documento" y entrega el JSON a window.kiuSkillInstall */
        @JavascriptInterface
        public boolean kiuSkillImport() {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                MainActivity.this.startActivityForResult(i, 7104);
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        /** v2.11.20: devuelve embedding del modelo local como JSON; nunca usa red. */
        @JavascriptInterface
        public String embedLocalText(String text) {
            try {
                float[] vector = KiuNative.embedText(text == null ? "" : text);
                if (vector == null || vector.length == 0) return "";
                StringBuilder json = new StringBuilder(vector.length * 10 + 2);
                json.append('[');
                for (int i = 0; i < vector.length; i++) {
                    if (i > 0) json.append(',');
                    if (Float.isNaN(vector[i]) || Float.isInfinite(vector[i])) return "";
                    json.append(Float.toString(vector[i]));
                }
                json.append(']');
                return json.toString();
            } catch (Throwable t) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean kiuLoaded() {
            try { return KiuNative.isLoaded(); } catch (Throwable t) { return false; }
        }

        @JavascriptInterface
        public boolean kiuAvailable() {
            try {
                return KiuNative.available();
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public String kiuNativeLoadError() {
            try {
                return KiuNative.loadError();
            } catch (Throwable th) {
                return th.getClass().getSimpleName() + ": " + String.valueOf(th.getMessage());
            }
        }

        @JavascriptInterface
        public void kiuFree() {
            try {
                if (KiuGenJob.busy) {
                    return;
                }
                KiuGenJob.busy = true;
                KiuGenJob.jt = 3;
                new Thread(new KiuGenJob()).start();
            } catch (Throwable th) {
            }
        }

        @JavascriptInterface
        public boolean kiuGen(String str, int i, float f) {
            try {
                /* v2.11.21: la comprobación y la reserva deben ser atómicas si
                   llegan a la vez una pregunta de chat y una solicitud del agente. */
                synchronized (KiuGenJob.class) {
                    if (KiuGenJob.busy) return false;
                    KiuGenJob.busy = true;
                    KiuGenJob.jt = 2;
                    KiuGenJob.a1 = str;
                    KiuGenJob.a2 = i;
                    KiuGenJob.a3 = f;
                    new Thread(new KiuGenJob(), "kiu-generate").start();
                    return true;
                }
            } catch (Throwable th) {
                KiuGenJob.busy = false;
                return false;
            }
        }

        @JavascriptInterface
        public String kiuGenStatus() {
            try {
                return KiuNative.genStatus();
            } catch (Throwable th) {
                return "{\"text\":\"\",\"done\":true,\"toks\":0,\"tps\":0}";
            }
        }

        @JavascriptInterface
        public void kiuGenStop() {
            // Solo solicita cancelacion. El worker mantiene busy=true hasta salir
            // de JNI; liberarlo aqui permitia aceptar otra tarea mientras la anterior
            // seguia dentro de generate(), dejando el estado y las respuestas cruzados.
            try { KiuNative.stopGen(); } catch (Throwable ignored) { }
        }

        /* v2.13.3: plantilla de chat del modelo cargado (para elegir el formato del prompt). */
        @JavascriptInterface
        public String kiuChatTemplate() {
            try {
                String t = KiuNative.chatTemplate();
                return t == null ? "" : t;
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean kiuIsLoaded() {
            try {
                return KiuNative.isLoaded();
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean kiuLoad(String str, int i, int i2) {
            try {
                if (KiuGenJob.busy) {
                    return false;
                }
                KiuGenJob.busy = true;
                KiuGenJob.jt = 1;
                KiuGenJob.a1 = str;
                KiuGenJob.a2 = i;
                KiuGenJob.a4 = i2;
                new Thread(new KiuGenJob()).start();
                return true;
            } catch (Throwable th) {
                KiuGenJob.busy = false;
                return false;
            }
        }

        @JavascriptInterface
        public String kiuLoadProgress() {
            try {
                return KiuNative.loadProgress();
            } catch (Throwable th) {
                return "{\"pct\":0,\"loading\":false,\"ready\":false,\"threads\":0}";
            }
        }

        @JavascriptInterface
        public void kiuResetBusy() {
            // Compatibilidad con el puente JS antiguo: esto NO puede falsificar
            // el estado de ejecucion. Solo pide detener; KiuGenJob.run() es el
            // unico responsable de liberar busy cuando el trabajo realmente termina.
            try { KiuNative.stopGen(); } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String sysInfo() {
            try {
                StringBuilder sb = new StringBuilder();
                MainActivity mainActivity = MainActivity.this;
                ActivityManager activityManager = (ActivityManager) mainActivity.getSystemService("activity");
                ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
                activityManager.getMemoryInfo(memoryInfo);
                sb.append("{\"ramTotal\":");
                sb.append(memoryInfo.totalMem);
                sb.append(",\"ramAvail\":");
                sb.append(memoryInfo.availMem);
                // v2.11.13 · telemetría real del proceso KIU (PSS, memoria física proporcional).
                // No sustituye a la RAM libre del sistema: permite distinguir ambas métricas.
                try {
                    int pid = android.os.Process.myPid();
                    Debug.MemoryInfo[] procMem = activityManager.getProcessMemoryInfo(new int[]{pid});
                    if (procMem != null && procMem.length > 0) {
                        sb.append(",\"appPssKb\":");
                        sb.append(Math.max(0, procMem[0].getTotalPss()));
                    }
                } catch (Throwable ignored) { }
                sb.append(",\"nativeLoaded\":");
                sb.append(KiuNative.isLoaded() ? "true" : "false");
                sb.append(",\"nativeTps\":");
                try { sb.append(Math.max(0f, KiuNative.tokensPerSec())); }
                catch (Throwable ignored) { sb.append("0"); }
                StatFs statFs = new StatFs(Environment.getDataDirectory().getPath());
                sb.append(",\"diskTotal\":");
                sb.append(statFs.getTotalBytes());
                sb.append(",\"diskFree\":");
                sb.append(statFs.getAvailableBytes());
                int availableProcessors = Runtime.getRuntime().availableProcessors();
                sb.append(",\"cores\":");
                sb.append(availableProcessors);
                sb.append(",\"model\":\"");
                String str = Build.MODEL;
                if (str != null) {
                    sb.append(str.replace("\\", "").replace("\"", ""));
                }
                sb.append("\"");
                sb.append(",\"os\":\"Android ");
                sb.append(Build.VERSION.RELEASE);
                sb.append("\"");
                Intent registerReceiver = mainActivity.registerReceiver(null, new IntentFilter("android.intent.action.BATTERY_CHANGED"));
                if (registerReceiver != null) {
                    int intExtra = registerReceiver.getIntExtra("level", -1);
                    int intExtra2 = registerReceiver.getIntExtra("scale", -1);
                    int intExtra3 = registerReceiver.getIntExtra("status", -1);
                    int intExtra4 = registerReceiver.getIntExtra("temperature", 0);
                    sb.append(",\"bat\":");
                    if (intExtra2 > 0 && intExtra >= 0) {
                        sb.append((intExtra * 100) / intExtra2);
                    }
                    sb.append(",\"charging\":");
                    if (intExtra3 == 2 || intExtra3 == 5) {
                        sb.append("true");
                    } else {
                        sb.append("false");
                    }
                    sb.append(",\"temp\":");
                    sb.append(intExtra4 / 10.0f);
                }
                sb.append("}");
                return sb.toString();
            } catch (Throwable th) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String version() {
            return "1.4.0";
        }

        private Bridge() {
        }

        @JavascriptInterface
        public void speak(String str) {
            if (TextUtils.isEmpty(str)) {
                return;
            }
            if (!MainActivity.this.ttsReady) {
                MainActivity.this.queueSpeak(str);
                return;
            }
            MainActivity.this.speakNow(str);
        }

        @JavascriptInterface
        public void stopSpeak() {
            MainActivity.SPEAKING = false;
            if (MainActivity.this.tts != null) {
                MainActivity.this.tts.stop();
            }
        }

        @JavascriptInterface
        public void setRate(float f) {
            MainActivity.this.ttsRate = f;
            if (MainActivity.this.ttsReady) {
                MainActivity.this.tts.setSpeechRate(f);
            }
        }

        @JavascriptInterface
        public void setPitch(float f) {
            MainActivity.this.ttsPitch = f;
            if (MainActivity.this.ttsReady) {
                MainActivity.this.tts.setPitch(f);
            }
        }

        @JavascriptInterface
        public void setVoiceName(String str) {
            if (str == null || str.trim().isEmpty()) {
                MainActivity.this.pickBestVoice();
                return;
            }
            try {
                Set<Voice> voices = MainActivity.this.tts.getVoices();
                if (voices == null) {
                    return;
                }
                for (Voice voice : voices) {
                    if (str.equals(voice.getName())) {
                        MainActivity.this.tts.setVoice(voice);
                        return;
                    }
                }
            } catch (Exception unused) {
            }
        }

        @JavascriptInterface
        public String listVoices() {
            Set<Voice> voices;
            JSONArray jSONArray = new JSONArray();
            if (!MainActivity.this.ttsReady || (voices = MainActivity.this.tts.getVoices()) == null) {
                return "[]";
            }
            ArrayList arrayList = new ArrayList();
            for (Voice voice : voices) {
                if (voice.getLocale() != null && voice.getLocale().getLanguage().startsWith("es")) {
                    arrayList.add(voice);
                }
            }
            Collections.sort(arrayList, new Comparator<Voice>() { // from class: com.kiu.agent.MainActivity.Bridge.2
                @Override // java.util.Comparator
                public int compare(Voice voice2, Voice voice3) {
                    return Bridge.this.scoreVoice(voice3) - Bridge.this.scoreVoice(voice2);
                }
            });
            int min = Math.min(arrayList.size(), 40);
            for (int i = 0; i < min; i++) {
                try {
                    Voice voice2 = (Voice) arrayList.get(i);
                    JSONObject jSONObject = new JSONObject();
                    jSONObject.put("name", voice2.getName());
                    jSONObject.put("locale", voice2.getLocale().toLanguageTag());
                    jSONObject.put("q", voice2.getQuality());
                    jSONObject.put("net", voice2.isNetworkConnectionRequired());
                    jSONArray.put(jSONObject);
                } catch (Exception unused) {
                }
            }
            return jSONArray.toString();
        }

        int scoreVoice(Voice voice) {
            String lowerCase = voice.getName().toLowerCase(Locale.US);
            int i = lowerCase.contains("network") ? 10 : 0;
            if (lowerCase.contains("neural") || lowerCase.contains("journey") || lowerCase.contains("studio")) {
                i += 6;
            }
            if (lowerCase.contains("google")) {
                i += 5;
            }
            return voice.getQuality() >= 400 ? i + 4 : i;
        }

        @JavascriptInterface
        public void setHandsFree(boolean z) {
            MainActivity.this.handsFree = z;
            if (z) {
                return;
            }
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.3
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    MainActivity.this.convArmed = false;
                }
            });
        }

        @JavascriptInterface
        public void cancelListen() {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.4
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.convArmed = false;
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    OfflineDictation.cancel();
                    MainActivity.this.stopSpeech();
                    KiuService.resumeSoon();
                    MainActivity.this.js("nexoListenEnd()");
                }
            });
        }

        @JavascriptInterface
        public void pageReady() {
            MainActivity.this.pageReady = true;
            if (MainActivity.this.pendingCmd != null) {
                String str = MainActivity.this.pendingCmd;
                MainActivity.this.pendingCmd = null;
                MainActivity.this.js("nexoWakeCmd(" + MainActivity.this.jsStr(str) + ")");
            }
        }

        @JavascriptInterface
        public void listen() {
            /* v2.10.1: un pedido explicito de escuchar es un latido fresco. Con un
               modelo local lento la respuesta tarda mas de 14 s y la ventana de
               rearme ya estaba cerrada: tras el primer silencio la conversacion
               se cortaba. Los reintentos usan convOpen, no listen(): no hay bucle. */
            MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
            KiuService.suspend();
            MainActivity.this.pendingListen = true;
            if (MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") != 0) {
                MainActivity.this.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, MainActivity.REQ_MIC);
            } else {
                MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.5
                    @Override // java.lang.Runnable
                    public void run() {
                        MainActivity.this.startSpeech();
                    }
                });
            }
        }

        @JavascriptInterface
        public void vibrate(final int i) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.6
                @Override // java.lang.Runnable
                public void run() {
                    try {
                        Vibrator vibrator = (Vibrator) MainActivity.this.getSystemService("vibrator");
                        if (vibrator == null) {
                            return;
                        }
                        if (Build.VERSION.SDK_INT >= 26) {
                            vibrator.vibrate(VibrationEffect.createOneShot(Math.max(20, i), -1));
                        } else {
                            vibrator.vibrate(Math.max(20, i));
                        }
                    } catch (Exception unused) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void keepOn(final boolean z) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.7
                @Override // java.lang.Runnable
                public void run() {
                    if (z) {
                        MainActivity.this.getWindow().addFlags(128);
                    } else {
                        MainActivity.this.getWindow().clearFlags(128);
                    }
                }
            });
        }

        @JavascriptInterface
        public void bright(final boolean z) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.8
                @Override // java.lang.Runnable
                public void run() {
                    WindowManager.LayoutParams attributes = MainActivity.this.getWindow().getAttributes();
                    attributes.screenBrightness = z ? 1.0f : -1.0f;
                    MainActivity.this.getWindow().setAttributes(attributes);
                }
            });
        }

        @JavascriptInterface
        public void toast(final String str) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.9
                @Override // java.lang.Runnable
                public void run() {
                    Toast.makeText(MainActivity.this, str, 0).show();
                }
            });
        }

        @JavascriptInterface
        public boolean share(String str) {
            try {
                Intent intent = new Intent("android.intent.action.SEND");
                intent.setType("text/plain");
                intent.putExtra("android.intent.extra.TEXT", str);
                MainActivity.this.startActivity(Intent.createChooser(intent, "Compartir con"));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public void openUrl(String str) {
            try {
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(str)));
            } catch (Exception unused) {
            }
        }

        @JavascriptInterface
        public boolean torch(boolean z) {
            try {
                CameraManager cameraManager = (CameraManager) MainActivity.this.getSystemService("camera");
                for (String str : cameraManager.getCameraIdList()) {
                    Boolean bool = (Boolean) cameraManager.getCameraCharacteristics(str).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    if (bool != null && bool.booleanValue()) {
                        cameraManager.setTorchMode(str, z);
                        return true;
                    }
                }
            } catch (Exception unused) {
            }
            return false;
        }

        @JavascriptInterface
        public boolean dial(String str) {
            String str2 = "";
            if (str != null) {
                try {
                    str2 = str.replaceAll("[^0-9+*#]", "");
                } catch (Exception unused) {
                    return false;
                }
            }
            if (str2.isEmpty()) {
                return false;
            }
            MainActivity.this.startActivity(new Intent("android.intent.action.DIAL", Uri.parse("tel:" + str2)));
            return true;
        }

        @JavascriptInterface
        public boolean sms(String str, String str2) {
            try {
                Intent intent = new Intent("android.intent.action.SENDTO", Uri.parse("smsto:" + str));
                if (str2 != null && !str2.isEmpty()) {
                    intent.putExtra("sms_body", str2);
                }
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean waChat(String str, String str2) {
            try {
                StringBuilder sb = new StringBuilder("https://wa.me/");
                sb.append(str != null ? str.replaceAll("\\D", "") : "");
                String sb2 = sb.toString();
                if (str2 != null && !str2.trim().isEmpty()) {
                    sb2 = sb2 + "?text=" + Uri.encode(str2);
                }
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(sb2)));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean email(String str, String str2, String str3) {
            try {
                StringBuilder sb = new StringBuilder("mailto:");
                if (str == null) {
                    str = "";
                }
                sb.append(str);
                Intent intent = new Intent("android.intent.action.SENDTO", Uri.parse(sb.toString()));
                if (str2 != null && !str2.isEmpty()) {
                    intent.putExtra("android.intent.extra.SUBJECT", str2);
                }
                if (str3 != null && !str3.isEmpty()) {
                    intent.putExtra("android.intent.extra.TEXT", str3);
                }
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean maps(String str) {
            try {
                MainActivity mainActivity = MainActivity.this;
                StringBuilder sb = new StringBuilder("geo:0,0?q=");
                if (str == null) {
                    str = "";
                }
                sb.append(Uri.encode(str));
                mainActivity.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(sb.toString())));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean ytSearch(String str) {
            try {
                try {
                    Intent intent = new Intent("android.intent.action.SEARCH");
                    intent.setPackage("com.google.android.youtube");
                    intent.putExtra("query", str);
                    MainActivity.this.startActivity(intent);
                    return true;
                } catch (Exception unused) {
                    return false;
                }
            } catch (Exception unused2) {
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(str))));
                return true;
            }
        }

        @JavascriptInterface
        public boolean webSearch(String str) {
            try {
                try {
                    Intent intent = new Intent("android.intent.action.WEB_SEARCH");
                    intent.putExtra("query", str);
                    MainActivity.this.startActivity(intent);
                    return true;
                } catch (Exception unused) {
                    return false;
                }
            } catch (Exception unused2) {
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse("https://www.google.com/search?q=" + Uri.encode(str))));
                return true;
            }
        }

        @JavascriptInterface
        public boolean camera() {
            try {
                MainActivity.this.startActivity(new Intent("android.media.action.IMAGE_CAPTURE"));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setAlarmDevice(int i, int i2) {
            try {
                Intent intent = new Intent("android.intent.action.SET_ALARM");
                intent.putExtra("android.intent.extra.alarm.HOUR", i);
                intent.putExtra("android.intent.extra.alarm.MINUTES", i2);
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setTimerDevice(int i, String str) {
            try {
                Intent intent = new Intent("android.intent.action.SET_TIMER");
                intent.putExtra("android.intent.extra.alarm.LENGTH", i);
                if (str != null && !str.isEmpty()) {
                    intent.putExtra("android.intent.extra.alarm.MESSAGE", str);
                }
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openApp(String str) {
            Intent launchIntentForPackage;
            try {
                String str2 = (String) MainActivity.APP_MAP.get(MainActivity.javaNorm(str));
                if (str2 != null && (launchIntentForPackage = MainActivity.this.getPackageManager().getLaunchIntentForPackage(str2)) != null) {
                    MainActivity.this.startActivity(launchIntentForPackage);
                    return true;
                }
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse("market://search?q=" + Uri.encode(str))));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        /* v2.11.0 · asistente de voz: lo que kiuDiag() no mira. ¿La batería de Kiu está sin
           restricciones? (si no, Android mata la escucha en segundo plano) y el volumen de medios. */
        @JavascriptInterface
        public String kiuAsist() {
            boolean bateriaLibre = true;
            int vol = -1;
            try {
                android.os.PowerManager pm = (android.os.PowerManager) MainActivity.this.getSystemService("power");
                if (pm != null) {
                    bateriaLibre = pm.isIgnoringBatteryOptimizations(MainActivity.this.getPackageName());
                }
            } catch (Throwable ignore) {
            }
            try {
                android.media.AudioManager am = (android.media.AudioManager) MainActivity.this.getSystemService("audio");
                if (am != null) {
                    int max = am.getStreamMaxVolume(3);
                    if (max > 0) {
                        vol = (am.getStreamVolume(3) * 100) / max;
                    }
                }
            } catch (Throwable ignore2) {
            }
            return "{\"bateriaLibre\":" + bateriaLibre + ",\"vol\":" + vol + "}";
        }

        @JavascriptInterface
        public boolean openSettings(String str) {
            try {
                String str2 = "android.settings.SETTINGS";
                if ("wifi".equals(str)) {
                    str2 = "android.settings.WIFI_SETTINGS";
                } else if ("bluetooth".equals(str)) {
                    str2 = "android.settings.BLUETOOTH_SETTINGS";
                } else if ("sonido".equals(str) || "volumen".equals(str)) {
                    /* v2.10.1: el cerebro pide «volumen» y «brillo» (así se llaman sus
                       claves), pero aquí solo se conocían «sonido» y «pantalla»: caían
                       en los ajustes generales sin avisar. */
                    str2 = "android.settings.SOUND_SETTINGS";
                } else if ("pantalla".equals(str) || "brillo".equals(str)) {
                    str2 = "android.settings.DISPLAY_SETTINGS";
                } else if ("tts".equals(str)) {
                    str2 = "com.android.settings.TTS_SETTINGS";
                } else if ("voiceinput".equals(str)) {
                    str2 = "android.settings.VOICE_INPUT_SETTINGS";
                } else if ("bateria".equals(str)) {
                    str2 = "android.settings.BATTERY_SAVER_SETTINGS";
                } else if ("bateriaapp".equals(str)) {
                    /* v2.11.0: lista de apps sin restricción de batería (sin permiso especial) */
                    str2 = "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS";
                } else if ("apps".equals(str)) {
                    str2 = "android.settings.MANAGE_APPLICATIONS_SETTINGS";
                }
                MainActivity.this.startActivity(new Intent(str2));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        /* Reescrito para el build Gradle (el original no descompiló de forma fiable). */
        @JavascriptInterface
        public String contacts(String query) {
            android.database.Cursor cur = null;
            try {
                if (MainActivity.this.checkSelfPermission("android.permission.READ_CONTACTS") != 0) {
                    return "NEED_PERM";
                }
                String like = "%" + (query == null ? "" : query) + "%";
                cur = MainActivity.this.getContentResolver().query(
                        android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{"display_name", "data1"},
                        "display_name LIKE ? OR data1 LIKE ?",
                        new String[]{like, like},
                        "starred DESC, times_contacted DESC, display_name ASC");
                JSONArray arr = new JSONArray();
                Set<String> seen = new HashSet<>();
                while (cur != null && cur.moveToNext() && arr.length() < 12) {
                    String name = cur.getString(0);
                    String num = cur.getString(1);
                    if (num == null) {
                        continue;
                    }
                    num = num.trim();
                    if (num.isEmpty()) {
                        continue;
                    }
                    String key = (name == null ? "" : name) + "|" + num;
                    if (seen.contains(key)) {
                        continue;
                    }
                    seen.add(key);
                    JSONObject o = new JSONObject();
                    o.put("name", name == null ? "" : name);
                    o.put("num", num);
                    arr.put(o);
                }
                return arr.toString();
            } catch (Exception unused) {
                return "[]";
            } finally {
                if (cur != null) {
                    try {
                        cur.close();
                    } catch (Exception unused2) {
                    }
                }
            }
        }

        /* v2.17.0 · NOTIFICACIONES. No hay permiso de ejecución: el usuario activa "Acceso a
           notificaciones" en una pantalla del sistema. notifAccess() dice si ya lo hizo. */
        @JavascriptInterface
        public boolean notifAccess() {
            try {
                String s = android.provider.Settings.Secure.getString(
                        MainActivity.this.getContentResolver(), "enabled_notification_listeners");
                return s != null && s.contains(MainActivity.this.getPackageName());
            } catch (Exception unused) {
                return false;
            }
        }

        /* Mismo contrato que contacts()/calendarList(): JSON en texto, o "NEED_PERM". */
        @JavascriptInterface
        public String notifList(String query, int max) {
            try {
                if (!notifAccess()) {
                    return "NEED_PERM";
                }
                java.util.List<KiuNotifStore.Entry> l = KiuNotifService
                        .store(MainActivity.this.getPackageName()).recent(query, max);
                JSONArray arr = new JSONArray();
                for (KiuNotifStore.Entry e : l) {
                    JSONObject o = new JSONObject();
                    o.put("a", e.app);
                    o.put("t", e.title);
                    o.put("x", e.text);
                    o.put("w", e.at);
                    arr.put(o);
                }
                return arr.toString();
            } catch (Exception unused) {
                return "[]";
            }
        }

        /* v2.17.0 · SMS recibidos, solo lectura. Tope de 10, textos de 280 caracteres. */
        @JavascriptInterface
        public String smsList(String query, int max) {
            android.database.Cursor cur = null;
            try {
                if (MainActivity.this.checkSelfPermission("android.permission.READ_SMS") != 0) {
                    return "NEED_PERM";
                }
                int cap = max <= 0 ? 5 : Math.min(max, 10);
                String q = query == null ? "" : query.trim();
                String sel = null;
                String[] args = null;
                if (!q.isEmpty()) {
                    sel = "body LIKE ? OR address LIKE ?";
                    args = new String[]{"%" + q + "%", "%" + q + "%"};
                }
                cur = MainActivity.this.getContentResolver().query(
                        Uri.parse("content://sms/inbox"),
                        new String[]{"address", "body", "date"}, sel, args, "date DESC");
                JSONArray arr = new JSONArray();
                while (cur != null && cur.moveToNext() && arr.length() < cap) {
                    String body = cur.isNull(1) ? "" : cur.getString(1);
                    if (body.length() > 280) {
                        body = body.substring(0, 280);
                    }
                    JSONObject o = new JSONObject();
                    o.put("f", cur.isNull(0) ? "" : cur.getString(0));
                    o.put("x", body);
                    o.put("w", cur.isNull(2) ? 0L : cur.getLong(2));
                    arr.put(o);
                }
                return arr.toString();
            } catch (Exception unused) {
                return "[]";
            } finally {
                if (cur != null) {
                    try {
                        cur.close();
                    } catch (Exception unused2) {
                    }
                }
            }
        }

        /* v2.17.0 · ÚLTIMA ubicación conocida (aproximada), sin encender el GPS. "NEED_PERM"
           si falta el permiso, "NONE" si el teléfono no tiene ninguna guardada. */
        @JavascriptInterface
        public String locationGet() {
            try {
                if (MainActivity.this.checkSelfPermission("android.permission.ACCESS_COARSE_LOCATION") != 0) {
                    return "NEED_PERM";
                }
                android.location.LocationManager lm = (android.location.LocationManager)
                        MainActivity.this.getSystemService(Context.LOCATION_SERVICE);
                if (lm == null) {
                    return "NONE";
                }
                android.location.Location best = null;
                for (String p : lm.getProviders(true)) {
                    android.location.Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) {
                        best = l;
                    }
                }
                if (best == null) {
                    return "NONE";
                }
                JSONObject o = new JSONObject();
                o.put("lat", best.getLatitude());
                o.put("lon", best.getLongitude());
                o.put("acc", (double) best.getAccuracy());
                o.put("t", best.getTime());
                return o.toString();
            } catch (Exception unused) {
                return "NONE";
            }
        }

        /* v2.17.0 · control del reproductor con teclas multimedia: lo que Android manda a
           Spotify, YouTube Music, etc. No necesita permisos. action: play|pause|next|previous. */
        @JavascriptInterface
        public boolean mediaKey(String action) {
            try {
                int code;
                if ("play".equals(action) || "pause".equals(action) || "toggle".equals(action)) {
                    code = android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
                } else if ("next".equals(action)) {
                    code = android.view.KeyEvent.KEYCODE_MEDIA_NEXT;
                } else if ("previous".equals(action)) {
                    code = android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS;
                } else {
                    return false;
                }
                android.media.AudioManager am = (android.media.AudioManager)
                        MainActivity.this.getSystemService(Context.AUDIO_SERVICE);
                if (am == null) {
                    return false;
                }
                am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code));
                am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public void requestPerm(final String str) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.10
                @Override // java.lang.Runnable
                public void run() {
                    if ("contacts".equals(str)) {
                        MainActivity.this.requestPermissions(new String[]{"android.permission.READ_CONTACTS"}, MainActivity.REQ_CONTACTS);
                    } else if ("calendar".equals(str)) {
                        MainActivity.this.requestPermissions(new String[]{"android.permission.READ_CALENDAR"}, MainActivity.REQ_CALENDAR);
                    } else if ("sms".equals(str)) {
                        MainActivity.this.requestPermissions(new String[]{"android.permission.READ_SMS"}, MainActivity.REQ_SMS);
                    } else if ("location".equals(str)) {
                        MainActivity.this.requestPermissions(new String[]{"android.permission.ACCESS_COARSE_LOCATION"}, MainActivity.REQ_LOCATION);
                    } else if ("notif".equals(str)) {
                        /* no es un permiso de ejecución: abre la pantalla "Acceso a notificaciones" */
                        MainActivity.this.startActivity(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"));
                    }
                }
            });
        }

        @JavascriptInterface
        public void startWake() {
            MainActivity.this.pendingWake = true;
            if (MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") == 0) {
                MainActivity.this.startWakeNow();
            } else {
                MainActivity.this.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, MainActivity.REQ_MIC);
            }
        }

        @JavascriptInterface
        public void stopWake() {
            MainActivity.this.pendingWake = false;
            try {
                WakeWordEngine.get().stop();
            } catch (Exception unused9) {
            }
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.11
                @Override // java.lang.Runnable
                public void run() {
                    try {
                        MainActivity.this.stopService(new Intent(MainActivity.this, (Class<?>) KiuService.class));
                    } catch (Exception unused) {
                    }
                    MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", false).apply();
                    MainActivity.this.js("nexoWakeState(false)");
                }
            });
        }

        @JavascriptInterface
        public boolean wakeState() {
            /* v2.8.1: solo miraba KiuService.ACTIVE, así que con el motor local
               (Vosk) vivo la UI creía que la palabra de activación estaba apagada y
               la volvía a prender en cada arranque. Ahora pregunta a los dos. */
            try {
                if (WakeWordEngine.get().isRunning()) {
                    return true;
                }
            } catch (Throwable ignored) {
            }
            return KiuService.ACTIVE;
        }

        /* ---- wake word 100% local (Vosk) ---- */

        /* v2.9.2: gramatica de muestreo para la proxima generacion. La aplica
           SOLO la siguiente: ni el chat normal, ni un resumen, ni un nombre de
           conversacion quedan atados a la decision de una herramienta. */
        @JavascriptInterface
        public void kiuGenSetGrammar(String str) {
            try {
                KiuNative.setGrammar(str == null ? "" : str);
            } catch (Throwable th) {
            }
        }

        @JavascriptInterface
        public String kiuGenGrammarPending() {
            try {
                return KiuNative.grammarPending();
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean kiuGenGrammarOk() {
            try {
                return KiuNative.grammarOk();
            } catch (Throwable th) {
                return false;
            }
        }

        /* v2.9.3 · DIAGNÓSTICO DE VOZ.
           Existence justificada: el reporte fue «el audio no funciona, no me
           reconoce la voz y no activa por reconocimiento de voz», y con la
           evidencia que había no se distinguían cuatro causas que se ven
           IGUAL desde afuera:
             1 · el APK instalado es viejo (la UI mostraba una versión escrita a
                 mano en el JS, que puede mentir respecto del paquete real)
             2 · no hay servicio de reconocimiento instalado
             3 · no hay modelo local de la palabra de activación (no va en el
                 repo: son 40 MB) → el camino local está muerto sin avisar
             4 · falta el permiso de micrófono
           Un diagnóstico que devuelve el estado REAL de las cuatro es la única
           forma de no seguir adivinando. Todo lo que devuelve sale de
           PackageManager / SpeechRecognizer / TTS / WakeWordEngine: nada se
           deduce ni se supone. */
        @JavascriptInterface
        public String kiuDiag() {
            StringBuilder b = new StringBuilder(512);
            b.append('{');
            /* --- 1 · la versión REAL del paquete instalado, no la del JS --- */
            String vn = "?";
            long vc = 0;
            try {
                PackageManager pm = MainActivity.this.getPackageManager();
                vn = pm.getPackageInfo(MainActivity.this.getPackageName(), 0).versionName;
                vc = pm.getPackageInfo(MainActivity.this.getPackageName(), 0).versionCode;
            } catch (Throwable th) {
                vn = "?";
            }
            b.append("\"version\":").append(q(vn)).append(",");
            b.append("\"versionCode\":").append(vc).append(",");
            /* --- 2 · micrófono --- */
            b.append("\"mic\":")
             .append(MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") == 0)
             .append(",");
            /* --- 3 · reconocimiento de voz: disponible + qué servicios hay --- */
            boolean rec = false;
            try {
                rec = SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
            } catch (Throwable th) {
                rec = false;
            }
            b.append("\"recogn\":").append(rec).append(",");
            StringBuilder svc = new StringBuilder();
            int nSvc = 0;
            try {
                PackageManager pm = MainActivity.this.getPackageManager();
                java.util.List<ResolveInfo> ri = pm.queryIntentServices(
                        new Intent("android.speech.RecognitionService"), 0);
                for (ResolveInfo r : ri) {
                    if (nSvc > 0) svc.append(',');
                    /* ResolveInfo ES el tipo del elemento: su serviceInfo va
                       directo, no anidado bajo resolveInfo. El doble anidamiento no
                       compila ("cannot find symbol: resolveInfo").
                       Y serviceInfo puede ser null aunque r no lo sea, así que el
                       chequeo va sobre él: un null acá tiraba NPE en un equipo con
                       un servicio de voz raro. */
                    svc.append(q(r == null || r.serviceInfo == null
                            ? "?" : r.serviceInfo.packageName));
                    nSvc++;
                }
            } catch (Throwable th) {
            }
            b.append("\"recogSvcs\":[").append(svc).append("],");
            /* --- 4 · TTS --- */
            b.append("\"ttsReady\":").append(MainActivity.this.tts != null && MainActivity.this.ttsReady).append(",");
            /* el MOTIVO, no solo el hecho: "no arrancó" sin decir por qué no
               deja al usuario igual que antes, con la misma pregunta. */
            b.append("\"ttsErr\":").append(q(MainActivity.this.ttsErr)).append(",");
            String engine = "?";
            String lang = "?";
            try {
                if (MainActivity.this.tts != null) {
                    if (MainActivity.this.tts.getDefaultEngine() != null) {
                        engine = MainActivity.this.tts.getDefaultEngine();
                    }
                    Locale l = MainActivity.this.tts.getLanguage();
                    if (l != null) {
                        lang = l.toString();
                    }
                }
            } catch (Throwable th) {
            }
            b.append("\"ttsEngine\":").append(q(engine)).append(",");
            b.append("\"ttsLang\":").append(q(lang)).append(",");
            /* --- 5 · palabra de activación local: ¿está el modelo? --- */
            boolean mdl = false;
            String msize = "-";
            try {
                /* v2.11.1: BUG REAL. Se miraba solo <dir>/final.mdl, pero el modelo oficial deja
                   <dir>/am/final.mdl: la app lo instalaba bien y el diagnóstico decía «SIN MODELO». */
                java.io.File base = new java.io.File(WakeWordEngine.modelDir(MainActivity.this));
                java.io.File f = new java.io.File(base, "am/final.mdl");
                if (!f.exists()) {
                    f = new java.io.File(base, "final.mdl");
                }
                mdl = WakeWordEngine.modelPresent(MainActivity.this);
                if (mdl) {
                    msize = String.format(java.util.Locale.US, "%.0f MB", f.length() / 1048576.0);
                }
            } catch (Throwable th) {
            }
            try {
                String rd = android.provider.Settings.Secure.getString(MainActivity.this.getContentResolver(), "voice_recognition_service");
                b.append("\"recogDefault\":").append(q(rd == null ? "" : rd)).append(",");
                android.content.ComponentName pick = MainActivity.this.pickRecognizer();
                b.append("\"recogUsed\":").append(q(pick == null ? "(el del sistema)" : pick.getPackageName())).append(",");
            } catch (Throwable th) {
            }
            b.append("\"voskModel\":").append(mdl).append(",");
            b.append("\"voskSize\":").append(q(msize)).append(",");
            try {
                b.append("\"voskState\":").append(q(WakeWordEngine.get().statusJson(MainActivity.this))).append(",");
            } catch (Throwable th) {
                b.append("\"voskState\":\"{}\",");
            }
            /* --- 6 · servicio de la palabra de activación --- */
            b.append("\"wwActive\":").append(KiuService.ACTIVE).append(",");
            b.append("\"wwSuspended\":").append(KiuService.SUSPENDED).append(",");
            b.append("\"audioEffects\":").append(KiuAudioEffects.diagnosticJson()).append(",");
            b.append("\"speaking\":").append(MainActivity.SPEAKING);
            b.append('}');
            return b.toString();
        }

        /* v2.9.7 · instalar el modelo de la palabra de activación desde la app.
           Son 39 MB y no van en el repo, así que hasta ahora la única forma de
           tenerlos era adb push: sin modelo, la palabra de activación local está
           muerta y nada lo decía.

           El flujo son tres llamadas y no una porque son tres estados distintos que
           fallan distinto: wwInstall arranca la descarga (que reusa KiuDownload, con
           SHA y reanudación), wwUnzip la descomprime, y wwUnzipStatus reporta. La
           comprobación de que el modelo quedó donde el motor lo busca la hace
           KiuVoskInstall, no el JS: si esa comprobación fuera del lado del puente,
           un cliente nuevo podría saltársela. */
        @JavascriptInterface
        public String wwInstall() {
            try {
                return KiuVoskInstall.start(MainActivity.this);
            } catch (Throwable th) {
                return "{\"st\":\"error\",\"err\":\"no pude iniciar la descarga\"}";
            }
        }

        @JavascriptInterface
        public String wwUnzip(String path) {
            try {
                return KiuVoskInstall.unzip(MainActivity.this, path);
            } catch (Throwable th) {
                return "{\"st\":\"error\",\"err\":\"no pude descomprimir\"}";
            }
        }

        @JavascriptInterface
        public void wwPick() {
            try {
                KiuVoskInstall.pick(MainActivity.this);
            } catch (Throwable unused) {
            }
        }

        @JavascriptInterface
        public String wwUnzipStatus(String id) {
            try {
                return KiuVoskInstall.status(id);
            } catch (Throwable th) {
                return "{\"st\":\"error\"}";
            }
        }

        @JavascriptInterface
        public String kiuWWState() {
            try {
                return WakeWordEngine.get().statusJson(MainActivity.this);
            } catch (Throwable th) {
                return "{\"st\":\"idle\",\"present\":false}";
            }
        }

        @JavascriptInterface
        public boolean kiuWWStart() {
            try {
                MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wwLocal", true).apply();
                return WakeWordEngine.get().start(MainActivity.this);
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public void kiuWWStop() {
            try {
                MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wwLocal", false).apply();
                WakeWordEngine.get().stop();
            } catch (Throwable unused) {
            }
        }

        @JavascriptInterface
        public void startTimerNative(int i, final String str) {
            long max = Math.max(1, i) * 1000;
            final String msg = (str == null || str.trim().isEmpty()) ? "Se terminó el tiempo" : str;
            MainActivity.this.tRun = new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.12
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.timerFire(msg);
                }
            };
            MainActivity.this.tHandler.postDelayed(MainActivity.this.tRun, max);
        }

        @JavascriptInterface
        public void cancelTimerNative() {
            if (MainActivity.this.tRun != null) {
                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.tRun);
                MainActivity.this.tRun = null;
            }
        }

        @JavascriptInterface
        public void setReminder(final String str, final String str2, final long j) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.13
                @Override // java.lang.Runnable
                public void run() {
                    Alarms.schedule(MainActivity.this, str, str2, j);
                }
            });
        }

        @JavascriptInterface
        public void cancelReminder(final String str) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.14
                @Override // java.lang.Runnable
                public void run() {
                    Alarms.cancel(MainActivity.this, str);
                }
            });
        }

        @JavascriptInterface
        public String pendingReminders() {
            return Alarms.all(MainActivity.this).toString();
        }

        @JavascriptInterface
        public boolean canExactAlarms() {
            return Alarms.canExact(MainActivity.this);
        }

        /* v2.8.0: cuántas alarmas rearmó BootReceiver tras reiniciar/actualizar, y
           las consume (take-once). La UI lo usa para el estado 'Reprogramado al
           reiniciar': al leerlo, el contador vuelve a 0 y no se repite el aviso. */
        @JavascriptInterface
        public int kiuTakeRescheduled() {
            try {
                SharedPreferences sp = MainActivity.this.getSharedPreferences("kiu_native", 0);
                int n = sp.getInt("resched", 0);
                if (n > 0) sp.edit().putInt("resched", 0).apply();
                return n;
            } catch (Exception unused) {
                return 0;
            }
        }

        @JavascriptInterface
        public void openExactAlarmSettings() {
            try {
                if (Build.VERSION.SDK_INT >= 31) {
                    MainActivity.this.startActivity(new Intent("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", Uri.parse("package:" + MainActivity.this.getPackageName())));
                }
            } catch (Exception unused) {
            }
        }

        /* v2.9.0 — LEER la agenda. Kiu ya escribía eventos (addCalendarEvent abre el
           calendario del sistema), pero no leía: no había forma de responder "¿qué
           tengo mañana?" ni de enriquecer el resumen matutino con la agenda.

           Mismo molde que contacts(): devuelve JSON en texto, o "NEED_PERM" si falta
           el permiso para que la UI lo pida y avise. Solo lectura.

           - Ventana temporal: [desde, hasta) en epoch ms. El filtro por texto es
             opcional y busca en título y lugar.
           - Se excluyen los eventos CANCELLED y los todo el día sin hora (BEGIN_TIME
             null) porque no ordenan bien contra un rango con horas.
           - Tope de 40 y de 60 días hacia atrás: una agenda con 5000 eventos Old es
             un problema de memoria y de usefulness, no de información. */
        @JavascriptInterface
        public String calendarList(String query, long fromMs, long toMs) {
            android.database.Cursor cur = null;
            try {
                if (MainActivity.this.checkSelfPermission("android.permission.READ_CALENDAR") != 0) {
                    return "NEED_PERM";
                }
                long from = fromMs > 0 ? fromMs : System.currentTimeMillis();
                long to = toMs > from ? toMs : from + 14L * 86400000L;
                if (to - from > 60L * 86400000L) {
                    to = from + 60L * 86400000L;
                }
                String q = query == null ? "" : query.trim();
                String proj = "title,begin,end,event_location";
                String sel;
                String[] args;
                if (q.isEmpty()) {
                    /* sin texto: los que empiezan dentro de la ventana. BEGIN_TIME >=
                       es el filtro que devuelve lo que viene, que es lo que se pregunta. */
                    sel = "begin >= ? AND begin < ? AND deleted = 0";
                    args = new String[]{String.valueOf(from), String.valueOf(to)};
                } else {
                    String like = "%" + q + "%";
                    sel = "begin < ? AND end > ? AND deleted = 0 AND ("
                            + "title LIKE ? OR event_location LIKE ?)";
                    args = new String[]{String.valueOf(to), String.valueOf(from), like, like};
                }
                cur = MainActivity.this.getContentResolver().query(
                        android.provider.CalendarContract.Instances.CONTENT_URI,
                        new String[]{proj}, sel, args, "begin ASC");
                JSONArray arr = new JSONArray();
                while (cur != null && cur.moveToNext() && arr.length() < 40) {
                    long b = cur.isNull(1) ? 0L : cur.getLong(1);
                    long e = cur.isNull(2) ? 0L : cur.getLong(2);
                    if (b <= 0) {
                        continue;   /* evento sin hora: no se puede ubicar en el día */
                    }
                    JSONObject o = new JSONObject();
                    o.put("t", cur.isNull(0) ? "" : cur.getString(0));
                    o.put("b", b);
                    o.put("e", e > b ? e : b);
                    o.put("w", cur.isNull(3) ? "" : cur.getString(3));
                    arr.put(o);
                }
                return arr.toString();
            } catch (Exception unused) {
                return "[]";
            } finally {
                if (cur != null) {
                    try {
                        cur.close();
                    } catch (Exception unused2) {
                    }
                }
            }
        }

        @JavascriptInterface
        public boolean addCalendarEvent(String str, long j) {
            try {
                Intent intent = new Intent("android.intent.action.INSERT");
                intent.setData(CalendarContract.Events.CONTENT_URI);
                intent.putExtra("beginTime", j);
                intent.putExtra("endTime", j + 3600000);
                intent.putExtra("title", str);
                intent.putExtra("description", "Creado con Kiu");
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        /* ============ v2.3.0 · sección 2 (seguridad) ============ */

        /* ---- ferry único: localStorage del origen viejo (file://) → origen seguro ---- */
        @JavascriptInterface
        public void kiuFerryPut(final String str) {
            try {
                MainActivity.this.getSharedPreferences("kiu_ferry", 0).edit()
                        .putString("json", str == null ? "" : str)
                        .putBoolean("done", true).apply();
                MainActivity.this.runOnUiThread(new Runnable() {
                    @Override // java.lang.Runnable
                    public void run() {
                        try { MainActivity.this.web.loadUrl(ASSET_BASE + "www/index.html"); } catch (Throwable ignored) { }
                    }
                });
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String kiuFerryGet() {
            try {
                return MainActivity.this.getSharedPreferences("kiu_ferry", 0).getString("json", "");
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public void kiuFerryClear() {
            try {
                MainActivity.this.getSharedPreferences("kiu_ferry", 0).edit().remove("json").apply();
            } catch (Throwable ignored) { }
        }

        /* ---- bóveda de claves API: cifradas con Keystore (KiuCrypto); la clave en
           claro jamás se guarda ni se entrega a la WebView (solo últimos 4) ---- */
        @JavascriptInterface
        public boolean kiuKeysSet(String str, String str2) {
            try {
                if (str == null || str.trim().isEmpty()) return false;
                SharedPreferences sp = MainActivity.this.getSharedPreferences("kiu_keys", 0);
                if (str2 == null || str2.isEmpty()) { sp.edit().remove("k_" + str).apply(); return true; }
                /* v2.11.10: si no se pudo cifrar NO se guarda un valor vacío; se avisa al JS (false) */
                String enc = KiuCrypto.enc(str2);
                if (enc == null || enc.isEmpty()) return false;
                sp.edit().putString("k_" + str, enc).commit();
                return true;
            } catch (Throwable ignored) { return false; }
        }

        @JavascriptInterface
        public String kiuKeysGet(String str) {
            try {
                String e = MainActivity.this.getSharedPreferences("kiu_keys", 0).getString("k_" + str, null);
                return e == null ? "" : KiuCrypto.dec(e);
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean kiuKeysHas(String str) {
            try {
                /* v2.11.10: «hay clave» solo si se puede LEER (antes bastaba que existiera la entrada,
                   aunque estuviera vacía o ilegible, y se mandaba «Bearer » sin clave) */
                String e = MainActivity.this.getSharedPreferences("kiu_keys", 0).getString("k_" + str, null);
                return KiuCrypto.readable(e);
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public void kiuKeysDel(String str) {
            try {
                MainActivity.this.getSharedPreferences("kiu_keys", 0).edit().remove("k_" + str).apply();
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String kiuKeysList() {
            try {
                Map<String, ?> all = MainActivity.this.getSharedPreferences("kiu_keys", 0).getAll();
                JSONObject o = new JSONObject();
                for (String k : all.keySet()) {
                    if (!k.startsWith("k_")) continue;
                    String name = k.substring(2);
                    String plain = KiuCrypto.dec(String.valueOf(all.get(k)));
                    o.put(name, plain.length() > 4 ? plain.substring(plain.length() - 4) : "****");
                }
                return o.toString();
            } catch (Throwable th) {
                return "{}";
            }
        }

        /* ---- proxy HTTP(S) hecho en Java: la WebView no abre el socket ni ve la clave;
           los placeholders {{key:nombre}} se reemplazan acá adentro ---- */
        @JavascriptInterface
        public boolean kiuApiStart(String str, String str2, String str3, String str4, String str5) {
            return KiuApiProxy.start(MainActivity.this, str, str2, str3, str4, str5);
        }

        @JavascriptInterface
        public String kiuApiPoll(String str) {
            return KiuApiProxy.poll(str);
        }

        @JavascriptInterface
        public void kiuApiStop(String str) {
            KiuApiProxy.stop(str);
        }
    }

    /* v2.11.1: el reconocedor «por defecto» del teléfono puede ser uno que no sirve para dictar
       (la lista de servicios incluía el de otras apps). Se prefiere el de Google; si no hay,
       se usa el del sistema. */
    ComponentName pickRecognizer() {
        try {
            java.util.List<android.content.pm.ResolveInfo> l = getPackageManager().queryIntentServices(new Intent("android.speech.RecognitionService"), 0);
            String[] pref = {"com.google.android.googlequicksearchbox", "com.google.android.tts"};
            for (String p : pref) {
                for (android.content.pm.ResolveInfo ri : l) {
                    if (ri.serviceInfo != null && p.equals(ri.serviceInfo.packageName)) {
                        return new ComponentName(ri.serviceInfo.packageName, ri.serviceInfo.name);
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /* v2.11.1: errores que se arreglan solos probando otra cosa: idioma no soportado (12/13) y
       servicio que no atiende (5/11). Acotado: cada salida se usa una sola vez. */
    /* v2.11.6 · en modo manos libres (después del saludo, con «Kiu» o en conversación) los errores del
       reconocedor se descartaban sin decir nada: Kiu «no escuchaba» y nadie sabía por qué. Ahora se
       muestra el código, salvo 6/7 (nadie habló / no se entendió), que son normales. Máx. 1 aviso cada 8 s. */
    private long lastErrToastMs = 0L;

    private void surfaceVoiceError(int code) {
        if (code == 6 || code == 7 || pendingListen) {
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (now - lastErrToastMs < 8000L) {
            return;
        }
        lastErrToastMs = now;
        js("nexoVoiceError('err_" + code + "')");
    }

    /* v2.11.12 · SIN GOOGLE: cuando el reconocedor de Google no puede (sin Internet, español sin bajar,
       servicio caído) se escucha con el modelo Vosk del teléfono. Si anduvo, las próximas 10 min se usa
       directo, sin volver a esperar los errores de Google en cada frase. */
    private boolean offlineTried = false;
    private long offlinePreferUntil = 0L;

    private boolean offlineFallback(int code) {
        boolean netOrLang = code == 1 || code == 2 || code == 5 || code == 11 || code == 12 || code == 13;
        if (offlineTried || !netOrLang || OfflineDictation.busy() || !OfflineDictation.available(this)) {
            return false;
        }
        offlineTried = true;
        LAST_OFFLINE = "Google falló (código " + code + "): se usó el dictado sin conexión";
        runOffline();
        return true;
    }

    private void runOffline() {
        COMMAND_BUSY = true;
        try {
            WakeWordEngine.get().pause();
        } catch (Throwable ignored) {
        }
        KiuService.suspend();
        js("nexoListenStart()");
        OfflineDictation.listen(getApplicationContext(), new OfflineDictation.Cb() {
            @Override
            public void onText(final String text) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        offlinePreferUntil = SystemClock.elapsedRealtime() + 600000L;
                        lastConvBeat = SystemClock.elapsedRealtime();
                        pendingListen = false;
                        commandMicFree();
                        js("nexoListenEnd()");
                        js("nexoOnVoice(" + jsStr(text) + ")");
                    }
                });
            }

            @Override
            public void onFail(final String why) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        LAST_OFFLINE = "dictado sin conexión sin resultado: " + why;
                        commandMicFree();
                        KiuService.resumeSoon();
                        js("nexoListenEnd()");
                        if (convArmed && handsFree && resumed && convWindowOpen(lastConvBeat)) {
                            tHandler.removeCallbacks(convOpen);
                            tHandler.postDelayed(convOpen, 800L);
                        } else {
                            convArmed = false;
                            if (pendingListen) {
                                pendingListen = false;
                                js("nexoVoiceError('no_match')");
                            }
                        }
                    }
                });
            }
        });
    }

    private boolean retrySpeech(int code) {
        if (code == 12 || code == 13) {
            if (speechLangIdx < SPEECH_LANGS.length - 1) {
                speechLangIdx++;
                scheduleSpeechRetry();
                return true;
            }
            speechLangIdx = 0;
            /* v2.11.3 · «El servicio de voz no tiene el español instalado» con el teléfono bien.
               Kiu elegía el reconocedor de «Servicios de voz de Google» (com.google.android.tts), que
               tiene sus propios paquetes de idioma y pide el español sin conexión aparte, aunque el
               reconocedor del sistema (el del dictado del teclado) sí lo tuviera. Agotados los 4
               idiomas, se prueba UNA vez con el reconocedor por defecto del sistema y se recuerda. */
            if (!recForceDefault) {
                recForceDefault = true;
                try { getSharedPreferences("kiu_native", 0).edit().putBoolean("rec_default", true).apply(); } catch (Exception ignored) { }
                scheduleSpeechRetry();
                return true;
            }
            recForceDefault = false;
            try { getSharedPreferences("kiu_native", 0).edit().putBoolean("rec_default", false).apply(); } catch (Exception ignored) { }
            return false;
        }
        if ((code == 5 || code == 11) && !recForceDefault) {
            recForceDefault = true;
            scheduleSpeechRetry();
            return true;
        }
        return false;
    }

    private void scheduleSpeechRetry() {
        stopSpeech();
        tHandler.postDelayed(new Runnable() { // from class: com.kiu.agent.MainActivity.retry
            @Override // java.lang.Runnable
            public void run() {
                MainActivity.this.startSpeech();
            }
        }, 300L);
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void startSpeech() {
        KiuService.suspend();
        /* primero soltar el reconocedor anterior (stopSpeech devuelve el micro), y
           recién después tomar el nuevo: al revés, el comando se cancelaba solo. */
        stopSpeech();
        /* v2.8.1: hay un solo micrófono. Si el motor local de wake word (Vosk) lo
           tiene agarrado, se le avisa que ceda el paso; al soltar, vuelve. */
        try {
            WakeWordEngine.get().pause();
        } catch (Throwable ignored) {
        }
        COMMAND_BUSY = true;
        this.convArmed = this.handsFree && this.resumed;
        offlineTried = false;
        if (SystemClock.elapsedRealtime() < offlinePreferUntil && !OfflineDictation.busy() && OfflineDictation.available(this)) {
            offlineTried = true;
            runOffline();
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            if (OfflineDictation.available(this) && !OfflineDictation.busy()) {
                offlineTried = true;
                LAST_OFFLINE = "el teléfono no tiene reconocimiento de Google: se usó el dictado sin conexión";
                runOffline();
                return;
            }
            this.convArmed = false;
            commandMicFree();
            js("nexoVoiceError('unavailable')");
            js("nexoListenEnd()");
            this.pendingListen = false;
            KiuService.resumeSoon();
            return;
        }
        ComponentName recPick = (this.recForceDefault || getSharedPreferences("kiu_native", 0).getBoolean("rec_default", false)) ? null : pickRecognizer();
        LAST_REC = (recPick == null ? "reconocedor del sistema" : recPick.getPackageName()) + " · " + SPEECH_LANGS[Math.min(speechLangIdx, SPEECH_LANGS.length - 1)];
        SpeechRecognizer createSpeechRecognizer = recPick != null
                ? SpeechRecognizer.createSpeechRecognizer(this, recPick)
                : SpeechRecognizer.createSpeechRecognizer(this);
        this.recognizer = createSpeechRecognizer;
        createSpeechRecognizer.setRecognitionListener(new RecognitionListener() { // from class: com.kiu.agent.MainActivity.7
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
                /* v2.11.0: nivel del micrófono para que las barras de la pantalla de llamada
                   sigan tu voz de verdad. Máximo ~11 avisos por segundo. */
                long now = android.os.SystemClock.uptimeMillis();
                if (now - MainActivity.this.lastRmsMs < 90) {
                    return;
                }
                MainActivity.this.lastRmsMs = now;
                MainActivity.this.js("nexoVoiceLevel(" + f + ")");
            }

            @Override // android.speech.RecognitionListener
            public void onReadyForSpeech(Bundle bundle) {
                MainActivity.this.js("nexoListenStart()");
            }

            @Override // android.speech.RecognitionListener
            public void onPartialResults(Bundle bundle) {
                ArrayList<String> stringArrayList = bundle.getStringArrayList("results_recognition");
                if (stringArrayList == null || stringArrayList.isEmpty() || TextUtils.isEmpty(stringArrayList.get(stringArrayList.size() - 1))) {
                    return;
                }
                MainActivity.this.js("nexoVoicePartial(" + MainActivity.this.jsStr(stringArrayList.get(stringArrayList.size() - 1)) + ")");
            }

            @Override // android.speech.RecognitionListener
            public void onError(int i) {
                MainActivity.LAST_ERR = i;
                MainActivity.LAST_ERR_AT = System.currentTimeMillis();
                MainActivity.this.stopSpeech();
                if (MainActivity.this.retrySpeech(i)) {
                    return;
                }
                if (MainActivity.this.offlineFallback(i)) {
                    return;
                }
                MainActivity.this.surfaceVoiceError(i);
                if (!MainActivity.this.convArmed || !MainActivity.this.handsFree || !MainActivity.this.resumed || !MainActivity.convWindowOpen(MainActivity.this.lastConvBeat)) {
                    MainActivity.this.convArmed = false;
                    KiuService.resumeSoon();
                    MainActivity.this.js("nexoListenEnd()");
                    if (MainActivity.this.pendingListen) {
                        MainActivity.this.pendingListen = false;
                        MainActivity.this.js("nexoVoiceError('err_" + i + "')");
                        return;
                    }
                    return;
                }
                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 800L);
                MainActivity.this.js("nexoListenEnd()");
            }

            @Override // android.speech.RecognitionListener
            public void onResults(Bundle bundle) {
                MainActivity.this.stopSpeech();
                MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
                ArrayList<String> stringArrayList = bundle.getStringArrayList("results_recognition");
                String str = (stringArrayList == null || stringArrayList.isEmpty()) ? null : stringArrayList.get(0);
                if (str == null || TextUtils.isEmpty(str.trim())) {
                    if (!MainActivity.this.convArmed || !MainActivity.this.handsFree || !MainActivity.this.resumed || !MainActivity.convWindowOpen(MainActivity.this.lastConvBeat)) {
                        MainActivity.this.convArmed = false;
                        KiuService.resumeSoon();
                        MainActivity.this.js("nexoListenEnd()");
                        if (MainActivity.this.pendingListen) {
                            MainActivity.this.pendingListen = false;
                            MainActivity.this.js("nexoVoiceError('no_match')");
                            return;
                        }
                        return;
                    }
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 800L);
                    MainActivity.this.js("nexoListenEnd()");
                    return;
                }
                MainActivity.this.pendingListen = false;
                MainActivity.this.js("nexoOnVoice(" + MainActivity.this.jsStr(str) + ")");
            }
        });
        Intent intent = new Intent("android.speech.action.RECOGNIZE_SPEECH");
        intent.putExtra("android.speech.extra.LANGUAGE_MODEL", "free_form");
        intent.putExtra("android.speech.extra.LANGUAGE", SPEECH_LANGS[this.speechLangIdx]);
        intent.putExtra("android.speech.extra.LANGUAGE_PREFERENCE", SPEECH_LANGS[this.speechLangIdx]);
        intent.putExtra("android.speech.extra.PARTIAL_RESULTS", true);
        intent.putExtra("android.speech.extra.PREFER_OFFLINE", true); /* v2.11.4: con VPN o sin datos, usa el paquete sin conexión si está */
        intent.putExtra("android.speech.extra.MAX_RESULTS", 2);
        intent.putExtra("calling_package", getPackageName());
        intent.putExtra("android.speech.extra.PROMPT", "Hablale a Kiu...");
        try {
            this.recognizer.startListening(intent);
            armMicWatch(createSpeechRecognizer);
        } catch (Exception unused) {
            this.convArmed = false;
            stopSpeech();
            KiuService.resumeSoon();
            js("nexoListenEnd()");
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void stopSpeech() {
        if (this.micWatch != null) {
            this.tHandler.removeCallbacks(this.micWatch);
            this.micWatch = null;
        }
        SpeechRecognizer speechRecognizer = this.recognizer;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.destroy();
            } catch (Exception unused) {
            }
            this.recognizer = null;
        }
        commandMicFree();
    }

    /* v2.8.1: devuelve el micrófono al motor de wake word local y marca que ya no
       hay nadie escuchando un comando. Idempotente. */
    private void commandMicFree() {
        if (!COMMAND_BUSY) {
            return;
        }
        COMMAND_BUSY = false;
        try {
            WakeWordEngine ww = WakeWordEngine.get();
            if (ww.isRunning()) {
                ww.resume();
            }
        } catch (Throwable ignored) {
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void js(final String str) {
        runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.8
            @Override // java.lang.Runnable
            public void run() {
                if (MainActivity.this.web != null) {
                    MainActivity.this.web.evaluateJavascript(str, null);
                }
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public String jsStr(String str) {
        /* v2.7.1: JSONObject.quote escapa comillas, barras y saltos. El escape manual anterior
           dejaba \\" (cierra el string) y permitia inyectar JS desde el extra "cmd" del Intent
           (MainActivity esta exported) o desde una transcripcion de voz con comillas. */
        String q = jsonQuote(str == null ? "" : str);
        return q.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    @Override // android.app.Activity
    public void onRequestPermissionsResult(int i, String[] strArr, int[] iArr) {
        if (i != REQ_MIC) {
            if (i == REQ_CONTACTS || i == REQ_CALENDAR || i == REQ_SMS || i == REQ_LOCATION) {
                boolean z = iArr.length > 0 && iArr[0] == 0;
                StringBuilder sb = new StringBuilder("nexoPerm('");
                sb.append(i == REQ_CALENDAR ? "calendar" : i == REQ_SMS ? "sms" : i == REQ_LOCATION ? "location" : "contacts").append("',");
                sb.append(z ? "true" : "false");
                sb.append(")");
                js(sb.toString());
                /* v2.9.0: si le dieron el permiso y Kiu estaba pidiendo la agenda,
                   no hay que pedirle que repita la pregunta. */
                if (i == REQ_CALENDAR && z) {
                    js("window.App && App.calendarPermission(true);");
                }
                return;
            }
            if (i == REQ_NOTIF) {
                if ((iArr.length > 0 && iArr[0] == 0) && this.pendingWake) {
                    this.pendingWake = false;
                    startWakeNow();
                    return;
                }
                return;
            }
            return;
        }
        if (iArr.length > 0 && iArr[0] == 0) {
            if (this.pendingListen) {
                this.pendingListen = false;
                runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.9
                    @Override // java.lang.Runnable
                    public void run() {
                        MainActivity.this.startSpeech();
                    }
                });
                return;
            } else {
                if (this.pendingWake) {
                    this.pendingWake = false;
                    startWakeNow();
                    return;
                }
                return;
            }
        }
        if (this.pendingListen) {
            js("nexoVoiceError('no_permission')");
        }
        this.pendingListen = false;
        this.pendingWake = false;
        Toast.makeText(this, "Dale permiso de micrófono para hablar con Kiu", 1).show();
    }

    @Override // android.app.Activity
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleExtras(intent);
    }

    @Override // android.app.Activity
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override // android.app.Activity
    protected void onPause() {
        super.onPause();
        this.resumed = false;
        this.convArmed = false;
        this.tHandler.removeCallbacks(this.convOpen);
        stopSpeech();
        SPEAKING = false;
        TextToSpeech textToSpeech = this.tts;
        if (textToSpeech == null || !textToSpeech.isSpeaking()) {
            return;
        }
        this.tts.stop();
    }

    @Override // android.app.Activity
    protected void onResume() {
        super.onResume();
        this.resumed = true;
    }

    @Override // android.app.Activity
    protected void onDestroy() {
        inst = null;
        try {
            if (alarmFired != null) { unregisterReceiver(alarmFired); alarmFired = null; }
        } catch (Exception ignored) {
        }
        try {
            WakeWordEngine.get().stop();
        } catch (Exception unused) {
        }
        stopSpeech();
        TextToSpeech textToSpeech = this.tts;
        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
                this.tts.shutdown();
            } catch (Exception unused) {
            }
        }
        WebView webView = this.web;
        if (webView != null) {
            webView.destroy();
        }
        // v2.6.1 (auditoría de memoria): al cerrar de verdad la actividad (atrás,
        // finish, deslizar de recientes) liberamos el modelo nativo para no dejar
        // cientos de MB de RAM reservados en un proceso que Android mantiene en
        // caché. En rotación isFinishing() es false: el modelo sigue cargado y no
        // hay que re-cargarlo. Idempotente y sin bloquear el hilo UI (freeAsync).
        if (isFinishing()) {
            KiuGenJob.freeAsync();
        }
        super.onDestroy();
    }
}
