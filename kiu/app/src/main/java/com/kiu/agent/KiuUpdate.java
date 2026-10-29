package com.kiu.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.File;

/* v2.11.3 · ACTUALIZAR DENTRO DE LA APP.
   Antes «Bajar el APK» abría el navegador (otra pantalla). Ahora el APK se baja con el mismo
   motor de descargas que los modelos GGUF (KiuDlTask: reanuda, muestra progreso) y se entrega
   al instalador de Android. Android solo acepta el APK si está firmado con la misma clave. */
public class KiuUpdate {
    /* Solo se instala lo bajado de los Releases de este repo. */
    static final String RELEASES = "https://github.com/Criptobox/KIU/releases/download/";

    public static File dir(Context c) {
        File base = null;
        try {
            base = c.getExternalFilesDir(null);
        } catch (Throwable ignored) {
        }
        if (base == null) {
            base = c.getFilesDir();
        }
        return new File(base, "updates");
    }

    /* v2.11.8: aviso de versión nueva como notificación del sistema (antes solo salía una ventana
       si Kiu estaba abierta y el aviso automático venía apagado por defecto). Toca → abre Kiu. */
    public static void notifyAvailable(Context c, String title, String text) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(new NotificationChannel("kiu_update", "Actualizaciones de Kiu", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(c, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, 7001, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "kiu_update") : new Notification.Builder(c);
            b.setSmallIcon(R.drawable.ic_notif).setContentTitle(title).setContentText(text).setContentIntent(pi).setAutoCancel(true);
            nm.notify(7001, b.build());
        } catch (Throwable ignored) {
        }
    }

    /* v2.14.9: la huella SHA-256 del certificado de firma. Sirve para
       comparar la app instalada con el APK que se quiere poner encima:
       si no coinciden, Android rechaza la instalación. Vacío si no se pudo
       leer (no se puede afirmar nada, y no se debe inventar). */
    private static String certDe(Context c, String apkPath) {
        try {
            android.content.pm.PackageManager pm = c.getPackageManager();
            int flags = (Build.VERSION.SDK_INT >= 28)
                    ? android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES
                    : android.content.pm.PackageManager.GET_SIGNATURES;
            android.content.pm.PackageInfo pi = (apkPath == null)
                    ? pm.getPackageInfo(c.getPackageName(), flags)
                    : pm.getPackageArchiveInfo(apkPath, flags);
            if (pi == null) {
                return "";
            }
            android.content.pm.Signature[] sigs = null;
            if (Build.VERSION.SDK_INT >= 28 && pi.signingInfo != null) {
                sigs = pi.signingInfo.hasMultipleSigners()
                        ? pi.signingInfo.getApkContentsSigners()
                        : pi.signingInfo.getSigningCertificateHistory();
            } else {
                sigs = pi.signatures;
            }
            if (sigs == null || sigs.length == 0) {
                return "";
            }
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            md.update(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /* devuelve «ok», «perm» (falta permitir instalar desde Kiu) o «err:motivo» */
    public static String install(Context c, String path) {
        try {
            File f = new File(path);
            File d = dir(c);
            if (!f.isFile() || !f.getName().toLowerCase().endsWith(".apk")
                    || f.getParentFile() == null
                    || !f.getParentFile().getCanonicalPath().equals(d.getCanonicalPath())) {
                return "err:archivo no valido";
            }
            /* v2.14.9 · ¿LA FIRMA ES LA MISMA?
               Android NO deja instalar un APK encima de la app instalada si
               están firmados con claves distintas. El error del sistema es
               críptico ("no se pudo instalar") y no dice por qué: la persona
               cree que el archivo está roto y desinstala la app, perdiendo la
               memoria y los documentos. Acá se compara el certificado ANTES
               de abrir el instalador y se explica el motivo. */
            String propia = certDe(c, null);
            String nueva = certDe(c, f.getAbsolutePath());
            if (!propia.isEmpty() && !nueva.isEmpty() && !propia.equals(nueva)) {
                return "err:firma distinta: este APK está firmado con otra clave y Android no lo deja instalar encima del que ya tenés. Instalalo con la misma clave de siempre, o desinstalá Kiu primero (perdés la memoria y los documentos).";
            }
            if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES", Uri.parse("package:" + c.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(s);
                return "perm";
            }
            Uri uri = Uri.parse("content://" + c.getPackageName() + ".apk/" + Uri.encode(f.getName()));
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            return "ok";
        } catch (Throwable t) {
            return "err:" + t;
        }
    }
}
