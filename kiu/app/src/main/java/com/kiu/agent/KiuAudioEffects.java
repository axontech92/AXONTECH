package com.kiu.agent;

import android.media.AudioRecord;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;

/**
 * Efectos de audio opcionales ligados a la sesión de AudioRecord.
 * Cada efecto se trata como best-effort: algunos dispositivos/ROM no lo soportan.
 */
final class KiuAudioEffects implements AutoCloseable {
    private static volatile boolean observed;
    private static volatile boolean aecAvailable;
    private static volatile boolean aecEnabled;
    private static volatile boolean nsAvailable;
    private static volatile boolean nsEnabled;
    private static volatile boolean agcAvailable;
    private static volatile boolean agcEnabled;

    static String diagnosticJson() {
        return "{\"observed\":" + observed + ",\"aecAvailable\":" + aecAvailable
                + ",\"aecEnabled\":" + aecEnabled + ",\"nsAvailable\":" + nsAvailable
                + ",\"nsEnabled\":" + nsEnabled + ",\"agcAvailable\":" + agcAvailable
                + ",\"agcEnabled\":" + agcEnabled + "}";
    }
    private AcousticEchoCanceler echo;
    private NoiseSuppressor noise;
    private AutomaticGainControl gain;

    private KiuAudioEffects() {}

    static KiuAudioEffects attach(AudioRecord record) {
        KiuAudioEffects effects = new KiuAudioEffects();
        if (record == null) return effects;
        observed = true;
        aecAvailable = false; nsAvailable = false; agcAvailable = false;
        aecEnabled = false; nsEnabled = false; agcEnabled = false;
        try { aecAvailable = AcousticEchoCanceler.isAvailable(); } catch (Throwable ignored) { }
        try { nsAvailable = NoiseSuppressor.isAvailable(); } catch (Throwable ignored) { }
        try { agcAvailable = AutomaticGainControl.isAvailable(); } catch (Throwable ignored) { }
        final int session = record.getAudioSessionId();
        if (session <= 0) return effects;
        try {
            if (AcousticEchoCanceler.isAvailable()) {
                effects.echo = AcousticEchoCanceler.create(session);
                if (effects.echo != null) { effects.echo.setEnabled(true); aecEnabled = effects.echo.getEnabled(); }
            }
        } catch (Throwable ignored) { effects.safeReleaseEcho(); }
        try {
            if (NoiseSuppressor.isAvailable()) {
                effects.noise = NoiseSuppressor.create(session);
                if (effects.noise != null) { effects.noise.setEnabled(true); nsEnabled = effects.noise.getEnabled(); }
            }
        } catch (Throwable ignored) { effects.safeReleaseNoise(); }
        try {
            if (AutomaticGainControl.isAvailable()) {
                effects.gain = AutomaticGainControl.create(session);
                if (effects.gain != null) { effects.gain.setEnabled(true); agcEnabled = effects.gain.getEnabled(); }
            }
        } catch (Throwable ignored) { effects.safeReleaseGain(); }
        return effects;
    }

    private void safeReleaseEcho() { try { if (echo != null) echo.release(); } catch (Throwable ignored) {} echo = null; }
    private void safeReleaseNoise() { try { if (noise != null) noise.release(); } catch (Throwable ignored) {} noise = null; }
    private void safeReleaseGain() { try { if (gain != null) gain.release(); } catch (Throwable ignored) {} gain = null; }

    @Override public void close() {
        safeReleaseEcho();
        safeReleaseNoise();
        safeReleaseGain();
    }
}
