import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const motor = fs.readFileSync(path.join(root, 'app/src/main/assets/www/js/app/motor.js'), 'utf8');
const brain = fs.readFileSync(path.join(root, 'app/src/main/assets/www/js/brain.js'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
test('preguntas de conocimiento general no se fuerzan al buscador web', () => {
  assert.match(motor, /No mandar preguntas generales al buscador por defecto/);
  assert.doesNotMatch(motor, /qu\[eé\] es \|qui\[eé\]n es/);
});
test('búsqueda web se reserva para petición explícita o información cambiante', () => {
  /* v2.12.0: «actualmente/hoy» sueltos ya NO mandan a la web; hace falta además un dato
     que cambia (noticias, precio, clima…). Antes la frase llevaba «actualmente» pegada. */
  assert.match(motor, /noticias recientes\|ultima hora\|ultimas noticias/);
  assert.doesNotMatch(motor, /noticias recientes\|ultima hora\|ultimas noticias\|actualmente/);
  assert.match(motor, /marcaTiempo && datoVivo/);
  assert.match(motor, /busca en la web/);
});
test('fallback explica el problema del motor sin exigir una API para conversar', () => {
  assert.match(brain, /No pude generar la respuesta con el motor local/);
  assert.doesNotMatch(brain, /activá un proveedor en Ajustes/);
});
test('versión Android incrementada', () => {
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});
