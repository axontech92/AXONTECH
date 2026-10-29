package com.kiu.agent;

import android.app.Notification;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * v2.17.0 · Lee las notificaciones para poder contestar "qué me llegó". Solo funciona si el
 * usuario le da "Acceso a notificaciones" a Kiu en los ajustes del sistema (no hay permiso de
 * ejecución para esto: es una pantalla aparte, y Android lo muestra como un permiso delicado).
 *
 * <p>Lo que se guarda y por qué vive solo en RAM está en {@link KiuNotifStore}.
 */
public class KiuNotifService extends NotificationListenerService {

    private static KiuNotifStore store;

    /** El almacén compartido con el puente. Se crea al primer uso, con el paquete real. */
    public static synchronized KiuNotifStore store(String ownPackage) {
        if (store == null) {
            store = new KiuNotifStore(ownPackage);
        }
        return store;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || sbn.getNotification() == null) {
                return;
            }
            Notification n = sbn.getNotification();
            Bundle ex = n.extras;
            if (ex == null) {
                return;
            }
            CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) {
                text = ex.getCharSequence(Notification.EXTRA_TEXT);
            }
            String pkg = sbn.getPackageName();
            String app = pkg;
            try {
                PackageManager pm = getPackageManager();
                app = String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
            } catch (Exception ignored) {
                /* sin etiqueta: se usa el nombre del paquete */
            }
            boolean ongoing = (n.flags & Notification.FLAG_ONGOING_EVENT) != 0;
            boolean group = (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0;
            store(getPackageName()).add(pkg, app,
                    title == null ? "" : title.toString(),
                    text == null ? "" : text.toString(),
                    ongoing, group, System.currentTimeMillis());
        } catch (Exception ignored) {
            /* una notificación rara no puede tirar el servicio */
        }
    }
}
