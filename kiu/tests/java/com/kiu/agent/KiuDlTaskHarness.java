package com.kiu.agent;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;

/**
 * Arnés de ejecución real de {@link KiuDlTask} (v2.15.0).
 *
 * <p>Existe por un bug concreto y caro. En v2.14.2 la verificación del
 * SHA-256 trate "no pude calcular el hash" como "el archivo está corrupto":
 * <b>borraba el archivo y pedía descargarlo de nuevo</b>. Con eso el usuario
 * entraba en un bucle sin salida (descargar → error → borrar → descargar) y la
 * actualización quedaba IMPOSIBLE. El reporte fue:
 * "no pude verificar el archivo (SHA-256 ilegible): se borro, descargalo de nuevo".
 *
 * <p>Lo que fija este arnés:
 * <ul>
 *   <li>el magic de GGUF: un archivo que no es GGUF no pasa como modelo;</li>
 *   <li>el hash de un archivo real se calcula (64 hex) y es estable;</li>
 *   <li>con el digest correcto, el archivo se finaliza y queda verificado;</li>
 *   <li>con el digest EQUIVOCADO, el archivo se borra (ahí sí es corrupción);</li>
 *   <li>si el hash no se puede calcular, <b>NO se bloquea la instalación</b>:
 *       Android igual verifica la firma del APK al instalarlo, así que bloquear
 *       por nuestra cuenta solo dejaba al usuario sin poder actualizar.</li>
 * </ul>
 *
 * <p>Salida por stdout: una línea {@code FAIL <motivo>} por aserción que no se
 * cumplió, y al final {@code checks=N fails=M}. Sale con 1 si hubo algún fallo.
 */
public class KiuDlTaskHarness {

    private static int checks = 0;
    private static int fails = 0;

    private static void check(boolean cond, String what) {
        checks++;
        if (!cond) {
            fails++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) throws Exception {
        File base = Files.createTempDirectory("kiu-dl").toFile();
        try {
            elMagicDeGGUF(base);
            elHashSeCalcula(base);
            conDigestCorrectoSeFinaliza(base);
            conDigestEquivocadoSeBorra(base);
            loQueNoEsGGUFNoPasa(base);
            sinHashNoSeBloquea(base);
        } catch (Throwable t) {
            fails++;
            System.out.println("FAIL el arnés exploto: " + t);
        }
        System.out.println("checks=" + checks + " fails=" + fails);
        if (fails > 0) {
            System.exit(1);
        }
    }

    /* ---------- helpers ---------- */
    private static File archivo(File dir, String nombre, byte[] datos) throws Exception {
        File f = new File(dir, nombre);
        try (FileOutputStream o = new FileOutputStream(f)) {
            o.write(datos);
        }
        return f;
    }

    private static byte[] datos() {
        byte[] b = new byte[64 * 1024];
        for (int i = 0; i < b.length; i++) {
            b[i] = (byte) (i * 7 + 3);
        }
        return b;
    }

    /* ---------- 1 · el magic de GGUF ---------- */
    private static void elMagicDeGGUF(File dir) throws Exception {
        File ok = archivo(dir, "m1.gguf", "GGUF-version-data".getBytes("UTF-8"));
        check(KiuDlTask.ggufMagic(ok), "un archivo que empieza con GGUF es un GGUF");

        File no = archivo(dir, "m2.gguf", "NOPE-version-data".getBytes("UTF-8"));
        check(!KiuDlTask.ggufMagic(no), "uno que no empieza con GGUF no lo es");

        File corto = archivo(dir, "m3.gguf", "GG".getBytes("UTF-8"));
        check(!KiuDlTask.ggufMagic(corto), "menos de 4 bytes no puede ser GGUF");

        check(!KiuDlTask.ggufMagic(new File(dir, "no-existe.gguf")), "un archivo que no existe no es GGUF");

        File vacio = archivo(dir, "m4.gguf", new byte[0]);
        check(!KiuDlTask.ggufMagic(vacio), "un archivo vacío no es GGUF");
    }

    /* ---------- 2 · el hash ---------- */
    private static void elHashSeCalcula(File dir) throws Exception {
        File f = archivo(dir, "a.bin", datos());
        String h = KiuDlTask.hashOf(f);
        check(h != null && h.length() == 64, "el hash tiene que tener 64 hex, no " + (h == null ? "null" : h.length()));
        check(h.equals(KiuDlTask.hashOf(f)), "el hash tiene que ser estable");
        byte[] otro = new byte[64 * 1024];
        for (int i = 0; i < otro.length; i++) {
            otro[i] = (byte) (i * 11 + 5);   // contenido DISTINTO
        }
        check(!h.equals(KiuDlTask.hashOf(archivo(dir, "b.bin", otro))), "archivos distintos, hashes distintos");
        check(KiuDlTask.hashOf(new File(dir, "no-existe")).isEmpty(), "un archivo que no existe no tiene hash");
    }

    /* ---------- 3 · el digest correcto ---------- */
    private static void conDigestCorrectoSeFinaliza(File dir) throws Exception {
        File part = archivo(dir, "b.bin.part", datos());
        File out = new File(dir, "b.bin");
        String want = KiuDlTask.hashOf(part);

        KiuDlTask t = new KiuDlTask("u1", "http://ejemplo/x", "b.bin", dir.getAbsolutePath(), null, want);
        boolean ok = t.finish(part, out, false);
        check(ok, "con el digest correcto tiene que finalizar bien (err: " + t.err + ")");
        check(t.verified, "y queda verificado");
        check(out.exists(), "el archivo final existe");
        check(!part.exists(), "el .part desaparece");
    }

    /* ---------- 4 · el digest equivocado SÍ es corrupción ---------- */
    private static void conDigestEquivocadoSeBorra(File dir) throws Exception {
        File part = archivo(dir, "c.bin.part", datos());
        File out = new File(dir, "c.bin");
        String falso = "0000000000000000000000000000000000000000000000000000000000000000";

        KiuDlTask t = new KiuDlTask("u2", "http://ejemplo/x", "c.bin", dir.getAbsolutePath(), null, falso);
        boolean ok = t.finish(part, out, false);
        check(!ok, "con el digest equivocado NO tiene que finalizar bien");
        check(t.err != null && t.err.contains("corrupto"), "el motivo dice que está corrupto (err: " + t.err + ")");
        check(!part.exists(), "y el archivo corrupto se borra");
    }

    /* ---------- 5 · lo que no es GGUF no pasa como modelo ---------- */
    private static void loQueNoEsGGUFNoPasa(File dir) throws Exception {
        File part = archivo(dir, "d.gguf.part", "NOPE".getBytes("UTF-8"));
        File out = new File(dir, "d.gguf");
        KiuDlTask t = new KiuDlTask("u3", "http://ejemplo/x", "d.gguf", dir.getAbsolutePath(), null, "");
        boolean ok = t.finish(part, out, true);
        check(!ok, "un archivo que no es GGUF no se finaliza como modelo");
        check(t.err != null && t.err.contains("corrupto"), "y avisa que está corrupto (err: " + t.err + ")");
    }

    /* ---------- 6 · LA REGRESIÓN: si no se puede hashear, NO se bloquea ---------- */
    private static void sinHashNoSeBloquea(File dir) throws Exception {
        /* Un DIRECTORIO en lugar del archivo: hashFile no puede leerlo (devuelve
           "") y en v2.14.2 el bloque lo BORRABA y cortaba la instalación con
           "SHA-256 ilegible". Ese fue el bug que dejó al usuario sin poder
           actualizar nunca. */
        File raro = new File(dir, "raro.bin");
        check(raro.mkdirs(), "se pudo crear el caso raro");
        File out = new File(dir, "raro-final.bin");
        String want = "1111111111111111111111111111111111111111111111111111111111111111";

        KiuDlTask t = new KiuDlTask("u4", "http://ejemplo/x", "raro.bin", dir.getAbsolutePath(), null, want);
        t.finish(raro, out, false);

        check(t.err == null || !t.err.contains("ilegible"),
                "que no se pueda calcular el hash NO puede cortar la instalación (err: " + t.err + ")");
        check(t.err == null || !t.err.contains("SHA-256 ilegible"), "el mensaje viejo no puede volver");
        check(!t.verified, "y queda sin verificar, que es distinto de estar roto");
    }
}
