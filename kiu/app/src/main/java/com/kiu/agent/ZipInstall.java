package com.kiu.agent;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Extracción de un zip de modelo, sin Android (v2.9.7).
 *
 * <p>Existe separada de {@link KiuVoskInstall} por una razón concreta: esto es Java
 * puro —{@code java.io} y {@code java.util.zip}, nada más— así que se puede compilar
 * y ejecutar en una JVM normal y probar contra el <b>zip real</b> de 39 MB. La parte
 * que se quedó en la clase de Android es la que arma el estado y habla con el puente;
 * la parte que puede fallar en silencio —descomprimir en el nivel equivocado, dejar
 * pasar un {@code ../}— es esta, y es la que quedó testeada.
 *
 * <p>Dos cosas que hace y que son la diferencia entre funcionar y no:
 *
 * <ul>
 *   <li><b>Quita la carpeta raíz del zip.</b> El zip oficial trae
 *       {@code vosk-model-small-es-0.42/am/final.mdl}. Descomprimir tal cual deja el
 *       modelo un nivel más abajo de donde lo busca el motor, y el síntoma es el peor
 *       de todos: el modelo pesa 60 MB en disco y la app sigue diciendo «falta el
 *       modelo», para siempre. Se aprende el prefijo de la primera entrada, en vez de
 *       hardcodearlo, para que si upstream renombra la carpeta siga funcionando.</li>
 *   <li><b>Corta el zip-slip.</b> Cada ruta se canonicaliza contra el destino y tiene
 *       que empezar por él. Un nombre con {@code ../} escribiría fuera de la carpeta de
 *       la app, que en Android es el filesystem entero. No es paranoia: un zip
 *       renombrado de ahí viene.</li>
 * </ul>
 */
final class ZipInstall {

    /** Aviso de progreso. Puro Java: el llamador lo conecta al puente si quiere. */
    interface Progress {
        void onBytes(long total);

        void onFile(long bytes);
    }

    static final class Result {
        long files;
        long bytes;
        int skipped;      // entradas cortadas por zip-slip, o directamente fuera
        String err = "";
        boolean ok;
    }

    private ZipInstall() {
    }

    /**
     * Descomprime {@code zipPath} dentro de {@code destDir}, quitando la carpeta raíz.
     *
     * @return qué pasó. No tira excepciones: un error de disco se devuelve en
     *         {@code err} porque el llamador lo muestra, no lo propaga.
     */
    static Result extract(String zipPath, String destDir, Progress p) {
        Result r = new Result();
        InputStream fin = null;
        ZipInputStream zin = null;
        try {
            File dest = new File(destDir);
            dest.mkdirs();
            String prefix = dest.getCanonicalPath() + File.separator;

            fin = new FileInputStream(zipPath);
            zin = new ZipInputStream(fin);
            ZipEntry e;
            byte[] buf = new byte[65536];
            String raiz = null;
            while ((e = zin.getNextEntry()) != null) {
                String name = e.getName();
                if (name == null || name.isEmpty()) {
                    r.skipped++;
                    zin.closeEntry();
                    continue;
                }
                if (raiz == null) {
                    int barra = name.indexOf('/');
                    raiz = barra > 0 ? name.substring(0, barra + 1) : "";
                }
                if (!raiz.isEmpty() && name.startsWith(raiz)) {
                    name = name.substring(raiz.length());
                }
                if (name.isEmpty()) {
                    zin.closeEntry();
                    continue;
                }

                String canon;
                try {
                    canon = new File(prefix + name).getCanonicalPath();
                } catch (Throwable th) {
                    r.skipped++;
                    zin.closeEntry();
                    continue;
                }
                if (!canon.startsWith(prefix)) {
                    r.skipped++;
                    zin.closeEntry();
                    continue;
                }

                File f = new File(canon);
                if (name.endsWith("/")) {
                    f.mkdirs();
                    zin.closeEntry();
                    continue;
                }
                File parent = f.getParentFile();
                if (parent != null) {
                    parent.mkdirs();
                }
                OutputStream out = null;
                long written = 0;
                try {
                    out = new FileOutputStream(f);
                    int n;
                    while ((n = zin.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        written += n;
                        r.bytes += n;
                        if (p != null) {
                            p.onBytes(r.bytes);
                        }
                    }
                    r.files++;
                    if (p != null) {
                        p.onFile(written);
                    }
                } catch (Throwable th) {
                    r.err = String.valueOf(th);
                } finally {
                    cerrar(out);
                }
                zin.closeEntry();
            }
            r.ok = r.err.isEmpty();
        } catch (Throwable th) {
            r.err = String.valueOf(th);
            r.ok = false;
        } finally {
            cerrar(zin);
            cerrar(fin);
        }
        return r;
    }

    /**
     * ¿El modelo quedó donde el motor lo va a buscar?
     *
     * <p>Se llama antes de decir que la instalación terminó. Instalar y que no sirva
     * es peor que no instalar: el usuario ve «listo» y después la palabra de activación
     * no funciona, y no tiene forma de saber que el modelo está mal puesto.
     */
    static boolean sirveComoModelo(String destDir) {
        File d = new File(destDir);
        return new File(d, "am/final.mdl").exists() || new File(d, "final.mdl").exists();
    }

    private static void cerrar(java.io.Closeable c) {
        if (c != null) {
            try {
                c.close();
            } catch (Throwable ignored) {
            }
        }
    }
}
