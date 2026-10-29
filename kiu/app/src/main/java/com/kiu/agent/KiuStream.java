package com.kiu.agent;

/* v2.3.0 · sección 2 (seguridad): streaming real por push.
 *
 * El wrapper JNI (kiullama_jni.cpp) llama a KiuStream.onToken(textoParcial) desde el
 * hilo de generación cada ~300 ms / 16 tokens mientras el modelo produce texto.
 * Acá se convierte en un KiuJsPost hacia la WebView: window.kiuPush('gen', {so: ...}).
 *
 * Con esto la UI pinta la respuesta a medida que nace y el JS puede dejar de
 * sondear kiuGenStatus cada 130 ms (mira el push y solo sondea como respaldo).
 * En builds con las .so precompiladas (sin el callback nuevo) el JS simplemente
 * no recibe pushes y sigue con el sondeo de siempre: sin rupturas.
 */
public final class KiuStream {
    private static volatile long lastMs = 0;

    private KiuStream() { }

    public static void onToken(final String soFar) {
        final MainActivity m = MainActivity.inst;
        if (m == null || soFar == null || soFar.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (now - lastMs < 250) return; /* cinturón de seguridad: el C++ ya limita */
        lastMs = now;
        final String esc = esc(soFar);
        try {
            m.runOnUiThread(new KiuJsPost("if(window.kiuPush)window.kiuPush('gen',{so:\"" + esc + "\"})"));
        } catch (Throwable ignored) { }
    }

    /* mismo escapado JSON que KiuGenJob.esc */
    static String esc(String s) {
        if (s == null) return "";
        try {
            return s.replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\r\n", "\\n").replace("\n", "\\n")
                    .replace("\r", "\\n").replace("\t", " ");
        } catch (Throwable th) {
            return s;
        }
    }
}
