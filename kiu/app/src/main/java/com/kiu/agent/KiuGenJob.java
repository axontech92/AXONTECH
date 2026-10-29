package com.kiu.agent;

/* loaded from: classes.dex */
public class KiuGenJob implements Runnable {
    private static final Object MODEL_LOCK = new Object();
    private static final long IDLE_UNLOAD_MS = 10L * 60L * 1000L;
    private static final long IDLE_NUDGE_LEAD_MS = 2L * 60L * 1000L;
    private static final java.util.concurrent.ScheduledExecutorService IDLE_EXECUTOR =
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "kiu-idle-unload");
                t.setDaemon(true);
                return t;
            });
    private static volatile java.util.concurrent.ScheduledFuture<?> idleUnloadTask;
    private static volatile String lastModelPath;
    private static volatile int lastContext = 2048;
    private static volatile int lastThreads = 4;
    private static volatile boolean unloadedByIdle;

    public static String a1;
    public static int a2;
    public static float a3;
    public static int a4;
    /* v2.11.21: leído/escrito desde el hilo WebView y el worker nativo. Sin volatile,
       la UI podía ver busy=true obsoleto y rechazar todas las preguntas como "motor ocupado". */
    public static volatile boolean busy;
    public static int jt;

    public static String esc(String str) {
        if (str == null) {
            return "";
        }
        try {
            return str.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n").replace("\t", " ");
        } catch (Throwable th) {
            return str;
        }
    }

    /* v2.14.2: el id incremental de generacion que publica el nativo.
       -1 si no se puede leer: el JS entonces no puede discriminar el evento y
       usa el criterio viejo (el primero que llega cierra). */
    private static long currentGenId() {
        try {
            String st = KiuNative.genStatus();
            if (st == null) {
                return -1L;
            }
            int i = st.indexOf("\"id\":");
            if (i < 0) {
                return -1L;
            }
            int j = i + 5;
            int k = j;
            while (k < st.length() && (Character.isDigit(st.charAt(k)) || st.charAt(k) == '-')) {
                k++;
            }
            if (k <= j) {
                return -1L;
            }
            return Long.parseLong(st.substring(j, k));
        } catch (Throwable ignored) {
            return -1L;
        }
    }

    private static void scheduleIdleUnload() {
        java.util.concurrent.ScheduledFuture<?> old = idleUnloadTask;
        if (old != null) old.cancel(false);
        /* El nudge corre dos minutos antes de liberar el modelo. Si la consolidación
           empieza una generación, KiuGenJob vuelve a programar este plazo al terminar. */
        idleUnloadTask = IDLE_EXECUTOR.schedule(() -> {
            synchronized (MODEL_LOCK) {
                if (busy) { scheduleIdleUnload(); return; }
                try {
                    MainActivity activity = MainActivity.inst;
                    if (activity != null) activity.js("if(window.KiuMemoryNudge)window.KiuMemoryNudge.run()");
                } catch (Throwable ignored) { }
                idleUnloadTask = IDLE_EXECUTOR.schedule(() -> {
                    synchronized (MODEL_LOCK) {
                        if (busy) { scheduleIdleUnload(); return; }
                        try {
                            if (KiuNative.isLoaded()) {
                                KiuNative.freeModel();
                                unloadedByIdle = true;
                            }
                        } catch (Throwable ignored) { }
                    }
                }, IDLE_NUDGE_LEAD_MS, java.util.concurrent.TimeUnit.MILLISECONDS);
            }
        }, IDLE_UNLOAD_MS - IDLE_NUDGE_LEAD_MS, java.util.concurrent.TimeUnit.MILLISECONDS);
    }

    /* v2.11.14: libera la RAM del modelo tras 10 minutos sin uso y lo recarga
       automáticamente al pedir otra generación. Las operaciones nativas se
       serializan para no liberar el contexto mientras se está generando. */

    /* v2.6.1 (auditoría de memoria): liberación asíncrona del modelo nativo.
       La llaman onDestroy() de MainActivity (cierre real, no rotación) y el de
       KiuService (cuando ya no queda actividad viva). stopGen() hace que una
       generación en curso aborte rápido; freeModel() toma g_mtx en C++ y espera
       a poder soltar contexto + modelo, por eso corre en su propio hilo y no
       congela el hilo que destruye la actividad/servicio. Es idempotente:
       free_locked() chequea punteros null bajo mutex. */
    public static void freeAsync() {
        new Thread(new Runnable() {
            @Override // java.lang.Runnable
            public void run() {
                try {
                    KiuNative.stopGen();
                } catch (Throwable th) {
                }
                synchronized (MODEL_LOCK) {
                    try {
                        java.util.concurrent.ScheduledFuture<?> task = idleUnloadTask;
                        if (task != null) task.cancel(false);
                        KiuNative.freeModel();
                        unloadedByIdle = false;
                    } catch (Throwable th) {
                    }
                }
            }
        }, "kiu-free").start();
    }

    @Override // java.lang.Runnable
    public void run() {
        busy = true;
        String str = null;
        try {
            int i = jt;
            if (i != 1) {
                if (i == 2) {
                    long currentTimeMillis = System.currentTimeMillis();
                    String generate;
                    synchronized (MODEL_LOCK) {
                        if (!KiuNative.isLoaded() && unloadedByIdle && lastModelPath != null
                                && KiuNative.available()) {
                            if (KiuNative.loadModel(lastModelPath, lastContext, lastThreads)) {
                                unloadedByIdle = false;
                            }
                        }
                        generate = KiuNative.isLoaded()
                                ? KiuNative.generate(a1, a2, a3) : null;
                        if (KiuNative.isLoaded()) scheduleIdleUnload();
                    }
                    long currentTimeMillis2 = System.currentTimeMillis() - currentTimeMillis;
                    /* v2.14.2 · EL EVENTO LLEVA EL ID DE LA GENERACION.
                       El push puede llegar TARDE: si el sondeo del JS ya habia
                       cerrado esa generacion y el agente arranco el paso
                       siguiente, el evento viejo cerraba la generacion nueva
                       (le daba el texto viejo al callback nuevo y le borraba el
                       pending): el motor se quedaba en "Generando" para siempre.
                       Con el id, el JS sabe que ese evento no es de esta
                       generacion y lo ignora. */
                    long genId = currentGenId();
                    if (generate != null) {
                        str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"gen\",\"id\":" + genId + ",\"ok\":true,\"text\":\"" + String.valueOf(esc(generate)) + "\",\"ms\":" + currentTimeMillis2 + ",\"tps\":" + KiuNative.tokensPerSec() + "})";
                    } else {
                        str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"gen\",\"id\":" + genId + ",\"ok\":false,\"err\":\"" + String.valueOf(esc(KiuNative.lastError())) + "\",\"ms\":" + currentTimeMillis2 + "})";
                    }
                } else if (i == 3) {
                    synchronized (MODEL_LOCK) {
                        java.util.concurrent.ScheduledFuture<?> task = idleUnloadTask;
                        if (task != null) task.cancel(false);
                        KiuNative.freeModel();
                        unloadedByIdle = false;
                    }
                    str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"free\",\"ok\":true})";
                }
            } else if (!KiuNative.available()) {
                str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"load\",\"ok\":false,\"err\":\"libreria nativa no disponible\"})";
            } else {
                boolean loaded;
                synchronized (MODEL_LOCK) {
                    loaded = KiuNative.loadModel(a1, a2, a4);
                    if (loaded) {
                        lastModelPath = a1;
                        lastContext = a2;
                        lastThreads = a4;
                        unloadedByIdle = false;
                        scheduleIdleUnload();
                    }
                }
                if (loaded) {
                    str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"load\",\"ok\":true,\"path\":\"" + esc(a1) + "\"})";
                } else {
                    str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"load\",\"ok\":false,\"err\":\"" + String.valueOf(esc(KiuNative.lastError())) + "\"})";
                }
            }
        } catch (Throwable th) {
            try {
                str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"err\",\"err\":\"" + String.valueOf(esc(th.toString())) + "\"})";
            } catch (Throwable th2) {
            }
        }
        busy = false;
        if (str != null) {
            try {
                MainActivity mainActivity = MainActivity.inst;
                if (mainActivity != null) {
                    mainActivity.runOnUiThread(new KiuJsPost(str));
                }
            } catch (Throwable th3) {
            }
        }
    }
}
