// "Mandar a Gastienzos" (public/app.js): el link abre el alta de Gastienzos completada con
// lo pagado, la cadena y la fecha (?add=1&monto=&titulo=&fecha=, lo que lee
// parseLaunchPrefill de gastos-app).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const BASE = app.match(/const GASTIENZOS_URL = '([^']+)';/)[1];
const src = app.match(/function gastienzosUrl\(t, lugar\) \{[\s\S]*?\n\}\n/)[0];
const gastienzosUrl = new Function('GASTIENZOS_URL', `${src}; return gastienzosUrl;`)(BASE);

test('el link va al alta de Gastienzos con lo pagado, la cadena y la fecha', () => {
  const u = new URL(gastienzosUrl({ pagado: 208263.5, fecha: '2026-10-25' }, { cadena: 'Carrefour', sucursal: 'Cabildo' }));
  assert.equal(u.origin, 'https://gastienzos.com.ar');
  assert.equal(u.pathname, '/app');
  assert.deepEqual(Object.fromEntries(u.searchParams), { add: '1', monto: '208263.5', titulo: 'Carrefour', fecha: '2026-10-25' });
});

test('sin lugar no manda título', () => {
  const u = new URL(gastienzosUrl({ pagado: 100, fecha: '2026-10-25' }, null));
  assert.equal(u.searchParams.has('titulo'), false);
});

test('el botón va sólo en un ticket propio y también como acción al guardar', () => {
  assert.match(app, /\$\{mio \? gzBotonHtml\(t\) : ''\}/);
  assert.match(app, /action: 'Mandar a Gastienzos'/);
});
