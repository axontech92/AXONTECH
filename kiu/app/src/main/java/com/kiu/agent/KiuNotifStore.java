package com.kiu.agent;

import java.util.ArrayList;
import java.util.List;

/**
 * Memoria corta de las notificaciones que Kiu puede leer (v2.17.0).
 *
 * <p>Java puro, sin imports de Android, por la misma razón que {@link Backoff}: la
 * política (cuántas guardar, qué descartar, cómo buscar) es donde se acumulan los
 * bugs y así se puede compilar y ejecutar con un JDK normal.
 *
 * <p>Privacidad, que es lo que define el diseño:
 * <ul>
 *   <li><b>Solo en RAM.</b> Nada se escribe a disco; si el proceso muere, se pierde.</li>
 *   <li><b>Tope duro</b> de {@link #MAX} entradas y de {@link #MAX_TEXT} caracteres
 *       por texto: ni una app ruidosa llena la memoria ni un mensaje enorme llega
 *       entero al prompt del modelo.</li>
 *   <li><b>Se descartan las que no son mensajes</b> (en curso, resúmenes de grupo,
 *       las propias de Kiu), que son ruido para quien pregunta "qué me llegó".</li>
 * </ul>
 */
public final class KiuNotifStore {

    public static final int MAX = 40;
    public static final int MAX_TEXT = 280;

    /** Una notificación ya limpia. Inmutable. */
    public static final class Entry {
        public final String pkg;
        public final String app;
        public final String title;
        public final String text;
        public final long at;

        Entry(String pkg, String app, String title, String text, long at) {
            this.pkg = pkg;
            this.app = app;
            this.title = title;
            this.text = text;
            this.at = at;
        }
    }

    private final ArrayList<Entry> items = new ArrayList<Entry>();
    private final String ownPackage;

    public KiuNotifStore(String ownPackage) {
        this.ownPackage = ownPackage == null ? "" : ownPackage;
    }

    private static String clean(String s, int max) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("[\\p{Cntrl}&&[^\n]]", " ").replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    /**
     * Agrega una notificación. Devuelve false si se descartó (en curso, resumen de
     * grupo, propia o vacía). Si llega la MISMA (app + título + texto) que la última
     * de esa app, se actualiza la hora en vez de duplicarla: las apps de mensajería
     * republican la misma notificación cada vez que cambia el contador.
     */
    public synchronized boolean add(String pkg, String app, String title, String text,
                                    boolean ongoing, boolean groupSummary, long now) {
        if (ongoing || groupSummary || pkg == null || pkg.length() == 0 || pkg.equals(ownPackage)) {
            return false;
        }
        String ti = clean(title, 80);
        String tx = clean(text, MAX_TEXT);
        if (ti.length() == 0 && tx.length() == 0) {
            return false;
        }
        String ap = clean(app, 40);
        if (ap.length() == 0) {
            ap = pkg;
        }
        for (int i = items.size() - 1; i >= 0; i--) {
            Entry e = items.get(i);
            if (e.pkg.equals(pkg)) {
                if (e.title.equals(ti) && e.text.equals(tx)) {
                    items.set(i, new Entry(pkg, ap, ti, tx, now));
                    return true;
                }
                break;
            }
        }
        items.add(new Entry(pkg, ap, ti, tx, now));
        while (items.size() > MAX) {
            items.remove(0);
        }
        return true;
    }

    /** Las más recientes primero; con {@code query}, solo las que lo contienen
     *  (en app, título o texto, sin distinguir mayúsculas). */
    public synchronized List<Entry> recent(String query, int max) {
        String q = query == null ? "" : query.trim().toLowerCase();
        int cap = max <= 0 ? 8 : Math.min(max, 20);
        ArrayList<Entry> out = new ArrayList<Entry>();
        for (int i = items.size() - 1; i >= 0 && out.size() < cap; i--) {
            Entry e = items.get(i);
            if (q.length() == 0 || e.app.toLowerCase().contains(q)
                    || e.title.toLowerCase().contains(q) || e.text.toLowerCase().contains(q)) {
                out.add(e);
            }
        }
        return out;
    }

    public synchronized int size() {
        return items.size();
    }

    public synchronized void clear() {
        items.clear();
    }
}
