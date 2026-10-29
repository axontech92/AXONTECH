package com.kiu.agent;

import java.util.List;

/** Arnés de ejecución real de {@link KiuNotifStore}. Salida: FAIL por aserción y "checks=N fails=M". */
public class NotifStoreHarness {
    private static int checks = 0;
    private static int fails = 0;

    private static void check(boolean cond, String what) {
        checks++;
        if (!cond) {
            fails++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) {
        KiuNotifStore s = new KiuNotifStore("com.kiu.agent");

        check(!s.add("com.whatsapp", "WhatsApp", "Ana", "hola", true, false, 1), "en curso se descarta");
        check(!s.add("com.whatsapp", "WhatsApp", "2 chats", "x", false, true, 1), "resumen de grupo se descarta");
        check(!s.add("com.kiu.agent", "Kiu", "Alarma", "x", false, false, 1), "las propias se descartan");
        check(!s.add("com.whatsapp", "WhatsApp", "  ", "\u0000\t ", false, false, 1), "vacía tras limpiar se descarta");
        check(!s.add(null, "x", "a", "b", false, false, 1), "sin paquete se descarta");
        check(s.size() == 0, "nada de lo anterior quedó guardado");

        check(s.add("com.whatsapp", "WhatsApp", "Ana", "¿vamos a cenar?", false, false, 10), "mensaje normal entra");
        check(s.add("com.google.android.gm", "Gmail", "Banco", "Tu resumen de cuenta", false, false, 20), "otra app entra");
        List<KiuNotifStore.Entry> r = s.recent("", 8);
        check(r.size() == 2 && r.get(0).app.equals("Gmail"), "las más recientes primero");

        s.add("com.google.android.gm", "Gmail", "Banco", "Tu resumen de cuenta", false, false, 30);
        check(s.size() == 2, "la misma notificación republicada no se duplica");
        check(s.recent("", 8).get(0).at == 30, "…y se actualiza la hora");

        check(s.recent("cenar", 8).size() == 1, "busca en el texto");
        check(s.recent("GMAIL", 8).size() == 1, "busca en la app sin distinguir mayúsculas");
        check(s.recent("nadaquematchee", 8).size() == 0, "sin coincidencias, vacío");

        StringBuilder largo = new StringBuilder();
        for (int i = 0; i < 2000; i++) {
            largo.append('a');
        }
        s.add("com.x", "X", "t", largo.toString(), false, false, 40);
        check(s.recent("", 1).get(0).text.length() == KiuNotifStore.MAX_TEXT, "el texto se acota");

        for (int i = 0; i < 100; i++) {
            s.add("com.app" + i, "App" + i, "t", "m" + i, false, false, 100 + i);
        }
        check(s.size() == KiuNotifStore.MAX, "el tope de entradas se respeta");
        check(s.recent("", 999).size() == 20, "el máximo por consulta es 20");
        check(s.recent("", 0).size() == 8, "sin máximo, 8");

        s.clear();
        check(s.size() == 0, "clear vacía");

        System.out.println("checks=" + checks + " fails=" + fails);
        System.exit(fails == 0 ? 0 : 1);
    }
}
