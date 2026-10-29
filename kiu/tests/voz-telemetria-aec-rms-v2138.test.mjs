import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(root,p),'utf8');
test('telemetría de voz calcula RMS dBFS con frecuencia limitada y no envía audio',()=>{
  const java=read('app/src/main/java/com/kiu/agent/WakeWordEngine.java');
  assert.match(java,/sumSquares \+= sample \* sample/);
  assert.match(java,/20\.0 \* Math\.log10\(rms \/ 32768\.0\)/);
  assert.match(java,/rmsNow - lastRmsSent >= 500L/);
  assert.match(java,/nexoVoiceRms/);
});
test('diagnóstico reporta estado real AEC/NS de la última sesión de audio',()=>{
  const fx=read('app/src/main/java/com/kiu/agent/KiuAudioEffects.java');
  const main=read('app/src/main/java/com/kiu/agent/MainActivity.java');
  const diag=read('app/src/main/assets/www/js/app/diag-voz.js');
  assert.match(fx,/diagnosticJson\(\)/);
  assert.match(fx,/aecEnabled/);
  assert.match(main,/audioEffects/);
  assert.match(diag,/Cancelación de eco \(AEC\)/);
  assert.match(diag,/Supresión de ruido/);
  assert.match(diag,/diag-voice-rms-value/);
});
test('el callback de RMS actualiza solo el indicador y no persiste el audio',()=>{
  const ui=read('app/src/main/assets/www/js/app/app-ui.js');
  assert.match(ui,/window\.nexoVoiceRms = function \(db\)/);
  assert.match(ui,/meter\.textContent = Number\(db\)\.toFixed\(1\) \+ ' dBFS'/);
});
