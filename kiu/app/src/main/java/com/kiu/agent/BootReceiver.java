package com.kiu.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/* loaded from: classes.dex
 *
 * v2.8.0:
 *   1) Cuenta cuántas alarmas rearma y lo deja anotado en kiu_native.resched, para
 *      que la UI pueda mostrar el estado 'Reprogramado al reiniciar' cuando la app
 *      se abra después (Android borra TODAS las alarmas al reiniciar o al
 *      actualizar; sin esto el usuario no se entera de que volvieron).
 *   2) Wake word tras reinicio en Android 14: desde BOOT_COMPLETED ya no se puede
 *      arrancar un servicio con micrófono. Antes el startForegroundService fallaba
 *      en silencio y Kiu quedaba "escuchando" en Ajustes sin estar escuchando de
 *      verdad. Ahora, si el sistema no lo deja, se manda una notificación pidiendo
 *      que abras la app una vez.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String CH_WAKE_BACK = "kiu_wake_back";

    @Override // android.content.BroadcastReceiver
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        /* v2.7.3: ademas del arranque, al ACTUALIZAR la app Android borra todas las alarmas
           programadas (recordatorios y resumen matutino se perdian hasta abrir la app), y un
           cambio de hora/zona horaria desplaza las alarmas absolutas. */
        boolean boot = "android.intent.action.BOOT_COMPLETED".equals(action)
                || "android.intent.action.MY_PACKAGE_REPLACED".equals(action);
        boolean timeChange = "android.intent.action.TIME_SET".equals(action)
                || "android.intent.action.TIMEZONE_CHANGED".equals(action);
        if (!boot && !timeChange) {
            return;
        }
        int restored = Alarms.rescheduleAll(context);
        if (restored > 0) {
            try {
                context.getSharedPreferences("kiu_native", 0).edit().putInt("resched", restored).apply();
            } catch (Exception ignored) {
            }
        }
        /* v2.5.0 (sección 4-b): el resumen matutino vuelve a armarse tras reiniciar */
        try { MorningReceiver.rescheduleIfOn(context); } catch (Exception ignored) { }
        if (boot && context.getSharedPreferences("kiu_native", 0).getBoolean("wake", false)) {
            startWakeOrAsk(context);
        }
    }

    /* v2.8.0: arranca el servicio de wake word; si Android 14 lo bloquea desde el
       arranque, avisa con una notificación en vez de quedarse mudo. */
    static void startWakeOrAsk(Context context) {
        /* v2.11.2 · BUG REAL: desde Android 14 (targetSdk 34) NO se puede arrancar un servicio
           de micrófono desde BOOT_COMPLETED ni desde MY_PACKAGE_REPLACED. startForegroundService()
           no lanzaba excepción (por eso el catch de abajo nunca avisaba): fallaba después, en
           startForeground() dentro del servicio. Resultado tras CADA actualización: wake=true en
           ajustes, nadie escuchando, y a veces cierre de la app. Ahora no se intenta: se desmarca
           «wake» (la UI deja de mentir) y se avisa para que abras Kiu una vez. */
        if (Build.VERSION.SDK_INT >= 34) {
            try { context.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", false).apply(); } catch (Exception ignored) { }
            askToReactivate(context);
            return;
        }
        boolean started = false;
        try {
            Intent intent2 = new Intent(context, (Class<?>) KiuService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent2);
            } else {
                context.startService(intent2);
            }
            started = true;
        } catch (Exception unused) {
        }
        if (!started) askToReactivate(context);
    }

    static void askToReactivate(Context context) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService("notification");
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CH_WAKE_BACK, "Despertar por voz", 3);
                ch.setDescription("Aviso para volver a activar el micrófono de Kiu");
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(context, (Class<?>) MainActivity.class);
            open.setFlags(805306368 | 268435456); /* NEW_TASK | CLEAR_TOP */
            PendingIntent pi = PendingIntent.getActivity(context, 202, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(context, CH_WAKE_BACK)
                    : new Notification.Builder(context);
            b.setSmallIcon(R.drawable.ic_notif)
                    .setContentTitle("Kiu dejó de escuchar")
                    .setContentText("Android no deja abrir el micrófono en segundo plano (al iniciar o actualizar). Abrí Kiu una vez y vuelve a prender el despertador por voz.")
                    .setStyle(new Notification.BigTextStyle().bigText("Android no deja abrir el micrófono en segundo plano (al iniciar o actualizar). Abrí Kiu una vez y vuelve a prender el despertador por voz."))
                    .setContentIntent(pi)
                    .setAutoCancel(true);
            nm.notify(202, b.build());
        } catch (Throwable ignored) {
        }
    }
}
