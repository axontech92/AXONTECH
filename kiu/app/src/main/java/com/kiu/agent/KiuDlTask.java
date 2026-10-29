package com.kiu.agent;

import java.io.Closeable;
import java.io.File;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.security.MessageDigest;

/* loaded from: classes.dex */
public class KiuDlTask implements Runnable {
    public String auth;
    public volatile boolean cancelled;
    public String dir;
    public String id;
    public String name;
    public String path;
    public String url;
    public volatile String state = "queued";
    public volatile String err = "";
    public volatile long got = 0;
    public volatile long total = 0;
    /* v2.4.0 (sección 1): SHA-256 en streaming. Si "expect" viene del catálogo,
       al terminar se verifica; si no coincide, el archivo se borra y queda err. */
    public String sha256 = "";
    public String expect = "";
    public boolean verified = false;

    public KiuDlTask(String str, String str2, String str3, String str4, String str5) {
        this.id = str;
        this.url = str2;
        this.name = str3;
        this.dir = str4;
        this.auth = str5;
    }

    public KiuDlTask(String str, String str2, String str3, String str4, String str5, String str6) {
        this(str, str2, str3, str4, str5);
        this.expect = (str6 == null) ? "" : str6.trim().toLowerCase();
    }

    private static String hex(byte[] bArr) {
        char[] d = "0123456789abcdef".toCharArray();
        char[] out = new char[bArr.length * 2];
        for (int i = 0; i < bArr.length; i++) {
            int v = bArr[i] & 0xFF;
            out[i * 2] = d[v >>> 4];
            out[i * 2 + 1] = d[v & 0x0F];
        }
        return new String(out);
    }

    /* hashea un archivo ya escrito (para reanudaciones: el .part previo
       también entra al digest, así el SHA final cubre el archivo completo) */
    private static String hashFile(File file) {
        InputStream in = null;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            in = new java.io.FileInputStream(file);
            byte[] buf = new byte[131072];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            return hex(md.digest());
        } catch (Throwable unused) {
            return "";
        } finally {
            closeQuiet(in);
        }
    }

    /* helper público para otras clases (KiuImport calcula el SHA del GGUF importado) */
    public static String hashOf(File file) {
        return (file == null || !file.exists()) ? "" : hashFile(file);
    }

    private static void closeQuiet(Closeable closeable) {
        if (closeable != null) {
            try {
                closeable.close();
            } catch (Throwable unused) {
            }
        }
    }

    static boolean ggufMagic(File file) { /* v2.7.3: visible al paquete (KiuImport tambien valida) */
        RandomAccessFile randomAccessFile = null;
        try {
            RandomAccessFile randomAccessFile2 = new RandomAccessFile(file, "r");
            try {
                byte[] bArr = new byte[4];
                if (randomAccessFile2.read(bArr) == 4) {
                    boolean z = bArr[0] == 71 && bArr[1] == 71 && bArr[2] == 85 && bArr[3] == 70;
                    closeQuiet(randomAccessFile2);
                    return z;
                }
                closeQuiet(randomAccessFile2);
                return false;
            } catch (Throwable unused) {
                closeQuiet(randomAccessFile2);
                return false;
            }
        } catch (Throwable unused2) {
            return false;
        }
    }

    /* v2.14.2 · VISIBLE AL PAQUETE (como ggufMagic) para que el arnés de
       ejecución real lo pueda probar. No es una API: es un método con
       LOGICA DE VERIFICACIÓN que vale la pena cubrir de verdad. */
    boolean finish(File file, File file2, boolean z) {
        if (z && !ggufMagic(file)) {
            try {
                file.delete();
            } catch (Throwable unused) {
            }
            this.err = "archivo corrupto (descarga danada): se borro, descargalo de nuevo";
            this.state = "err";
            return false;
        }
        /* v2.4.0: SHA-256 del archivo completo (.part previo + bytes nuevos) */
        this.sha256 = hashFile(file);
        /* v2.15.0 · VERIFICAR ES UN PLUS, NO UNA PUERTA.
           v2.14.2 (este bloque) trataba "no pude calcular el hash" como "el
           archivo está corrupto": lo BORRABA y pedía descargar de nuevo. Con
           eso el usuario entraba en un bucle sin salida (descargar, ver el
           error, borrar, descargar...) y la actualización quedaba IMPOSIBLE:
           es justo lo que pasó.
           Y que no se pueda calcular el hash NO significa que el archivo esté
           mal: puede ser que no se haya podido leer. Android igual verifica
           la firma del APK al instalarlo, así que acá no se bloquea nada:
             · el hash NO coincide -> sí es corrupción: se borra y se reintenta;
             · el hash no se pudo calcular -> se sigue, sin verificar. */
        if (this.expect != null && this.expect.length() == 64 && this.sha256.length() == 64) {
            if (!this.expect.equals(this.sha256)) {
                try {
                    file.delete();
                } catch (Throwable unused2) {
                }
                this.err = "archivo corrupto: el hash SHA-256 no coincide con el catalogo (se borro); descargalo de nuevo";
                this.state = "err";
                return false;
            }
        }
        this.verified = this.expect.length() == 64 && this.sha256.length() == 64 && this.expect.equals(this.sha256);
        try {
            if (file2.exists()) {
                file2.delete();
            }
        } catch (Throwable unused3) {
        }
        if (file.renameTo(file2)) {
            this.got = file2.length();
            this.state = "done";
            return true;
        }
        this.err = "no pude finalizar el archivo en el disco";
        this.state = "err";
        return false;
    }

    /**
     * Descarga con reanudación (HTTP Range) sobre archivo .part.
     * Reescrito desde cero para el build Gradle (el método original no pudo
     * descompilarse de forma fiable).
     */
    @Override // java.lang.Runnable
    public void run() {
        File part = new File(this.dir, this.name + ".part");
        File out = new File(this.dir, this.name);
        java.net.HttpURLConnection conn = null;
        RandomAccessFile raf = null;
        java.io.InputStream in = null;
        try {
            this.state = "downloading";
            if (part.getParentFile() != null) {
                part.getParentFile().mkdirs();
            }
            long resumeFrom = part.exists() ? part.length() : 0L;
            conn = (java.net.HttpURLConnection) new java.net.URL(this.url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (this.auth != null && this.auth.trim().length() > 0) {
                conn.setRequestProperty("Authorization", this.auth.startsWith("Bearer ") ? this.auth : "Bearer " + this.auth);
            }
            if (resumeFrom > 0L) {
                conn.setRequestProperty("Range", "bytes=" + resumeFrom + "-");
            }
            conn.connect();
            int code = conn.getResponseCode();
            if (resumeFrom > 0L && code == 200) {
                resumeFrom = 0L; // el servidor ignoró el Range: arrancar de nuevo
            }
            if (code == 416 && resumeFrom > 0L) {
                /* v2.7.2: el .part ya estaba completo (se corto justo antes de finalizar) y el
                   Range pedido cae fuera del archivo -> antes quedaba atascado en "HTTP 416"
                   para siempre. Se verifica y finaliza lo que ya hay (si el SHA no coincide
                   finish() lo borra y el siguiente intento arranca limpio). */
                this.total = resumeFrom;
                this.got = resumeFrom;
                if (finish(part, out, this.name.toLowerCase().endsWith(".gguf"))) {
                    this.path = out.getAbsolutePath();
                }
                return;
            }
            if (code / 100 != 2) {
                throw new java.io.IOException("HTTP " + code);
            }
            long len = conn.getContentLengthLong();
            this.total = len > 0L ? resumeFrom + len : 0L;
            this.got = resumeFrom;
            raf = new RandomAccessFile(part, "rw");
            raf.setLength(resumeFrom); /* v2.7.2: si el servidor ignoro el Range, descartar el .part viejo */
            raf.seek(resumeFrom);
            in = conn.getInputStream();
            byte[] buf = new byte[65536];
            while (!this.cancelled) {
                int n = in.read(buf);
                if (n < 0) {
                    break;
                }
                raf.write(buf, 0, n);
                this.got += (long) n;
            }
            closeQuiet(raf);
            raf = null;
            closeQuiet(in);
            in = null;
            if (this.cancelled) {
                this.state = "cancelled";
                return; // el .part queda para reanudar más tarde
            }
            if (this.total > 0L && this.got < this.total) {
                throw new java.io.IOException("conexion cortada: " + this.got + "/" + this.total + " bytes");
            }
            if (finish(part, out, this.name.toLowerCase().endsWith(".gguf"))) {
                this.path = out.getAbsolutePath(); /* v2.7.2: solo si la verificacion pasó */
            }
        } catch (Throwable th) {
            this.err = String.valueOf(th);
            this.state = "err";
        } finally {
            closeQuiet(raf);
            closeQuiet(in);
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Throwable unused) {
                }
            }
        }
    }
}
