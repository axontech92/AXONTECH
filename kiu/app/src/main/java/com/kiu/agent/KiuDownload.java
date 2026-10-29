package com.kiu.agent;

import android.content.Context;
import java.io.File;
import java.io.RandomAccessFile;
import java.util.concurrent.ConcurrentHashMap;

/* loaded from: classes.dex */
public class KiuDownload {
    private static ConcurrentHashMap<String, KiuDlTask> jobs = new ConcurrentHashMap<>();

    public static void cancel(String str) {
        try {
            KiuDlTask kiuDlTask = jobs.get(str);
            if (kiuDlTask != null) {
                kiuDlTask.cancelled = true;
            }
        } catch (Throwable unused) {
        }
    }

    public static boolean del(Context context, String str) {
        try {
            String safe = safe(str);
            File modelsDir = modelsDir(context);
            boolean delete = new File(modelsDir, safe).delete();
            new File(modelsDir, safe + ".part").delete();
            return delete;
        } catch (Throwable unused) {
            return false;
        }
    }

    private static String esc(String str) {
        if (str == null) {
            return "";
        }
        try {
            return str.replace("\\", "\\\\").replace("\"", "\\\"");
        } catch (Throwable unused) {
            return str;
        }
    }

    public static long free(Context context) {
        try {
            File modelsDir = modelsDir(context);
            modelsDir.mkdirs();
            return modelsDir.getUsableSpace();
        } catch (Throwable unused) {
            return 0L;
        }
    }

    private static boolean ggufMagic(File file) {
        RandomAccessFile randomAccessFile = null;
        try {
            RandomAccessFile randomAccessFile2 = new RandomAccessFile(file, "r");
            try {
                byte[] bArr = new byte[4];
                if (randomAccessFile2.read(bArr) == 4) {
                    boolean z = bArr[0] == 71 && bArr[1] == 71 && bArr[2] == 85 && bArr[3] == 70;
                    try {
                        randomAccessFile2.close();
                    } catch (Throwable unused) {
                    }
                    return z;
                }
                try {
                    randomAccessFile2.close();
                } catch (Throwable unused2) {
                }
                return false;
            } catch (Throwable unused3) {
                try {
                    randomAccessFile2.close();
                } catch (Throwable unused4) {
                }
                return false;
            }
        } catch (Throwable unused5) {
            return false;
        }
    }

    public static String list(Context context) {
        try {
            File modelsDir = modelsDir(context);
            modelsDir.mkdirs();
            File[] listFiles = modelsDir.listFiles();
            StringBuilder sb = new StringBuilder("[");
            if (listFiles != null) {
                boolean z = true;
                for (File file : listFiles) {
                    if (file.isFile()) {
                        long length = file.length();
                        if (!z) {
                            sb.append(",");
                        }
                        String name = file.getName();
                        sb.append("{\"n\":\"").append(esc(name)).append("\",\"b\":").append(length).append(",\"g\":").append(name.toLowerCase().endsWith(".gguf") ? ggufMagic(file) : true ? "true" : "false").append(",\"path\":\"").append(esc(file.getAbsolutePath())).append("\"}");
                        z = false;
                    }
                }
            }
            sb.append("]");
            return sb.toString();
        } catch (Throwable unused) {
            return "[]";
        }
    }

    public static File modelsDir(Context context) {
        try {
            File externalFilesDir = context.getExternalFilesDir("models");
            return externalFilesDir != null ? externalFilesDir : new File(context.getFilesDir(), "models");
        } catch (Throwable unused) {
            return new File("models");
        }
    }

    private static String safe(String str) {
        if (str == null) {
            return "modelo.gguf";
        }
        try {
            String trim = str.replace("/", "_").replace("\\", "_").replace("..", "_").trim();
            return trim.length() == 0 ? "modelo.gguf" : trim;
        } catch (Throwable unused) {
            return "modelo.gguf";
        }
    }

    public static String start(Context context, String str, String str2, String str3) {
        return start(context, str, str2, str3, null);
    }

    /* v2.4.0: sobrecarga con SHA-256 esperado (del catálogo) para verificar la descarga */
    public static String start(Context context, String str, String str2, String str3, String str4) {
        try {
            if (str.trim().isEmpty()) {
                if (str2 == null || str2.trim().length() <= 0) {
                    return "{\"id\":\"\",\"st\":\"idle\"}";
                }
                File modelsDir = modelsDir(context);
                modelsDir.mkdirs();
                return "{\"id\":\"\",\"st\":\"idle\",\"path\":\"" + esc(new File(modelsDir, safe(str2)).getAbsolutePath()) + "\"}";
            }
            String safe = safe(str2);
            File modelsDir2 = modelsDir(context);
            modelsDir2.mkdirs();
            String absolutePath = modelsDir2.getAbsolutePath();
            File file = new File(modelsDir2, safe);
            if (file.exists() && file.length() > 0) {
                if (!safe.toLowerCase().endsWith(".gguf") || ggufMagic(file)) {
                    return "{\"id\":\"\",\"st\":\"done\",\"name\":\"" + esc(safe) + "\",\"b\":" + file.length() + ",\"path\":\"" + esc(file.getAbsolutePath()) + "\"}";
                }
                file.delete();
                new File(modelsDir2, safe + ".part").delete();
            }
            String str5 = "d" + System.currentTimeMillis();
            KiuDlTask kiuDlTask = new KiuDlTask(str5, str, safe, absolutePath, str3, str4);
            jobs.put(str5, kiuDlTask);
            new Thread(kiuDlTask).start();
            return "{\"id\":\"" + str5 + "\",\"st\":\"queued\",\"name\":\"" + esc(safe) + "\",\"path\":\"" + esc(absolutePath + "/" + safe) + "\"}";
        } catch (Throwable th) {
            return "{\"id\":\"\",\"st\":\"error\",\"err\":\"" + esc(String.valueOf(th)) + "\"}";
        }
    }

    /* v2.11.3: baja el APK de una actualización con el mismo motor que los modelos (progreso con
       status(), cancelar con cancel(), y si se corta reanuda desde el .part). Solo acepta URLs de
       los Releases de este repo. «size» es el tamaño esperado (del Release) para descartar un
       archivo viejo o cortado con el mismo nombre. */
    public static String startApk(Context context, String url, String name, String size, String sha) {
        try {
            if (url == null || !url.startsWith(KiuUpdate.RELEASES)) {
                return "{\"id\":\"\",\"st\":\"error\",\"err\":\"URL no valida\"}";
            }
            String safe = safe(name);
            if (!safe.toLowerCase().endsWith(".apk")) {
                safe = safe + ".apk";
            }
            File dir = KiuUpdate.dir(context);
            dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) {
                for (File f : old) {
                    if (f.isFile() && !f.getName().equals(safe) && !f.getName().equals(safe + ".part")) {
                        f.delete();
                    }
                }
            }
            long want = 0L;
            try {
                want = Long.parseLong(size == null ? "0" : size.trim());
            } catch (Throwable ignored) {
            }
            /* v2.11.12: huella SHA-256 que publica GitHub para este archivo (64 hex) */
            String want256 = "";
            if (sha != null) {
                String t = sha.trim().toLowerCase();
                if (t.startsWith("sha256:")) {
                    t = t.substring(7);
                }
                if (t.length() == 64) {
                    want256 = t;
                }
            }
            File file = new File(dir, safe);
            if (file.exists() && file.length() > 0) {
                boolean shaOk = want256.isEmpty() || want256.equals(KiuDlTask.hashOf(file));
                if (shaOk && (want <= 0 || file.length() == want)) {
                    return "{\"id\":\"\",\"st\":\"done\",\"name\":\"" + esc(safe) + "\",\"b\":" + file.length() + ",\"path\":\"" + esc(file.getAbsolutePath()) + "\"}";
                }
                file.delete();
            }
            String id = "u" + System.currentTimeMillis();
            KiuDlTask task = new KiuDlTask(id, url, safe, dir.getAbsolutePath(), null, want256);
            jobs.put(id, task);
            new Thread(task).start();
            return "{\"id\":\"" + id + "\",\"st\":\"queued\",\"name\":\"" + esc(safe) + "\",\"path\":\"" + esc(file.getAbsolutePath()) + "\"}";
        } catch (Throwable th) {
            return "{\"id\":\"\",\"st\":\"error\",\"err\":\"" + esc(String.valueOf(th)) + "\"}";
        }
    }

    public static String status(String str) {
        try {
            KiuDlTask kiuDlTask = jobs.get(str);
            if (kiuDlTask == null) {
                return "{\"id\":\"" + esc(str) + "\",\"st\":\"none\"}";
            }
            return "{\"id\":\"" + esc(str) + "\",\"st\":\"" + esc(kiuDlTask.state) + "\",\"got\":" + kiuDlTask.got + ",\"total\":" + kiuDlTask.total + ",\"err\":\"" + esc(kiuDlTask.err) + "\",\"path\":\"" + esc(kiuDlTask.path) + "\",\"sha256\":\"" + esc(kiuDlTask.sha256) + "\",\"verified\":" + (kiuDlTask.verified ? "true" : "false") + "}";
        } catch (Throwable unused) {
            return "{\"st\":\"error\"}";
        }
    }
}
