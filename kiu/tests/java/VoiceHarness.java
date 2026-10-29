package com.kiu.agent;

/**
 * Arnés de pruebas de la lógica de voz (v2.9.6).
 *
 * <p>Existe porque la brecha era real: 4.910 líneas de Java y CERO tests. Los 227
 * tests de la suite cubren JS, y ninguno podía ver un {@code AudioRecord} roto ni un
 * TTS que no arrancó — que es exactamente donde estaban los tres bugs.
 *
 * <p>No usa JUnit a propósito. {@code app/src/test/} con JUnit exige el Android SDK
 * para correrlo, y entonces los tests no corren en ningún lado donde no haya SDK —
 * o sea, casi ninguno. Con {@code javac} + {@code java} sobre clases puras corren en
 * cualquier máquina con un JDK, incluyendo el CI y este entorno.
 *
 * <p>Salida: una línea {@code FAIL <descripción>} por aserción que no se cumplió y
 * el proceso sale con 1. Node lo corre desde tests/java.test.mjs.
 */
public class VoiceHarness {

    private static int failures = 0;
    private static int checks = 0;

    private static void check(boolean cond, String what) {
        checks++;
        if (!cond) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) {
        MicSessionRecovers();
        StickyErrorClears();
        SpikeDoesNotRecreate();
        ExhaustionGivesUp();
        SilenceIsNotAnError();
        BackoffIsBounded();
        TtsInitHasRetry();
        AudioRecordIsActuallyRecreated();

        System.out.println("checks=" + checks + " fails=" + failures);
        if (failures > 0) {
            System.exit(1);
        }
    }

    /* ---- el bug 1: un AudioRecord roto tiene que RECREARSE, no re-leerse ---- */
    private static void MicSessionRecovers() {
        MicSession s = new MicSession("micrófono");
        s.start(0);
        int acc = 0;
        for (int i = 0; i < 3; i++) {
            acc |= s.onRead(MicSession.ERR_DEAD_OBJECT, 100 * (i + 1));
        }
        check(s.needsRecreate(), "tras 3 lecturas muertas tiene que pedir recrear el AudioRecord");
        check(acc == 1, "y la acción es recrear (1), no seguir leyendo");
        check(s.takeDelayMs() > 0, "y dice cuánto esperar antes del intento siguiente");
        check(s.takeDelayMs() == 0, "espera consumida: el motor no tiene que acordarse de limpiarla");
    }

    /* ---- el bug 2: el error no puede quedar pegajoso ---- */
    private static void StickyErrorClears() {
        MicSession s = new MicSession("micrófono");
        s.start(0);
        s.onRead(MicSession.ERR_DEAD_OBJECT, 10);
        /* una lectura mala suelta NO es un error: el umbral existe justamente
           para que un pico no pinte la app de rojo. Marcarla sería mentir. */
        check(!s.isErr(), "una lectura mala suelta no marca error (es transitoria)");
        for (int i = 1; i < MicSession.THRESHOLD; i++) {
            s.onRead(MicSession.ERR_DEAD_OBJECT, 10 * (i + 1));
        }
        check(s.isErr(), "pero al cruzar el umbral sí: el micro está realmente roto");
        s.onRead(3200, 200);  // una lectura buena
        check(!s.isErr(), "y al primer read bueno el error tiene que desaparecer");
        check(s.err().isEmpty(), "el texto del error queda vacío");
    }

    /* ---- un pico de errores no merece tirar el AudioRecord ---- */
    private static void SpikeDoesNotRecreate() {
        MicSession s = new MicSession("micrófono");
        s.start(0);
        s.onRead(MicSession.ERR_INVALID_OP, 10);
        s.onRead(MicSession.ERR_INVALID_OP, 20);
        check(!s.needsRecreate(), "dos errores seguidos no justifican recrear (umbral = 3)");
        s.onRead(1600, 30);
        check(!s.needsRecreate(), "y si después lee bien, sigue con el mismo AudioRecord");
    }

    /* ---- se tiene que rendir, no reintentar en el vacío para siempre ---- */
    private static void ExhaustionGivesUp() {
        MicSession s = new MicSession("micrófono");
        s.start(0);
        boolean rindio = false;
        for (int i = 0; i < MicSession.THRESHOLD * (VoiceRetry.MAX_TRIES + 2); i++) {
            if (s.onRead(MicSession.ERR_DEAD_OBJECT, 100 * (i + 1)) == 2) {
                rindio = true;
                break;
            }
        }
        check(rindio, "después de agotar los intentos tiene que rendir (acción 2)");
        check(s.giveUpMessage().length() > 0, "y decir POR QUÉ se rindió, no quedarse mudo");
    }

    /* ---- un 0 suelto es un chunk vacío, no un error ---- */
    private static void SilenceIsNotAnError() {
        MicSession s = new MicSession("micrófono");
        s.start(0);
        int a = s.onRead(0, 10);
        check(a == 0, "read()==0 no es un error: es un chunk vacío");
        check(!s.isErr(), "y no ensucia el estado de error");
    }

    /* ---- el backoff crece y tiene techo ---- */
    private static void BackoffIsBounded() {
        VoiceRetry r = new VoiceRetry("x");
        long prev = 0;
        boolean grew = true;
        for (int i = 0; i < 4; i++) {
            long d = r.fail();
            if (d < prev) grew = false;
            prev = d;
        }
        check(grew, "el backoff tiene que crecer entre intentos");
        check(prev <= VoiceRetry.MAX_MS, "y estar acotado: " + prev + " > " + VoiceRetry.MAX_MS);
        r.ok();
        check(r.tries() == 0, "un éxito reinicia el contador");
    }

    /* ---- el bug 3: la init de TTS tiene que reintentar ---- */
    private static void TtsInitHasRetry() {
        VoiceRetry r = new VoiceRetry("motor de voz");
        check(r.shouldRetry(), "al arrancar hay que reintentar");
        for (int i = 0; i < VoiceRetry.MAX_TRIES - 1; i++) {
            r.fail("init falló");
        }
        check(r.shouldRetry(), "todavía hay margen para un último intento");
        r.fail("init falló");
        check(!r.shouldRetry(), "agotados los intentos, no seguir insistiendo");
        check(r.giveUpMessage().contains("motor de voz"), "y el mensaje dice qué falló");
    }

    /* ---- el motor tiene que hacer lo que MicSession le pide ----
       Esto verifica la costura entre la lógica y el código Android, leyendo el
       fuente: si WakeWordEngine deja de usar takeRecreate(), este test falla. */
    private static void AudioRecordIsActuallyRecreated() {
        String src = read("app/src/main/java/com/kiu/agent/WakeWordEngine.java");
        if (src.isEmpty()) {
            System.out.println("SKIP WakeWordEngine: fuente no encontrada (se corre desde la raíz del repo)");
            return;
        }
        check(src.contains("takeRecreate()"),
            "WakeWordEngine tiene que consultar takeRecreate() y recrear el AudioRecord");
        check(src.contains("new AudioRecord("),
            "y tiene que poder crear un AudioRecord nuevo (si no, no hay recreación)");
    }

    private static String read(String path) {
        try {
            java.nio.file.Path p = java.nio.file.Paths.get(path);
            if (!java.nio.file.Files.exists(p)) {
                return "";
            }
            return new String(java.nio.file.Files.readAllBytes(p), "UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }
}
