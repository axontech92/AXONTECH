package com.kiu.agent;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/* loaded from: classes.dex */
public final class Alarms {
    private static final String PREF = "kiu_reminders";

    private Alarms() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREF, 0);
    }

    public static void add(Context context, String str, String str2, long j) {
        try {
            JSONArray all = all(context);
            JSONArray jSONArray = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject jSONObject = all.getJSONObject(i);
                if (!str.equals(jSONObject.optString("id"))) {
                    jSONArray.put(jSONObject);
                }
            }
            JSONObject jSONObject2 = new JSONObject();
            jSONObject2.put("id", str);
            jSONObject2.put("title", str2);
            jSONObject2.put("time", j);
            jSONArray.put(jSONObject2);
            prefs(context).edit().putString("data", jSONArray.toString()).apply();
        } catch (Exception unused) {
        }
    }

    public static void remove(Context context, String str) {
        try {
            JSONArray all = all(context);
            JSONArray jSONArray = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject jSONObject = all.getJSONObject(i);
                if (!str.equals(jSONObject.optString("id"))) {
                    jSONArray.put(jSONObject);
                }
            }
            prefs(context).edit().putString("data", jSONArray.toString()).apply();
        } catch (Exception unused) {
        }
    }

    public static JSONArray all(Context context) {
        try {
            return new JSONArray(prefs(context).getString("data", "[]"));
        } catch (Exception unused) {
            return new JSONArray();
        }
    }

    public static boolean canExact(Context context) {
        if (Build.VERSION.SDK_INT < 31) {
            return true;
        }
        AlarmManager alarmManager = (AlarmManager) context.getSystemService("alarm");
        return alarmManager != null && alarmManager.canScheduleExactAlarms();
    }

    public static void schedule(Context context, String str, String str2, long j) {
        AlarmManager alarmManager;
        if (j > System.currentTimeMillis() && (alarmManager = (AlarmManager) context.getSystemService("alarm")) != null) {
            PendingIntent pending = pending(context, str, str2, j);
            if (canExact(context)) {
                alarmManager.setExactAndAllowWhileIdle(0, j, pending);
            } else {
                alarmManager.setAndAllowWhileIdle(0, j, pending);
            }
            add(context, str, str2, j);
        }
    }

    public static void cancel(Context context, String str) {
        String str2 = str;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService("alarm");
        if (alarmManager != null) {
            long j = 0;
            try {
                JSONArray all = all(context);
                for (int i = 0; i < all.length(); i++) {
                    JSONObject jSONObject = all.getJSONObject(i);
                    if (str.equals(jSONObject.optString("id"))) {
                        str2 = jSONObject.optString("title", str);
                        try {
                            j = jSONObject.optLong("time", 0L);
                            break;
                        } catch (Exception unused) {
                        }
                    }
                }
            } catch (Exception unused2) {
            }
            alarmManager.cancel(pending(context, str, str2, j));
        }
        remove(context, str);
    }

    private static PendingIntent pending(Context context, String str, String str2, long j) {
        Intent intent = new Intent(context, (Class<?>) ReminderReceiver.class);
        intent.putExtra("id", str);
        intent.putExtra("title", str2);
        intent.putExtra("time", j);
        /* v2.5.0: Android 12+ exige declarar mutabilidad — sin esto las alarmas
           crasheaban en teléfonos modernos con target 34 */
        return PendingIntent.getBroadcast(context, (int) (str.hashCode() & 2147483647L), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /* v2.8.0: devuelve cuántas alarmas quedaron realmente programadas. El JS lo
       usa para el estado 'Reprogramado al reiniciar': Android borra todas las
       alarmas al reiniciar o al actualizar la app, y hasta ahora no había forma de
       contar cuántas volvieron (ni de avisarle al usuario). */
    public static int rescheduleAll(Context context) {
        int n = 0;
        try {
            JSONArray all = all(context);
            long currentTimeMillis = System.currentTimeMillis();
            for (int i = 0; i < all.length(); i++) {
                JSONObject jSONObject = all.getJSONObject(i);
                long optLong = jSONObject.optLong("time", 0L);
                if (optLong > currentTimeMillis) {
                    schedule(context, jSONObject.optString("id"), jSONObject.optString("title"), optLong);
                    n++;
                } else {
                    /* v2.7.2: antes se borraba en silencio. Si venció hace menos de 48 h (telefono
                       apagado / app cerrada), avisamos una sola vez y recien despues se elimina. */
                    String mid = jSONObject.optString("id");
                    if (optLong > 0 && currentTimeMillis - optLong < 48L * 3600000L) {
                        try { ReminderReceiver.notify(context, "(Perdido) " + jSONObject.optString("title", "Recordatorio")); } catch (Throwable ignored) { }
                    }
                    remove(context, mid);
                }
            }
        } catch (Exception unused) {
        }
        return n;
    }
}
