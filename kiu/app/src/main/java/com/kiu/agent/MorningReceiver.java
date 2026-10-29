package com.kiu.agent;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.text.format.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/* v2.5.0 (sección 4-b): resumen matutino.
 * Una alarma diaria (la fija la UI vía kiuMorningSet) dispara esta clase:
 * arma un resumen con datos FRESCOS del teléfono (fecha, recordatorios de
 * Alarms, batería) y lo publica como notificación. Si la app está abierta,
 * además inyecta el resumen en el chat vía KiuJsPost. Reagenda el día
 * siguiente solo. Sin permisos nuevos: usa el AlarmManager ya declarado. */
public class MorningReceiver extends BroadcastReceiver {
    public static final String PREF = "kiu_morning";
    public static final String CHANNEL_ID = "kiu_morning";

    private static final String[] TIPS = {
            "Probá \"modo ninja\" en el chat: los skills instalables cambian cómo contesto.",
            "Puedo partir pedidos largos: \"poné alarma a las 7 y buscá en mis notas la receta\".",
            "\"Llama a mamá\" o \"manda un whatsapp a Juan diciendo ya llego\": uso tus contactos reales.",
            "En Copias de seguridad podés llevar todo a otro teléfono en un archivo.",
            "\"Recuerda que...\" guarda lo que me digas: sobrevive a reinicios y actualizaciones.",
            "Tocá el micrófono una vez y quedamos conversando: manos libres.",
            "En Modelos puedo descargar una IA que corre solo en tu teléfono."
    };

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREF, 0);
    }

    /* ---- API para el puente ---- */
    public static void set(Context c, int hour, int minute, boolean on) {
        SharedPreferences.Editor e = prefs(c).edit()
                .putInt("hour", hour).putInt("minute", minute).putBoolean("on", on);
        e.apply();
        if (on) {
            schedule(c, nextOccurrence(hour, minute));
        } else {
            cancelScheduled(c);
        }
    }

    public static String get(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            o.put("on", p.getBoolean("on", false));
            o.put("hour", p.getInt("hour", 8));
            o.put("minute", p.getInt("minute", 0));
        } catch (Exception ignored) { }
        return o.toString();
    }

    /* BootReceiver + cambio de hora: si está activo, reagenda */
    public static void rescheduleIfOn(Context c) {
        SharedPreferences p = prefs(c);
        if (p.getBoolean("on", false)) {
            schedule(c, nextOccurrence(p.getInt("hour", 8), p.getInt("minute", 0)));
        }
    }

    /* ---- horario ---- */
    private static long nextOccurrence(int hour, int minute) {
        Calendar cal = Calendar.getInstance();
        Calendar now = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (!cal.after(now)) cal.add(Calendar.DAY_OF_YEAR, 1);
        return cal.getTimeInMillis();
    }

    private static PendingIntent pending(Context c) {
        Intent i = new Intent(c, MorningReceiver.class);
        return PendingIntent.getBroadcast(c, 7105, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void schedule(Context c, long at) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            if (Alarms.canExact(c)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c));
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c));
            }
        } catch (Exception ignored) { }
    }

    private static void cancelScheduled(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(pending(c));
        } catch (Exception ignored) { }
    }

    /* ---- contenido del resumen (datos frescos al disparar) ---- */
    static String compose(Context c) {
        StringBuilder sb = new StringBuilder();
        Calendar cal = Calendar.getInstance();
        int h = cal.get(Calendar.HOUR_OF_DAY);
        sb.append(h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches");
        String dia = new SimpleDateFormat("EEEE d 'de' MMMM", new Locale("es")).format(new Date());
        sb.append(". Hoy es ").append(dia).append(".\n");

        /* recordatorios de las próximas 36 h (los que guarda Alarms) */
        try {
            JSONArray all = Alarms.all(c);
            long now = System.currentTimeMillis();
            int n = 0;
            StringBuilder lines = new StringBuilder();
            for (int i = 0; i < all.length() && n < 4; i++) {
                JSONObject r = all.getJSONObject(i);
                long t = r.optLong("time", 0L);
                if (t > now && t < now + 36L * 3600000L) {
                    String hh = DateFormat.getTimeFormat(c).format(new Date(t));
                    lines.append("• ").append(hh).append(" — ").append(r.optString("title", "")).append("\n");
                    n++;
                }
            }
            if (n > 0) {
                sb.append("Tenés ").append(n).append(n == 1 ? " recordatorio:\n" : " recordatorios:\n").append(lines);
            } else {
                sb.append("No tengo recordatorios para hoy. Sos todo tuyo.\n");
            }
        } catch (Exception ignored) { }

        /* v2.9.0: la agenda del día. El resumen decía "no tengo recordatorios para
           hoy" y nada más, que es distinto de "no tenés nada hoy": los eventos del
           calendario del sistema son la mitad de lo que la gente tiene anotado, y
           antes Kiu no los podía leer. Solo si el permiso está concedido: sin él
           el resumen sigue igual de útil, no arranca a pedir permisos a las 8am. */
        try {
            if (c.checkSelfPermission("android.permission.READ_CALENDAR") == 0) {
                StringBuilder ev = new StringBuilder();
                int en = 0;
                long d0 = System.currentTimeMillis();
                long d1 = d0 + 86400000L;
                android.database.Cursor cur = c.getContentResolver().query(
                        android.provider.CalendarContract.Instances.CONTENT_URI,
                        new String[]{"title", "begin"},
                        "begin >= ? AND begin < ? AND deleted = 0",
                        new String[]{String.valueOf(d0), String.valueOf(d1)},
                        "begin ASC");
                while (cur != null && cur.moveToNext() && en < 5) {
                    long b = cur.isNull(1) ? 0L : cur.getLong(1);
                    if (b <= 0) continue;
                    ev.append("• ").append(DateFormat.getTimeFormat(c).format(new Date(b)))
                      .append(" — ").append(cur.isNull(0) ? "" : cur.getString(0)).append("\n");
                    en++;
                }
                if (cur != null) cur.close();
                if (en > 0) {
                    sb.append("\nAgenda de hoy: ").append(en == 1 ? "1 cosa:\n" : en + " cosas:\n").append(ev);
                }
            }
        } catch (Exception ignored) { }

        /* batería */
        try {
            Intent b = c.registerReceiver(null, new android.content.IntentFilter("android.intent.action.BATTERY_CHANGED"));
            if (b != null) {
                int lvl = b.getIntExtra("level", -1), sc = b.getIntExtra("scale", -1);
                if (lvl >= 0 && sc > 0) {
                    sb.append("Batería: ").append((lvl * 100) / sc).append('%');
                    int st = b.getIntExtra("status", -1);
                    sb.append(st == 2 || st == 5 ? " (cargando).\n" : ".\n");
                }
            }
        } catch (Exception ignored) { }

        /* consejo del día (rota por día del año) */
        try {
            sb.append("\nTip: ").append(TIPS[cal.get(Calendar.DAY_OF_YEAR) % TIPS.length]).append("\n");
        } catch (Exception ignored) { }

        sb.append("\n— Kiu");
        return sb.toString();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String text = compose(context);
        notify(context, text);
        /* si la UI está viva, el resumen también queda en el chat */
        try {
            new Thread(new KiuJsPost("window.kiuMorningSummary && window.kiuMorningSummary("
                    + jsonQuote(text) + ");")).start();
        } catch (Exception ignored) { }
        /* mañana otra vez */
        SharedPreferences p = prefs(context);
        schedule(context, nextOccurrence(p.getInt("hour", 8), p.getInt("minute", 0)));
    }

    private static String jsonQuote(String s) {
        try { return org.json.JSONObject.quote(s == null ? "" : s); }
        catch (Throwable t) { return "\"\""; }
    }

    private static void notify(Context context, String text) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Resumen de Kiu", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Tu resumen de la mañana");
            nm.createNotificationChannel(ch);
        }
        Intent i = new Intent(context, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 102, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n;
        if (Build.VERSION.SDK_INT >= 26) {
            n = new Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notif)
                    .setContentTitle("Tu resumen de la mañana")
                    .setContentText(text.length() > 120 ? text.substring(0, 117) + "…" : text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
        } else {
            n = new Notification.Builder(context)
                    .setSmallIcon(R.drawable.ic_notif)
                    .setContentTitle("Tu resumen de la mañana")
                    .setContentText(text.length() > 120 ? text.substring(0, 117) + "…" : text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .setPriority(Notification.PRIORITY_DEFAULT)
                    .build();
        }
        try { nm.notify(2002, n); /* v2.7.3: 2001 es la notificacion fija del servicio de voz (KiuService); la pisaba */ } catch (Exception ignored) { }
    }
}
