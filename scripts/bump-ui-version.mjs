#!/usr/bin/env node
// La VERSION del shell (semver X.Y.Z), como en Gastienzos. Vive en public/sw.js (VERSION
// y RELEASED) y en los ?v= de public/index.html: el browser ve un service worker nuevo
// sólo si sw.js cambia, y ahí la app ofrece actualizar. Cada cambio en public/ deja su
// novedad pendiente arriba de public/novedades.json ({ "version": "next" | "next:minor" |
// "next:major", "fecha": "", "notas": [...] }) y el release la numera.
//
//   node scripts/bump-ui-version.mjs [patch|minor|major]  junta las pendientes en una versión
//   node scripts/bump-ui-version.mjs --check              todo sincronizado (lo corre el test)
//   node scripts/bump-ui-version.mjs --staged             el pre-commit: si el commit toca
//                                                         public/, tiene que haber una novedad pendiente
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, ROOT));
const SW = path('public/sw.js');
const HTML = path('public/index.html');
const NOV = path('public/novedades.json');
const NIVELES = ['patch', 'minor', 'major'];

export const SEMVER = /^\d+\.\d+\.\d+$/;
export const pendiente = (v) => /^next(:(minor|major))?$/.test(v);
export const nivelDe = (v) => (v === 'next' ? 'patch' : v.split(':')[1]);
export function subir(ver, nivel) {
  const [a, b, c] = ver.split('.').map(Number);
  if (nivel === 'major') return `${a + 1}.0.0`;
  if (nivel === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

const leerVersion = (sw) => /const VERSION = '([^']+)'/.exec(sw)?.[1];
const versionesHtml = (html) => [...html.matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);

// Lo que tiene que valer siempre. Devuelve la lista de problemas.
export function revisar({ sw, html, novedades }) {
  const out = [];
  const v = leerVersion(sw);
  if (!v || !SEMVER.test(v)) out.push(`sw.js: VERSION no es semver (${v})`);
  const vs = versionesHtml(html);
  if (!vs.length || vs.some((x) => x !== v)) out.push(`index.html: los ?v= (${[...new Set(vs)].join(', ')}) no son la VERSION ${v}`);
  if (!Array.isArray(novedades)) return [...out, 'novedades.json no es una lista'];
  for (const [i, n] of novedades.entries()) {
    if (!(SEMVER.test(n?.version) || pendiente(n?.version))) out.push(`novedades.json[${i}]: versión «${n?.version}» no vale`);
    if (!Array.isArray(n?.notas) || !n.notas.length || n.notas.some((t) => typeof t !== 'string' || !t.trim())) out.push(`novedades.json[${i}]: faltan las notas`);
    if (pendiente(n?.version) && novedades.slice(0, i).some((x) => !pendiente(x.version))) out.push(`novedades.json[${i}]: una pendiente va arriba de las numeradas`);
  }
  const numerada = novedades.find((n) => SEMVER.test(n.version));
  if (numerada && numerada.version !== v) out.push(`novedades.json: la última versión numerada (${numerada.version}) no es la VERSION ${v}`);
  return out;
}

// ¿El commit sube la VERSION? (sw.js de HEAD contra el que está en el índice)
export function releaseStaged(swHead, swStaged) {
  const a = leerVersion(swHead), b = leerVersion(swStaged);
  return !!(a && b && a !== b);
}

function leer() {
  return { sw: readFileSync(SW, 'utf8'), html: readFileSync(HTML, 'utf8'), novedades: JSON.parse(readFileSync(NOV, 'utf8')) };
}

function release(nivelPedido) {
  const { sw, html, novedades } = leer();
  const pend = novedades.filter((n) => pendiente(n.version));
  if (!pend.length) { console.error('No hay novedades pendientes ("next") para publicar.'); process.exit(1); }
  const nivel = nivelPedido || pend.map((n) => nivelDe(n.version)).sort((a, b) => NIVELES.indexOf(b) - NIVELES.indexOf(a))[0];
  const nueva = subir(leerVersion(sw), nivel);
  const ahora = new Date().toISOString();
  const entrada = { version: nueva, fecha: ahora.slice(0, 10), notas: pend.flatMap((n) => n.notas) };
  writeFileSync(NOV, `${JSON.stringify([entrada, ...novedades.filter((n) => !pendiente(n.version))], null, 2)}\n`);
  writeFileSync(SW, sw.replace(/const VERSION = '[^']+'/, `const VERSION = '${nueva}'`).replace(/const RELEASED = '[^']*'/, `const RELEASED = '${ahora}'`));
  writeFileSync(HTML, html.replace(/\?v=[0-9.]+/g, `?v=${nueva}`));
  console.log(`VERSION ${leerVersion(sw)} → ${nueva} (${nivel})`);
}

function staged() {
  const files = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const toca = files.some((f) => f.startsWith('public/') && f !== 'public/novedades.json');
  if (!toca) return;
  // El commit del release (npm run bump) cambia la VERSION de sw.js: pasa.
  const git = (ref) => { try { return execSync(`git show ${ref}:public/sw.js`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
  if (releaseStaged(git('HEAD'), git(''))) return;
  const { novedades } = leer();
  if (pendiente(novedades[0]?.version) && novedades[0].notas?.length) return;
  console.error(`[pre-commit] Este commit cambia public/ y falta su novedad. Agregá arriba de public/novedades.json:
  { "version": "next", "fecha": "", "notas": ["Qué cambia para quien usa la app"] }
("next" sube patch; "next:minor" o "next:major" suben eso, al hacer el release).`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const p = revisar(leer());
    if (p.length) { console.error(p.join('\n')); process.exit(1); }
    console.log('ok');
  } else if (arg === '--staged') staged();
  else if (!arg || NIVELES.includes(arg)) release(arg);
  else { console.error(`Uso: bump-ui-version.mjs [${NIVELES.join('|')}] | --check | --staged`); process.exit(1); }
}
