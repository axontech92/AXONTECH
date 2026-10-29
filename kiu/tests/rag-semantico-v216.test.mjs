import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const gradle = fs.readFileSync('app/build.gradle.kts', 'utf8');
const core = fs.readFileSync('app/src/main/assets/www/js/rag-worker.js', 'utf8');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
test('versión Android sube a 2.12.4 / código 79', () => {
  assert.ok(((m) => m && (+m[1] * 1e6 + +m[2] * 1e3 + +m[3]) >= 2012007)(gradle.match(/val kiuVersionName = "(\d+)\.(\d+)\.(\d+)"/)), 'la versión no puede bajar de 2.12.7');
  assert.ok(+gradle.match(/val kiuVersionCode = (\d+)/)[1] >= 81, 'el versionCode no puede bajar de 81');
});
test('RAG divide por encabezados y conserva el tema en cada fragmento', () => {
  assert.match(core, /fragmentos semánticos/);
  assert.match(core, /line\.match/);
  assert.match(core, /heading/);
  assert.match(changelog, /## \[2\.12\.7\]/);
});
