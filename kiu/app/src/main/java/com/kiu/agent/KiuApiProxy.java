package com.kiu.agent;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/* v2.3.0 · sección 2 (seguridad): proxy HTTP(S) del lado Java.
 *
 * ¿Por qué existe? Antes el JS de la WebView hacía fetch() directo a las APIs en la
 * nube con "Authorization: Bearer <clave en claro>" dentro del WebView. Ahora:
 *   1) Las claves viven cifradas con Keystore (prefs "kiu_keys", vía KiuCrypto) y
 *      NUNCA bajan al WebView: el JS manda el placeholder {{key:nombre}} y este
 *      proxy lo reemplaza por la clave real al momento de abrir el socket.
 *   2) Las llamadas a servidores locales (Ollama / LM Studio / http://127.0.0.1)
 *      también pasan por acá: desde un origen https el navegador bloquearía ese
 *      mixed-content; un socket Java no tiene esa restricción.
 *
 * Reglas de salida:
 *   - https://  → permitido (APIs en la nube, buscadores).
 *   - http://   → SOLO localhost/127.0.0.1/::1, rangos privados (10., 192.168.,
 *                 172.16-31.) y nombres .local/.lan — igual que network_security_config.
 *   - Respuesta máxima 8 MB · timeouts 15 s conexión / 60 s lectura · 1 redirección
 *     automática como máximo (HttpURLConnection no cruza https→http: bien así).
 *
 * Claves atadas a su proveedor (v2.8.0): un placeholder {{key:openai}} solo se
 * sustituye si la petición va realmente a un host de OpenAI. Antes bastaba con que
 * el nombre del placeholder existiera, así que una URL mal configurada (o un
 * servicio local) podía llevarse la clave de otro proveedor. Los proveedores con
 * host propio ("otro", el que el usuario configura a mano) no tienen lista: se
 * inyectan igual, porque la URL y la clave son suyas. Lo que nunca se hace es
 * mandar la clave de un proveedor conocido a un host de OTRO proveedor.
 *
 * Uso (desde el puente): kiuApiStart(id, method, url, headersJson, body) → el JS
 * sondea con kiuApiPoll(id) cada ~60 ms → {st:"run"} | {st:"done",code,body,ct}
 * | {st:"err",msg}. Cancelación: kiuApiStop(id).
 */
public final class KiuApiProxy {
    private static final ConcurrentHashMap<String, Job> JOBS = new ConcurrentHashMap<String, Job>();
    private static final Pattern KEY_PH = Pattern.compile("\\{\\{key:([A-Za-z0-9_\\-.]+)\\}\\}");
    private static final int MAX_BODY = 8 * 1024 * 1024; /* 8 MB */

    /* id de proveedor (el mismo que usa js/app/state.js PROV) → hosts que le pertenecen.
       Un host claimado por un proveedor NO puede recibir la clave de otro. */
    private static final String[][] PROVIDER_HOSTS = {
            {"openai", "api.openai.com"},
            {"gemini", "generativelanguage.googleapis.com"},
            {"groq", "api.groq.com"},
            {"deepseek", "api.deepseek.com"},
            {"openrouter", "openrouter.ai"},
            {"kimi", "api.moonshot.ai"},
            {"nvidia", "integrate.api.nvidia.com"},
    };

    private static final class Job {
        volatile HttpURLConnection conn;
        volatile boolean killed = false;
        volatile long finishedAt = 0;
        volatile String result = "{\"st\":\"run\"}";
    }

    private KiuApiProxy() { }

    public static boolean start(Context ctx, String id, String method, String urlStr,
                                String headersJson, String body) {
        if (id == null || id.trim().isEmpty() || urlStr == null || urlStr.trim().isEmpty()) return false;
        try { JOBS.remove(id); } catch (Throwable ignored) { }
        final Job job = new Job();
        final String fMethod = (method == null || method.trim().isEmpty()) ? "GET" : method.trim().toUpperCase();
        final String fUrl = urlStr.trim();
        final String fHeaders = headersJson == null ? "{}" : headersJson;
        final String fBody = body == null ? "" : body;
        final Context app = ctx != null ? ctx.getApplicationContext() : null;

        /* validación síncrona (barata) para devolver false al JS si el destino no está permitido */
        if (!allowed(fUrl)) {
            job.result = "{\"st\":\"err\",\"msg\":\"destino no permitido por la política de red de Kiu\"}";
            job.finishedAt = System.currentTimeMillis();
            JOBS.put(id, job);
            return true;
        }
        JOBS.put(id, job);
        Thread t = new Thread(new Runnable() {
            @Override // java.lang.Runnable
            public void run() {
                HttpURLConnection conn = null;
                try {
                    String curUrl = fUrl;
                    String curMethod = fMethod;
                    String curBody = fBody;
                    boolean sameHost = true;
                    int code = 0;
                    for (int hop = 0; ; hop++) {
                        URL u = new URL(curUrl);
                        conn = (HttpURLConnection) u.openConnection();
                        job.conn = conn;
                        conn.setRequestMethod(curMethod);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(60000);
                        conn.setInstanceFollowRedirects(false); /* v2.7.1: redirecciones manuales: HttpURLConnection reenviaba Authorization a otro host */
                        conn.setRequestProperty("User-Agent", "Kiu/2.7 (Android)");
                        /* headers del JS, con placeholders {{key:nombre}} resueltos acá */
                        JSONObject hs = new JSONObject(fHeaders);
                        Iterator<String> it = hs.keys();
                        while (it.hasNext()) {
                            String name = it.next();
                            if (name == null) continue;
                            String val = hs.optString(name, "");
                            if (val == null) val = "";
                            if (sameHost) val = injectKeys(app, val, u.getHost()); /* v2.7.1: nunca mandar la clave a otro host tras una redireccion */
                            else if (val.indexOf("{{key:") >= 0) continue;
                            if (!val.isEmpty()) conn.setRequestProperty(name, val);
                        }
                        boolean hasBody = !curBody.isEmpty() || curMethod.equals("POST")
                                || curMethod.equals("PUT") || curMethod.equals("PATCH");
                        if (hasBody && !curMethod.equals("GET") && !curMethod.equals("HEAD")) {
                            conn.setDoOutput(true);
                            byte[] out = curBody.getBytes("UTF-8");
                            conn.setFixedLengthStreamingMode(out.length);
                            OutputStream os = conn.getOutputStream();
                            os.write(out);
                            os.flush();
                            os.close();
                        }
                        code = conn.getResponseCode();
                        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                            String loc = conn.getHeaderField("Location");
                            if (loc == null || hop >= 3) throw new java.io.IOException("demasiadas redirecciones");
                            String next = new URL(new URL(curUrl), loc).toString();
                            if (!allowed(next)) throw new java.io.IOException("redireccion no permitida por la politica de red de Kiu");
                            if (!new URL(next).getHost().equalsIgnoreCase(new URL(curUrl).getHost())) sameHost = false;
                            if (code == 303 || ((code == 301 || code == 302) && !curMethod.equals("GET") && !curMethod.equals("HEAD"))) { curMethod = "GET"; curBody = ""; }
                            try { conn.disconnect(); } catch (Throwable ignored) { }
                            curUrl = next;
                            continue;
                        }
                        break;
                    }
                    String ct = conn.getHeaderField("Content-Type");
                    InputStream in = (code >= 400) ? conn.getErrorStream() : conn.getInputStream();
                    if (in == null) in = conn.getErrorStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    if (in != null) {
                        byte[] chunk = new byte[8192];
                        int n, total = 0;
                        while ((n = in.read(chunk)) > 0) {
                            total += n;
                            if (total > MAX_BODY) { try { in.close(); } catch (Throwable ignored) { }
                                throw new java.io.IOException("respuesta mayor a 8 MB"); }
                            if (job.killed) throw new java.io.IOException("cancelado");
                            buf.write(chunk, 0, n);
                        }
                        try { in.close(); } catch (Throwable ignored) { }
                    }
                    if (job.killed) throw new java.io.IOException("cancelado");
                    String text = buf.toString("UTF-8");
                    JSONObject res = new JSONObject();
                    res.put("st", "done");
                    res.put("code", code);
                    res.put("ct", ct == null ? "" : ct);
                    res.put("body", text);
                    job.result = res.toString();
                } catch (Throwable th) {
                    try {
                        JSONObject res = new JSONObject();
                        res.put("st", "err");
                        String msg = String.valueOf(th.getMessage() == null ? th.toString() : th.getMessage());
                        res.put("msg", job.killed ? "cancelado" : msg);
                        job.result = res.toString();
                    } catch (Throwable ignored) { }
                } finally {
                    job.finishedAt = System.currentTimeMillis();
                    try { if (conn != null) conn.disconnect(); } catch (Throwable ignored) { }
                }
            }
        }, "kiu-api-" + id);
        t.setDaemon(true);
        t.start();
        return true;
    }

    public static String poll(String id) {
        Job j = JOBS.get(id);
        if (j == null) return "{\"st\":\"err\",\"msg\":\"trabajo desconocido\"}";
        if (j.finishedAt > 0 && System.currentTimeMillis() - j.finishedAt > 60000) {
            JOBS.remove(id); /* resultado sin reclamar: ya expiró */
            return "{\"st\":\"err\",\"msg\":\"trabajo expirado\"}";
        }
        if (j.finishedAt > 0) JOBS.remove(id); /* el JS ya lo leyó: fuera */
        return j.result;
    }

    public static void stop(String id) {
        Job j = JOBS.get(id);
        if (j == null) return;
        j.killed = true;
        try { if (j.conn != null) j.conn.disconnect(); } catch (Throwable ignored) { }
    }

    /* Reemplaza {{key:nombre}} por la clave real guardada en Keystore (prefs kiu_keys).
       v2.8.0: solo si `host` pertenece a ese proveedor. Provider_id sin lista propia
       (el personalizado del usuario) se inyecta, salvo que el host de destino sea de
       un proveedor conocido: en ese caso la clave se descarta. */
    private static String injectKeys(Context ctx, String val, String host) throws java.io.IOException {
        if (val == null || val.indexOf("{{key:") < 0) return val;
        String h = host == null ? "" : host.toLowerCase();
        Matcher m = KEY_PH.matcher(val);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String name = m.group(1);
            String key = "";
            boolean may = mayInject(name, h);
            if (may) {
                try {
                    if (ctx != null) {
                        SharedPreferences sp = ctx.getSharedPreferences("kiu_keys", 0);
                        String enc = sp.getString("k_" + name, null);
                        if (enc != null) key = KiuCrypto.dec(enc);
                    }
                } catch (Throwable ignored) { }
            }
            /* v2.11.10 · antes una clave que no se podía leer (o un host que no es el del proveedor) se
               reemplazaba por "" y salía «Authorization: Bearer » vacío: el proveedor respondía 401 y la
               app decía «clave inválida» con una clave buena. Ahora se corta con el motivo real. */
            if (key == null || key.isEmpty()) {
                if (!may) {
                    throw new java.io.IOException("La clave de «" + name + "» no se manda a " + host + ": esa dirección no es la del proveedor. Revisá la URL base.");
                }
                throw new java.io.IOException("No pude leer la clave de «" + name + "» en este teléfono. Volvé a pegarla en Modelos.");
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(key));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /* ¿Este placeholder puede viajar a este host? */
    private static boolean mayInject(String providerId, String host) {
        String mine = providerId == null ? "" : providerId.toLowerCase();
        String[] mineHosts = hostsOf(mine);
        if (mineHosts != null) return hostMatches(host, mineHosts);   /* conocido: ata o suelta */
        /* proveedor del usuario: se inyecta, salvo que el host sea de otro conocido */
        for (String[] row : PROVIDER_HOSTS) {
            if (hostMatches(host, new String[]{row[1]})) return false;
        }
        return true;
    }

    private static String[] hostsOf(String providerId) {
        for (String[] row : PROVIDER_HOSTS) {
            if (row[0].equalsIgnoreCase(providerId)) return new String[]{row[1]};
        }
        return null;
    }

    private static boolean hostMatches(String host, String[] hosts) {
        if (host == null || host.isEmpty()) return false;
        for (String h : hosts) {
            if (host.equalsIgnoreCase(h) || host.toLowerCase().endsWith("." + h)) return true;
        }
        return false;
    }

    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    /* v2.7.1: antes bastaba host.startsWith("10.") -> "http://10.evil.com" pasaba como LAN y salia en claro.
       Ahora solo cuentan IPv4 literales privadas reales o nombres .local/.lan de UNA etiqueta. */
    private static boolean allowed(String url) {
        try {
            URL u = new URL(url);
            String proto = u.getProtocol();
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            if ("https".equals(proto)) return !host.isEmpty();
            if (!"http".equals(proto)) return false;
            if ("localhost".equals(host) || "::1".equals(host) || "[::1]".equals(host)) return true;
            if (host.endsWith(".local") || host.endsWith(".lan")) return true; /* TLDs no enrutables en Internet */
            Matcher m = IPV4.matcher(host);
            if (!m.matches()) return false;
            int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2));
            int c = Integer.parseInt(m.group(3)), d = Integer.parseInt(m.group(4));
            if (a > 255 || b > 255 || c > 255 || d > 255) return false;
            return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
        } catch (Throwable th) {
            return false;
        }
    }
}
