// La VERSION del shell y las novedades (scripts/bump-ui-version.mjs): sw.js, index.html y
// novedades.json sincronizados, y el bump por nivel.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { revisar, subir, pendiente, nivelDe, releaseStaged } from '../scripts/bump-ui-version.mjs';

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('sw.js, index.html y novedades.json están sincronizados', () => {
  assert.deepEqual(revisar({ sw: leer('public/sw.js'), html: leer('public/index.html'), novedades: JSON.parse(leer('public/novedades.json')) }), []);
});

test('revisar encuentra lo que no cierra', () => {
  const sw = "const VERSION = '1.2.0';";
  assert.match(revisar({ sw, html: 'app.js?v=1.1.0', novedades: [] })[0], /index.html/);
  assert.match(revisar({ sw, html: 'app.js?v=1.2.0', novedades: [{ version: '1.1.0', notas: ['x'] }] })[0], /no es la VERSION/);
  assert.match(revisar({ sw, html: 'app.js?v=1.2.0', novedades: [{ version: 'next', notas: [] }] })[0], /notas/);
  assert.deepEqual(revisar({ sw, html: 'app.js?v=1.2.0', novedades: [{ version: 'next:minor', notas: ['x'] }, { version: '1.2.0', notas: ['y'] }] }), []);
});

test('subir por nivel y las pendientes', () => {
  assert.equal(subir('1.2.3', 'patch'), '1.2.4');
  assert.equal(subir('1.2.3', 'minor'), '1.3.0');
  assert.equal(subir('1.2.3', 'major'), '2.0.0');
  assert.ok(pendiente('next') && pendiente('next:major') && !pendiente('1.0.0') && !pendiente('next:mega'));
  assert.equal(nivelDe('next'), 'patch');
  assert.equal(nivelDe('next:minor'), 'minor');
});

test('el commit del release (sube la VERSION) pasa el pre-commit sin novedad pendiente', () => {
  assert.equal(releaseStaged("const VERSION = '0.0.0';", "const VERSION = '0.1.0';"), true);
  assert.equal(releaseStaged("const VERSION = '0.1.0';", "const VERSION = '0.1.0';"), false);
  assert.equal(releaseStaged('', "const VERSION = '0.1.0';"), false);
});

test('el SW guarda el shell de esta versión y nunca la API', () => {
  const sw = leer('public/sw.js');
  for (const f of ['/styles.css?v=${VERSION}', '/app.css?v=${VERSION}', '/app.js?v=${VERSION}']) assert.ok(sw.includes(f), f);
  assert.ok(sw.includes("if (url.pathname.startsWith('/api/')"), 'la API va a la red');
});
