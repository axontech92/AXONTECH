package com.kiu.agent;

/**
 * Arnés de ejecución real de {@link Backoff} (v2.9.6).
 *
 * <p>Existe por una limitación concreta: {@code voz-recuperacion.test.mjs} verifica
 * la clase <b>leyendo el fuente con regex</b> — comprueba que el código diga
 * {@code Math.min(maxMs, ...)}, no que haga lo correcto. Eso es un test de la
 * <i>forma</i>, no del <i>comportamiento</i>: un {@code Backoff} reescrito a mano con
 * la misma expresión textual y un {@code if} mal puesto pasaría igual.
 *
 * <p>Como {@code Backoff} es Java puro (cero imports de Android), se puede compilar
 * y ejecutar en una JVM normal. Eso convierte seis asserts de texto en seis
 * ejecutaciones reales, sin Android SDK y sin emulador.
 *
 * <p>Salida por stdout: una línea {@code FAIL <motivo>} por aserción que no se
 * cumplió, y al final {@code checks=N fails=M}. Sale con 1 si hubo algún fallo.
 */
public class BackoffHarness {

    private static int checks = 0;
    private static int fails = 0;

    private static void check(boolean cond, String what) {
        checks++;
        if (!cond) {
            fails++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) {
        CreceYTieneTope();
        SeRindeConSenalExplicita();
        ResetVuelveAlPrincipio();
        ResetNoBorraElErrorQueNoDebe();
        ParametrosAbsurdosNoRompenNada();

        System.out.println("checks=" + checks + " fails=" + fails);
        if (fails > 0) {
            System.exit(1);
        }
    }

    /* La espera dobla y para en el tope. */
    private static void CreceYTieneTope() {
        Backoff b = new Backoff(500L, 8000L, 8);
        long prev = 0L;
        long maxVisto = 0L;
        for (int i = 0; i < 4; i++) {
            long d = b.siguiente();
            if (d < prev) {
                check(false, "la espera no decrece entre intentos: " + prev + " -> " + d);
            }
            if (d > maxVisto) {
                maxVisto = d;
            }
            prev = d;
        }
        check(maxVisto > 500L, "con 4 intentos tiene que haber crecido por encima de la base");
        check(prev <= 8000L, "y nunca pasar del tope: " + prev + " > 8000");
    }

    /* Agotados los intentos devuelve -1, no 0. Un 0 acá produce un reintento
       instantáneo y trabado en el hilo de audio: el peor resultado posible. */
    private static void SeRindeConSenalExplicita() {
        Backoff b = new Backoff(500L, 8000L, 3);
        b.siguiente();
        b.siguiente();
        b.siguiente();
        long d = b.siguiente();
        check(d == -1L, "agotados los intentos tiene que devolver -1, no " + d);
        check(b.quedan() == false, "y quedan() tiene que decir que no hay más");
        /* y rendirse no se "deshace": sigue diciendo -1 */
        check(b.siguiente() == -1L, "rendirse tiene que ser estable, no un -1 que vuelve a crecer");
    }

    /* reset() vuelve al primer intento. */
    private static void ResetVuelveAlPrincipio() {
        Backoff b = new Backoff(500L, 8000L, 8);
        long primero = b.siguiente();
        b.siguiente();
        b.siguiente();
        b.reset();
        /* Guardar el valor: el mensaje del assert se evalúa SIEMPRE, incluso
           cuando la aserción pasa. Escribir b.siguiente() ahí adentro consumía
           un intento más y el contador llegaba a 2 — el test fallaba por su
           propio mensaje de error. */
        long trasReset = b.siguiente();
        check(trasReset == primero,
            "tras reset() el primer intento tiene que volver a ser " + primero + ", no " + trasReset);
        check(b.intentos() == 1, "y el contador vuelve a 1, no a " + b.intentos());
    }

    /* El backoff NO guarda el mensaje de error: eso es del subsistema que lo usa.
       Que este test lo verifique evita el error opuesto: meterle estado de error a
       propósito y que dos capas peleen por él. */
    private static void ResetNoBorraElErrorQueNoDebe() {
        Backoff b = new Backoff(500L, 8000L, 8);
        long antes = b.siguiente();
        b.siguiente();
        b.reset();
        check(b.siguiente() == antes, "reset solo toca la espera, no hay estado de error que resetear");
    }

    /* Parámetros absurdos: que no revienten ni den esperas de 0 ms. */
    private static void ParametrosAbsurdosNoRompenNada() {
        Backoff base0 = new Backoff(0L, 0L, 0);
        long d0 = base0.siguiente();
        check(d0 == -1L, "con 0 intentos no hay reintento, ni siquiera uno con espera 0");

        Backoff negativo = new Backoff(-100L, -50L, 4);
        long dn = negativo.siguiente();
        check(dn > 0L, "una base negativa tiene que convertirse en algo positivo, no en " + dn);
        check(dn >= 1L, "y nunca 0: una espera de 0 es un reintento instantáneo en boucle");
    }
}
