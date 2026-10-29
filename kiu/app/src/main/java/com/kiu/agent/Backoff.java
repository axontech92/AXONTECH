package com.kiu.agent;

/**
 * Backoff exponencial con tope, para reintentar algo que puede fallar por un
 * motivo externo y pasajero (el micrófono lo toma una llamada, el motor de TTS
 * todavía no arrancó).
 *
 * <p>Existe como clase aparte, y sin una sola import de Android, por dos
 * razones concretas:
 *
 * <ol>
 *   <li><b>Se puede testear.</b> Es lógica pura: entra un número, sale un
 *       número. La política de reintentos es justamente donde se acumulan los
 *       bugs (esperas que nunca crecen, reintentos eternos, contadores que no
 *       se resetean) y era imposible de fijar con tests sin poder compilar
 *       Android.</li>
 *   <li><b>La usan dos sitios distintos</b> —la reconstrucción del micrófono y
 *       el arranque del TTS— y antes cada uno tenía su propia idea de cuánto
 *       esperar, con resultados distintos.</li>
 * </ol>
 *
 * <p>Reglas, que son las que se testean:
 * <ul>
 *   <li>cada intento devuelve la espera <i>antes</i> del siguiente;</li>
 *   <li>la espera dobla cada vez, con techo;</li>
 *   <li>pasados los {@code maxIntentos} devuelve <b>-1</b>: significa «rendirse»,
 *       no «esperar 0». Un 0 acá produce un reintento instantáneo y TRABADO en
 *       el hilo de audio, que es el peor resultado posible; por eso la
 *       señal de rendirse es explícita y no un número ambiguo;</li>
 *   <li>{@link #reset()} vuelve al primer intento, y se llama cuando la cosa
 *       vuelve a funcionar —no cuando pasa el tiempo.</li>
 * </ul>
 *
 * <p>No es thread-safe a propósito: cada loop de audio/TTS tiene el suyo y lo
 * usa de un solo hilo. Ponerle sincronización sería Complexity::new sin ganar
 * nada.
 */
final class Backoff {

    private final long baseMs;
    private final long maxMs;
    private final int maxIntentos;
    private long esperaMs;
    private int intentos;

    Backoff(long baseMs, long maxMs, int maxIntentos) {
        this.baseMs = Math.max(1L, baseMs);
        this.maxMs = Math.max(this.baseMs, maxMs);
        this.maxIntentos = Math.max(0, maxIntentos);
        this.esperaMs = this.baseMs;
        this.intentos = 0;
    }

    /**
     * Registra un fallo y devuelve cuánto esperar antes del próximo intento,
     * o -1 si ya no hay más intentos (hay que rendirse).
     */
    long siguiente() {
        if (intentos >= maxIntentos) {
            return -1L;
        }
        intentos++;
        long d = esperaMs;
        // el próximo duplica, con techo. Se satura antes de multiplicar para no
        // desbordar con esperas grandes.
        esperaMs = (esperaMs >= (Long.MAX_VALUE / 2)) ? maxMs : Math.min(maxMs, esperaMs * 2);
        return d;
    }

    /** La cosa volvió a funcionar: el próximo fallo arranca desde el principio. */
    void reset() {
        intentos = 0;
        esperaMs = baseMs;
    }

    int intentos() {
        return intentos;
    }

    /** ¿Quedan intentos? Para mostrarlo sin tener que consumir uno. */
    boolean quedan() {
        return intentos < maxIntentos;
    }
}
