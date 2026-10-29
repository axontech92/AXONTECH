package com.kiu.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/* loaded from: classes.dex
 *
 * v2.8.0: además de la notificación, avisa a la WebView si está viva. El estado
 * 'Disparado' del mapa antes no lo disparaba nadie: el avatar no se enteraba de
 * que una alarma había sonado. El broadcast es interno (no sale de la app) y
 * MainActivity lo escucha; si la app está cerrada no hay avatar que pintar, así
 * que no hace falta guardarlo.
 */
public class ReminderReceiver extends BroadcastReceiver {
    public static final String CHANNEL_ID = "kiu_alarms";
    public static final String ACTION_FIRED = "com.kiu.agent.REMINDER_FIRED";

    @Override // android.content.BroadcastReceiver
    public void onReceive(Context context, Intent intent) {
        String stringExtra = intent.getStringExtra("id");
        String stringExtra2 = intent.getStringExtra("title");
        if (stringExtra2 == null || stringExtra2.trim().isEmpty()) {
            stringExtra2 = "Recordatorio de Kiu";
        }
        Alarms.remove(context, stringExtra);
        notify(context, stringExtra2);
        broadcast(context, stringExtra == null ? "" : stringExtra, stringExtra2);
    }

    /* v2.8.0: si hay una WebView viva, que el bot se entere */
    static void broadcast(Context context, String id, String title) {
        try {
            Intent i = new Intent(ACTION_FIRED);
            i.setPackage(context.getPackageName());
            i.putExtra("id", id);
            i.putExtra("title", title);
            context.sendBroadcast(i);
        } catch (Throwable ignored) {
        }
    }

    static void notify(Context context, String str) {
        Notification build;
        NotificationManager notificationManager = (NotificationManager) context.getSystemService("notification");
        if (notificationManager == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel notificationChannel = new NotificationChannel(CHANNEL_ID, "Alarmas de Kiu", 4);
            notificationChannel.setDescription("Recordatorios que suenan a la hora exacta");
            notificationChannel.enableVibration(true);
            notificationChannel.setVibrationPattern(new long[]{0, 400, 250, 400, 250, 400});
            try {
                Uri defaultUri = RingtoneManager.getDefaultUri(4);
                if (defaultUri == null) {
                    defaultUri = RingtoneManager.getDefaultUri(2);
                }
                notificationChannel.setSound(defaultUri, new AudioAttributes.Builder().setUsage(4).setContentType(4).build());
            } catch (Exception unused) {
            }
            notificationManager.createNotificationChannel(notificationChannel);
        }
        Intent intent = new Intent(context, (Class<?>) MainActivity.class);
        intent.setFlags(805306368);
        /* v2.5.0: FLAG_IMMUTABLE obligatorio en Android 12+ con target 34 */
        PendingIntent activity = PendingIntent.getActivity(context, 101, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= 26) {
            build = new Notification.Builder(context, CHANNEL_ID).setSmallIcon(R.drawable.ic_notif).setContentTitle("Kiu te recuerda").setContentText(str).setStyle(new Notification.BigTextStyle().bigText(str)).setContentIntent(activity).setAutoCancel(true).setCategory("alarm").build();
        } else {
            build = new Notification.Builder(context).setSmallIcon(R.drawable.ic_notif).setContentTitle("Kiu te recuerda").setContentText(str).setStyle(new Notification.BigTextStyle().bigText(str)).setContentIntent(activity).setAutoCancel(true).setPriority(2).setDefaults(-1).build();
        }
        try {
            notificationManager.notify((int) (System.currentTimeMillis() & 2147483647L), build);
        } catch (Exception unused2) {
        }
    }
}
