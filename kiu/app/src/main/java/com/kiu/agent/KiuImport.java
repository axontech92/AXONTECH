package com.kiu.agent;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import java.io.File;

/* loaded from: classes2.dex */
public final class KiuImport implements Runnable {
    private final Activity act;
    private final int mode;
    private File part;
    private final Uri uri;
    public static volatile String st = "idle";
    public static volatile String name = "";
    public static volatile String err = "";
    public static volatile long got = 0;
    public static volatile long total = 0;
    public static volatile String sha = "";
    private static volatile boolean cancelReq = false; /* v2.7.4 */

    public static void cancel() { cancelReq = true; }

    private KiuImport(Activity activity, Uri uri, int i) {
        this.act = activity;
        this.uri = uri;
        this.mode = i;
    }

    public static void pick(Activity activity) {
        if (!"run".equals(st)) {
            st = "idle";
            activity.runOnUiThread(new KiuImport(activity, null, 0));
        }
    }

    public static synchronized void begin(Activity activity, Uri uri) { /* v2.7.3: atomico: doble toque = dos copias en el mismo .part */
        if (!"run".equals(st)) {
            st = "run";
            cancelReq = false;
            name = "";
            err = "";
            got = 0L;
            total = 0L;
            sha = "";
            new Thread(new KiuImport(activity, uri, 1)).start();
        }
    }

    public static String status() {
        return "{\"st\":\"" + st + "\",\"got\":" + got + ",\"total\":" + total + ",\"name\":\"" + name + "\",\"err\":\"" + err + "\",\"sha256\":\"" + sha + "\"}";
    }

    @Override // java.lang.Runnable
    public void run() {
        if (this.mode == 0) {
            try {
                Intent intent = new Intent("android.intent.action.OPEN_DOCUMENT");
                intent.addCategory("android.intent.category.OPENABLE");
                intent.setType("*/*");
                this.act.startActivityForResult(intent, 7101);
                return;
            } catch (Throwable th) {
                err = "no pude abrir el selector de archivos";
                st = "err";
                return;
            }
        }
        copy();
    }

    private static String clean(String str) {
        if (str == null) {
            return "";
        }
        String replaceAll = str.replaceAll("[\"\\\\\\r\\n]", " ");
        return replaceAll.length() > 90 ? replaceAll.substring(0, 90) : replaceAll;
    }

    private void fail(String str) {
        err = str;
        st = "err";
    }

    /**
     * Copia el documento elegido (SAF) a la carpeta de modelos con progreso.
     * Reescrito para el build Gradle (el original no descompilo de forma fiable)
     * y completado con TODAS las validaciones del bytecode original
     * (smali_classes2/com/kiu/agent/KiuImport.smali):
     *   - nombre sanitizado con la regex estricta [^A-Za-z0-9._-] -> "_"
     *     (clean() era solo para mensajes de error);
     *   - rechazo si no termina en .gguf;
     *   - chequeo de espacio libre con margen de 50 MB (0x3200000);
     *   - se escribe a <nombre>.part y se renombra al final (nada de archivos
     *     corruptos con nombre definitivo si la copia se corta);
     *   - si algo falla se borra el .part.
     * Encima conserva las mejoras v2.4.0: SHA-256 del GGUF importado.
     */
    private void copy() {
        java.io.InputStream in = null;
        java.io.OutputStream out = null;
        try {
            st = "run";
            android.content.ContentResolver cr = this.act.getContentResolver();
            String fn = null;
            long sz = 0L;
            android.database.Cursor c = cr.query(this.uri, null, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        int di = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                        if (di >= 0 && !c.isNull(di)) {
                            fn = c.getString(di);
                        }
                        int si = c.getColumnIndex(android.provider.OpenableColumns.SIZE);
                        if (si >= 0 && !c.isNull(si)) {
                            sz = c.getLong(si);
                        }
                    }
                } finally {
                    try {
                        c.close();
                    } catch (Throwable unused) {
                    }
                }
            }
            if (fn == null || fn.trim().length() == 0) {
                fn = "modelo.gguf";
            }
            /* Sanitización estricta del original (no la de clean(), que era
               para mensajes de error) + tope de 90 caracteres. */
            fn = fn.replaceAll("[^A-Za-z0-9._-]", "_");
            if (fn.length() > 90) {
                fn = fn.substring(0, 90);
            }
            /* Chequeo de extensión del original (case-insensitive). */
            if (!fn.toLowerCase().endsWith(".gguf")) {
                fail("el archivo no es .gguf");
                return;
            }
            name = fn;
            total = sz > 0L ? sz : 0L;
            File modelsDir = KiuDownload.modelsDir(this.act);
            modelsDir.mkdirs();
            /* Chequeo de espacio del original: usable < total + 0x3200000 (50 MB). */
            if (total > 0L && modelsDir.getUsableSpace() < total + 52428800L) {
                fail("no hay espacio suficiente en el telefono");
                return;
            }
            File dst = new File(modelsDir, fn);
            File part = new File(modelsDir, fn + ".part");
            this.part = part;
            in = cr.openInputStream(this.uri);
            if (in == null) {
                fail("no pude abrir el archivo");
                return;
            }
            out = new java.io.FileOutputStream(part);
            byte[] buf = new byte[65536];
            long n = 0L;
            while (true) {
                int r = in.read(buf);
                if (r < 0) {
                    break;
                }
                if (cancelReq) { /* v2.7.4: cancelar sin dejar GB huerfanos */
                    try { out.close(); } catch (Throwable ignored) { }
                    out = null;
                    try { part.delete(); } catch (Throwable ignored) { }
                    st = "cancelled";
                    return;
                }
                out.write(buf, 0, r);
                n += (long) r;
                got = n;
            }
            out.flush();
            try { ((java.io.FileOutputStream) out).getFD().sync(); } catch (Throwable ignored) { }
            out.close(); /* v2.7.3: cerrar ANTES de renombrar/hashear (antes quedaba abierto hasta el finally) */
            out = null;
            got = n;
            total = n;
            /* v2.7.3: igual que las descargas, rechazar archivos que no son GGUF de verdad */
            if (!KiuDlTask.ggufMagic(part)) {
                try { part.delete(); } catch (Throwable ignored) { }
                fail("el archivo no es un modelo GGUF valido");
                return;
            }
            /* Renombrado final del .part al nombre definitivo (comportamiento
               del original: el archivo recién "existe" cuando está completo). */
            if (!part.renameTo(dst)) {
                if (dst.exists() && dst.delete() && part.renameTo(dst)) {
                    // ok en el segundo intento (había un import anterior)
                } else {
                    try { part.delete(); } catch (Throwable ignored) { } /* v2.7.3: no dejar GB huerfanos */
                    fail("no pude guardar el modelo");
                    return;
                }
            }
            /* v2.4.0 (sección 1): SHA-256 del GGUF importado, para que el usuario
               pueda compararlo con el hash oficial del repositorio si quiere. */
            try {
                sha = KiuDlTask.hashOf(dst);
            } catch (Throwable unused4) {
                sha = "";
            }
            st = "done";
        } catch (Throwable th) {
            /* El original borra el .part si algo falla. */
            if (this.part != null) {
                try {
                    this.part.delete();
                } catch (Throwable unused5) {
                }
            }
            fail(errText(th));
        } finally {
            this.part = null;
            try {
                if (in != null) {
                    in.close();
                }
            } catch (Throwable unused2) {
            }
            try {
                if (out != null) {
                    out.close();
                }
            } catch (Throwable unused3) {
            }
        }
    }

    /** Formato de error del bytecode original: ClaseSimple: mensaje (limpio). */
    private static String errText(Throwable th) {
        String msg = clean(String.valueOf(th.getMessage()));
        String cls = th.getClass().getSimpleName();
        if (cls == null || cls.length() == 0) {
            cls = th.getClass().getName();
        }
        return msg.length() > 0 ? cls + ": " + msg : cls;
    }
}
