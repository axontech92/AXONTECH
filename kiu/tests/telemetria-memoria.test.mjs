import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const java = fs.readFileSync('app/src/main/java/com/kiu/agent/MainActivity.java', 'utf8');
const ui = fs.readFileSync('app/src/main/assets/www/js/app/app-ui.js', 'utf8');

test('telemetría: sysInfo expone PSS del proceso sin reemplazar la RAM del sistema', () => {
  assert.match(java, /getProcessMemoryInfo\(new int\[\]\{pid\}\)/);
  assert.match(java, /appPssKb/);
  assert.match(java, /ramAvail/);
});

test('telemetría: informa si el motor nativo está cargado y su velocidad disponible', () => {
  assert.match(java, /nativeLoaded/);
  assert.match(java, /KiuNative\.isLoaded\(\)/);
  assert.match(java, /nativeTps/);
  assert.match(java, /KiuNative\.tokensPerSec\(\)/);
});

test('telemetría: la interfaz muestra el uso aproximado de KIU sin romper datos ausentes', () => {
  assert.match(ui, /d\.appPssKb != null/);
  assert.match(ui, /KIU usa/);
  assert.match(ui, /motor local activo/);
  assert.match(ui, /Datos reales en la app del teléfono/);
});
