package com.kiu.agent;

import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Instalación del modelo local de la palabra de activación (v2.9.7).
 *
 * <p>Existencia justificada: el modelo Vosk español son 39 MB, así que no puede ir en
 * el repo, y hasta ahora la única forma de instalarlo era saber el comando de
 * {@code adb} y conocer el layout interno del zip. Sin modelo, la palabra de
 * activación local está muerta, y nada en la app lo decía: prendías el micrófono y
 * no pasaba nada, sin error ni aviso.
 *
 * <p>La descarga reusa {@link KiuDownload}, que ya tiene reanudación, SHA-256 y
 * verificación. La extracción la hace {@link ZipInstall}, que es Java puro y está
 * testeada contra el zip real. Esta clase solo coordina: arranca, reporta, y avisa.
 */
public final class KiuVoskInstall {

    /** Zip oficial. El SHA está fijado porque el catálogo de modelos no cubre este. */
    public static final String URL =
            "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
    public static final String SHA256 = "09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f";
    public static final String ZIP_NAME = "vosk-model-small-es-0.42.zip";
    public static final long ZIP_BYTES = 39817833L;
    /** Carpeta que espera {@link WakeWordEngine}. */
    public static final String DIR_NAME = "vosk-es-small";

    private static final Map<String, Job> JOBS = new ConcurrentHashMap<String, Job>();

    private static final class Job {
        volatile String state = "queued";   // queued | unzip | done | error
        volatile String err = "";
        volatile long files = 0;
        volatile long bytes = 0;
        volatile int skipped = 0;
        volatile long got = 0;      // v2.10.1: bytes copiados (importar desde el selector)
        volatile long total = 0;    // -1 si el proveedor no informa el tamaño
        volatile boolean cancel = false;
    }

    private KiuVoskInstall() {
    }

    /** ¿Está el modelo instalado y bien puesto? */
    public static boolean present(android.content.Context ctx) {
        return ZipInstall.sirveComoModelo(dir(ctx));
    }

    public static String dir(android.content.Context ctx) {
        return new File(KiuDownload.modelsDir(ctx), DIR_NAME).getAbsolutePath();
    }

    /** Arranca la descarga del zip con el motor de descargas existente. */
    public static String start(android.content.Context ctx) {
        try {
            if (present(ctx)) {
                return "{\"st\":\"done\",\"present\":true}";
            }
            return KiuDownload.start(ctx, URL, ZIP_NAME, "", SHA256);
        } catch (Throwable th) {
            return "{\"st\":\"error\",\"err\":\"" + esc(String.valueOf(th)) + "\"}";
        }
    }

    /** Descomprime el zip ya descargado. Devuelve el id del job para seguir el progreso. */
    public static String unzip(android.content.Context ctx, String zipPath) {
        try {
            File z = new File(zipPath == null ? "" : zipPath);
            if (!z.exists()) {
                return "{\"st\":\"error\",\"err\":\"no encuentro el zip descargado\"}";
            }
            if (!z.getName().endsWith(".zip")) {
                return "{\"st\":\"error\",\"err\":\"eso no es un .zip\"}";
            }
            final String zipAbs = z.getAbsolutePath();
            final String destDir = dir(ctx);
            final String id = "v" + System.currentTimeMillis();
            final Job job = new Job();
            JOBS.put(id, job);
            new Thread(new Runnable() {
                @Override
                public void run() {
                    extractInto(job, zipAbs, destDir);
                    /* v2.10.1: un zip que no descomprime está corrupto o cortado; si
                       se deja, «Bajar» lo vuelve a encontrar «ya descargado» y falla
                       igual para siempre. Se borra para que el próximo intento baje de nuevo. */
                    if ("error".equals(job.state)) {
                        new File(zipAbs).delete();
                    }
                }
            }, "kiu-vosk-unzip").start();
            return "{\"id\":\"" + id + "\",\"st\":\"queued\"}";
        } catch (Throwable th) {
            return "{\"st\":\"error\",\"err\":\"" + esc(String.valueOf(th)) + "\"}";
        }
    }


    /** Descomprime y comprueba que el modelo quede donde lo busca el motor. */
    private static void extractInto(final Job job, String zipAbs, String destDir) {
        job.state = "unzip";
        ZipInstall.Result res = ZipInstall.extract(zipAbs, destDir, new ZipInstall.Progress() {
            @Override
            public void onBytes(long total) {
                job.bytes = total;
            }

            @Override
            public void onFile(long bytes) {
                job.files++;
            }
        });
        job.bytes = res.bytes;
        job.skipped = res.skipped;
        job.err = esc(res.err);
        /* Instalar y que no sirva es peor que no instalar: antes de decir que terminó
           se comprueba que el modelo quede donde el motor lo busca. */
        if (!res.ok) {
            job.state = "error";
        } else if (!ZipInstall.sirveComoModelo(destDir)) {
            job.state = "error";
            job.err = "el modelo quedó mal puesto: falta am/final.mdl";
        } else {
            job.state = "done";
        }
    }

    /** Id fijo del trabajo de «cargar un zip que ya tengo»: el JS lo consulta con wwUnzipStatus. */
    public static final String IMPORT_ID = "vimport";
    public static final int REQ_PICK = 7105;

    /** v2.10.1 · Abre el selector de archivos para elegir el .zip del modelo que el usuario
        ya bajó, para no tener que descargarlo otra vez. El resultado llega a
        MainActivity.onActivityResult (7105) y de ahí a {@link #importFrom}. */
    public static void pick(final android.app.Activity activity) {
        JOBS.remove(IMPORT_ID);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    activity.startActivityForResult(i, REQ_PICK);
                } catch (Throwable th) {
                    Job j = new Job();
                    j.state = "error";
                    j.err = "no pude abrir el selector de archivos";
                    JOBS.put(IMPORT_ID, j);
                }
            }
        });
    }

    /** Copia el zip elegido a la carpeta de modelos y lo instala. */
    public static void importFrom(final android.content.Context ctx, final android.net.Uri uri) {
        final Job job = new Job();
        job.state = "copy";
        job.total = -1;
        JOBS.put(IMPORT_ID, job);
        new Thread(new Runnable() {
            @Override
            public void run() {
                File zip = null;
                try {
                    android.database.Cursor c = null;
                    try {
                        c = ctx.getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.SIZE}, null, null, null);
                        if (c != null && c.moveToFirst() && !c.isNull(0)) {
                            job.total = c.getLong(0);
                        }
                    } catch (Throwable ignore) {
                    } finally {
                        if (c != null) {
                            c.close();
                        }
                    }
                    File dir = KiuDownload.modelsDir(ctx);
                    dir.mkdirs();
                    zip = new File(dir, "vosk-import.zip");
                    java.io.InputStream in = ctx.getContentResolver().openInputStream(uri);
                    if (in == null) {
                        throw new java.io.IOException("no pude leer el archivo elegido");
                    }
                    java.io.FileOutputStream out = new java.io.FileOutputStream(zip);
                    try {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (job.cancel) {
                                throw new java.io.IOException("cancelado");
                            }
                            out.write(buf, 0, n);
                            job.got += n;
                        }
                    } finally {
                        try {
                            in.close();
                        } catch (Throwable ignore) {
                        }
                        out.close();
                    }
                    /* un .zip empieza por «PK»: si no, el usuario eligió otra cosa */
                    java.io.FileInputStream chk = new java.io.FileInputStream(zip);
                    int b0 = chk.read();
                    int b1 = chk.read();
                    chk.close();
                    if (b0 != 'P' || b1 != 'K') {
                        job.err = "ese archivo no es un .zip (busca vosk-model-small-es-0.42.zip)";
                        job.state = "error";
                        return;
                    }
                    extractInto(job, zip.getAbsolutePath(), dir(ctx));
                } catch (Throwable th) {
                    job.err = esc(String.valueOf(th.getMessage() != null ? th.getMessage() : th));
                    job.state = "error";
                } finally {
                    if (zip != null) {
                        zip.delete();
                    }
                }
            }
        }, "kiu-vosk-import").start();
    }

    public static String cancel() {
        for (Job j : JOBS.values()) {
            j.cancel = true;
        }
        return "{\"st\":\"ok\"}";
    }

    public static String status(String id) {
        Job j = id == null ? null : JOBS.get(id);
        if (j == null) {
            return "{\"st\":\"none\"}";
        }
        StringBuilder b = new StringBuilder(160);
        b.append("{\"st\":\"").append(j.state).append("\"");
        b.append(",\"got\":").append(j.got);
        b.append(",\"total\":").append(j.total);
        b.append(",\"files\":").append(j.files);
        b.append(",\"bytes\":").append(j.bytes);
        b.append(",\"skipped\":").append(j.skipped);
        b.append(",\"err\":\"").append(esc(j.err)).append("\"}");
        return b.toString();
    }

    private static String esc(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "'").replace("\n", " ").replace("\r", " ");
    }
}
