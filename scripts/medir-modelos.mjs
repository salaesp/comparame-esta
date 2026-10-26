#!/usr/bin/env node
// Mide cómo lee cada modelo un ticket: el mismo pedido que la app (lib/lector.mjs) con
// las fotos de una carpeta, contra la verdad pasada a mano. Dice, por modelo y esfuerzo,
// cuánto tardó, cuánto costó, cuántos productos leyó, cuántos importes y cantidades
// coinciden con la verdad y si la suma da el total. Cada corrida GASTA tokens de verdad.
//
//   node scripts/medir-modelos.mjs <carpeta> [--modelos opus,sonnet,haiku] [--esfuerzos low,medium] [--veces 1]
//
// La carpeta tiene las fotos en orden (1.jpg, 2.jpg… se ordenan por nombre) y un
// verdad.json: { "pagado": 208263.5, "productos": [["texto", cantidad, importe, descuento], …] }
// (test/fixtures/carrefour-3-fotos.json sirve de ejemplo de la forma de la respuesta).
// La key sale de ANTHROPIC_API_KEY o ANTHROPIC_API_TOKEN. Las fotos se achican como en
// el teléfono (lado mayor 1600 px, JPEG 0,8) con sharp (devDependency).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { leerTicket, costoUsd, MODELOS } from '../lib/lector.mjs';
import { controlTotal, pagadoDe } from '../lib/ticket.mjs';
import { normTexto } from '../lib/productos.mjs';

const args = process.argv.slice(2);
const carpeta = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
if (!carpeta) { console.error('Uso: medir-modelos.mjs <carpeta> [--modelos opus,sonnet,haiku] [--esfuerzos low,medium] [--veces 1]'); process.exit(1); }
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_TOKEN;
if (!apiKey) { console.error('Falta ANTHROPIC_API_KEY (o ANTHROPIC_API_TOKEN).'); process.exit(1); }

const ALIAS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
const modelos = opt('modelos', 'opus,sonnet,haiku').split(',').map((m) => ALIAS[m] || m).filter((m) => MODELOS[m]);
const esfuerzos = opt('esfuerzos', 'medium').split(',');
const veces = Number(opt('veces', '1')) || 1;

const MIME = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' };
async function achicar(buf) {
  try {
    const sharp = (await import('sharp')).default;
    return { mime: 'jpeg', buf: await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer() };
  } catch { return null; }
}
const archivos = readdirSync(carpeta).filter((f) => MIME[extname(f).toLowerCase()]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!archivos.length) { console.error('No hay fotos en la carpeta.'); process.exit(1); }
const fotos = [];
for (const f of archivos) {
  const raw = readFileSync(join(carpeta, f));
  const chica = await achicar(raw);
  const mime = chica?.mime || MIME[extname(f).toLowerCase()];
  fotos.push(`data:image/${mime};base64,${(chica?.buf || raw).toString('base64')}`);
}
let verdad = null;
try {
  verdad = JSON.parse(readFileSync(join(carpeta, 'verdad.json'), 'utf8'));
  // También vale con la forma de test/fixtures/carrefour-3-fotos.json (la respuesta esperada).
  if (verdad.respuesta) verdad = { pagado: verdad.pagado, productos: verdad.respuesta.renglones.map((r) => [r.texto, r.cantidad, r.importe, r.descuento]) };
} catch { console.warn('Sin verdad.json: sólo tiempo, costo y la suma.'); }

// Cuántos renglones de la verdad tienen uno leído con el mismo importe (y la misma
// cantidad), sin usar dos veces el mismo renglón leído.
function comparar(leidos, productos) {
  const libres = leidos.map((r) => ({ ...r, usado: false }));
  let importes = 0, cantidades = 0;
  for (const [texto, cant, imp, desc = 0] of productos) {
    const cands = libres.filter((r) => !r.usado && Math.abs(r.importe - imp) <= 0.05);
    const r = cands.find((x) => normTexto(x.texto).slice(0, 12) === normTexto(texto).slice(0, 12)) || cands[0];
    if (!r) continue;
    r.usado = true;
    importes++;
    if (Math.abs(r.cantidad - cant) <= 0.001 && Math.abs((r.descuento || 0) - desc) <= 0.05) cantidades++;
  }
  return { importes, cantidades, de: productos.length };
}

// MEDIR_BASE_URL: otra URL (para probar el script contra un servidor falso).
const client = new Anthropic({ apiKey, baseURL: process.env.MEDIR_BASE_URL || 'https://api.anthropic.com', maxRetries: 1, timeout: 180_000 });
const hoy = new Date().toISOString().slice(0, 10);
const filas = [];
for (const modelo of modelos) {
  for (const esfuerzo of esfuerzos) {
    for (let i = 0; i < veces; i++) {
      process.stdout.write(`${modelo} · ${esfuerzo} · corrida ${i + 1}… `);
      try {
        const r = await leerTicket(client, fotos, { modelo, esfuerzo, hoy });
        const l = r.lectura;
        const c = controlTotal(l);
        const v = verdad ? comparar(l.renglones, verdad.productos) : null;
        const pagado = Math.round(l.renglones.reduce((s, x) => s + pagadoDe(x), 0) * 100) / 100;
        const fila = {
          modelo, esfuerzo, ms: r.ms, usd: costoUsd(modelo, r.usage), in: r.usage.input_tokens, out: r.usage.output_tokens,
          renglones: l.renglones.length, control: c.estado, pagado,
          ...(v ? { importes: `${v.importes}/${v.de}`, cantidades: `${v.cantidades}/${v.de}`, da_lo_pagado: Math.abs(pagado - verdad.pagado) <= 1 } : {}),
        };
        filas.push(fila);
        console.log(`${(r.ms / 1000).toFixed(1)} s · US$ ${fila.usd.toFixed(4)} · ${fila.renglones} productos${v ? ` · importes ${fila.importes} · cantidades ${fila.cantidades}` : ''} · ${c.estado}`);
        writeFileSync(join(carpeta, `lectura-${modelo}-${esfuerzo}-${i + 1}.json`), JSON.stringify(l, null, 2));
      } catch (e) {
        filas.push({ modelo, esfuerzo, error: e.message });
        console.log(`falló: ${e.message}`);
      }
    }
  }
}
console.log('\n' + ['modelo', 'esfuerzo', 'segundos', 'US$', 'productos', 'importes', 'cantidades', 'da lo pagado', 'control'].join(' | '));
for (const f of filas) {
  console.log(f.error ? `${f.modelo} | ${f.esfuerzo} | falló: ${f.error}`
    : [f.modelo, f.esfuerzo, (f.ms / 1000).toFixed(1), f.usd.toFixed(4), f.renglones, f.importes ?? '—', f.cantidades ?? '—', f.da_lo_pagado ?? '—', f.control].join(' | '));
}
