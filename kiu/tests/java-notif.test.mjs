/* java-notif.test.mjs — EJECUTA KiuNotifStore (Java puro) con un JDK real.
 * Mismo molde que java.test.mjs: sin JDK se salta a la vista, nunca pasa en silencio,
 * y hay un control negativo que prueba que el arnés sabe fallar.
 * node --test tests/java-notif.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'app/src/main/java/com/kiu/agent/KiuNotifStore.java');
const HARNESS = path.join(here, 'java/com/kiu/agent/NotifStoreHarness.java');
const hayJdk = spawnSync('javac', ['-version'], { encoding: 'utf8' }).status === 0;
const skip = hayJdk ? false : 'sin JDK (javac no encontrado)';

function correr(srcPath) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-notif-'));
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', out, srcPath], { encoding: 'utf8' });
  execFileSync('javac', ['-encoding', 'UTF-8', '-cp', out, '-d', out, HARNESS], { encoding: 'utf8' });
  const r = spawnSync('java', ['-cp', out, 'com.kiu.agent.NotifStoreHarness'], { encoding: 'utf8' });
  const txt = (r.stdout || '') + (r.stderr || '');
  const m = txt.match(/checks=(\d+) fails=(\d+)/);
  return { txt, checks: m ? Number(m[1]) : 0, fails: m ? Number(m[2]) : -1, code: r.status };
}

test('KiuNotifStore se EJECUTA y cumple lo que promete', { skip }, () => {
  const r = correr(SRC);
  assert.equal(r.fails, 0, r.txt);
  assert.ok(r.checks >= 15, 'tiene que haber corrido de verdad: ' + r.checks);
  assert.equal(r.code, 0);
});

test('el arnés detecta un almacén roto (control negativo)', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiu-notif-neg-'));
  const roto = path.join(dir, 'com/kiu/agent/KiuNotifStore.java');
  fs.mkdirSync(path.dirname(roto), { recursive: true });
  /* misma forma, otro comportamiento: ya no descarta las notificaciones en curso */
  fs.writeFileSync(roto, fs.readFileSync(SRC, 'utf8').replace('if (ongoing || groupSummary ||', 'if (groupSummary ||'));
  const r = correr(roto);
  assert.notEqual(r.code, 0, 'con el almacén roto el arnés tiene que FALLAR');
  assert.match(r.txt, /FAIL en curso se descarta/);
});
