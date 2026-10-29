package com.kiu.agent;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.util.Base64;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/* v2.11.10 · CLAVES API QUE SE PERDÍAN EN SILENCIO.
   Antes enc() devolvía "" si el Keystore de Android fallaba (pasa en varios teléfonos, sobre todo
   Xiaomi/HyperOS), y nadie lo comprobaba: la clave se guardaba VACÍA, la pantalla decía «hay clave»
   y el proxy mandaba «Authorization: Bearer » sin nada → todas las APIs respondían 401 aunque la
   clave fuera buena (la misma que funciona en otras apps).
   Ahora:
     1) enc() comprueba que lo que cifró se puede descifrar.
     2) si el Keystore no sirve, cae a una clave AES local de la app (prefs privadas, prefijo «S1:»):
        menos fuerte que el Keystore, pero igual dentro del sandbox de la app y NO se pierde la clave.
     3) dec() entiende los dos formatos. */
public class KiuCrypto {
    private static final String SOFT = "S1:";
    private static volatile Context appCtx;

    public static void init(Context context) {
        if (context != null) {
            appCtx = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        }
    }

    public static String dec(String str) {
        if (str == null || str.isEmpty()) {
            return "";
        }
        if (str.startsWith(SOFT)) {
            return softDec(str.substring(SOFT.length()));
        }
        return keystoreDec(str);
    }

    public static String enc(String str) {
        if (str == null || str.isEmpty()) {
            return "";
        }
        String viaKs = keystoreEnc(str);
        if (viaKs.length() > 0 && str.equals(keystoreDec(viaKs))) {
            return viaKs;
        }
        String viaSoft = softEnc(str);
        if (viaSoft.length() > 0 && str.equals(dec(viaSoft))) {
            return viaSoft;
        }
        return "";
    }

    /* v2.11.12: ¿con qué se guardan las claves en este teléfono? («keystore», «respaldo» o «falla») */
    public static String selfTest() {
        String probe = "kiu-prueba-123";
        String k = keystoreEnc(probe);
        if (k.length() > 0 && probe.equals(keystoreDec(k))) {
            return "keystore";
        }
        String s = softEnc(probe);
        if (s.length() > 0 && probe.equals(dec(s))) {
            return "respaldo";
        }
        return "falla";
    }

    /* ¿esto guardado se puede leer de verdad? */
    public static boolean readable(String stored) {
        return stored != null && !stored.isEmpty() && dec(stored).length() > 0;
    }

    // ---------------- Keystore de Android ----------------
    private static String keystoreDec(String str) {
        try {
            SecretKey key = key();
            byte[] decode = Base64.decode(str, 2);
            byte[] copyOf = Arrays.copyOf(decode, 12);
            byte[] copyOfRange = Arrays.copyOfRange(decode, 12, decode.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(2, key, new GCMParameterSpec(128, copyOf));
            return new String(cipher.doFinal(copyOfRange), "UTF-8");
        } catch (Throwable th) {
            return "";
        }
    }

    private static String keystoreEnc(String str) {
        try {
            SecretKey key = key();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(1, key);
            byte[] iv = cipher.getIV();
            byte[] doFinal = cipher.doFinal(str.getBytes("UTF-8"));
            byte[] bArr = new byte[iv.length + doFinal.length];
            System.arraycopy(iv, 0, bArr, 0, iv.length);
            System.arraycopy(doFinal, 0, bArr, iv.length, doFinal.length);
            return Base64.encodeToString(bArr, 2);
        } catch (Throwable th) {
            return "";
        }
    }

    private static SecretKey key() throws java.security.KeyStoreException, java.security.cert.CertificateException, java.io.IOException, java.security.NoSuchAlgorithmException, javax.crypto.NoSuchPaddingException, java.security.InvalidAlgorithmParameterException, java.security.UnrecoverableKeyException, java.security.NoSuchProviderException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias("kiu_main")) {
            return (SecretKey) keyStore.getKey("kiu_main", null);
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        keyGenerator.init(new KeyGenParameterSpec.Builder("kiu_main", 3).setBlockModes("GCM").setEncryptionPaddings("NoPadding").setKeySize(256).build());
        return keyGenerator.generateKey();
    }

    // ---------------- respaldo: clave AES local de la app ----------------
    private static SecretKey softKey() throws Exception {
        Context c = appCtx;
        if (c == null) {
            throw new IllegalStateException("sin contexto");
        }
        SharedPreferences sp = c.getSharedPreferences("kiu_soft", 0);
        String b64 = sp.getString("sk", null);
        byte[] raw = null;
        if (b64 != null) {
            raw = Base64.decode(b64, 2);
        }
        if (raw == null || raw.length != 32) {
            raw = new byte[32];
            new SecureRandom().nextBytes(raw);
            sp.edit().putString("sk", Base64.encodeToString(raw, 2)).commit();
        }
        return new SecretKeySpec(raw, "AES");
    }

    private static String softEnc(String str) {
        try {
            SecretKey key = softKey();
            byte[] iv = new byte[12];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(1, key, new GCMParameterSpec(128, iv));
            byte[] doFinal = cipher.doFinal(str.getBytes("UTF-8"));
            byte[] out = new byte[iv.length + doFinal.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(doFinal, 0, out, iv.length, doFinal.length);
            return SOFT + Base64.encodeToString(out, 2);
        } catch (Throwable th) {
            return "";
        }
    }

    private static String softDec(String b64) {
        try {
            SecretKey key = softKey();
            byte[] all = Base64.decode(b64, 2);
            byte[] iv = Arrays.copyOf(all, 12);
            byte[] ct = Arrays.copyOfRange(all, 12, all.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(2, key, new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ct), "UTF-8");
        } catch (Throwable th) {
            return "";
        }
    }
}
