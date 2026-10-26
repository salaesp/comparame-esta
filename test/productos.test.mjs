// lib/productos.mjs: las claves que reconocen un lugar y un producto, la medida, el
// precio por kg/litro/unidad y los candidatos para "¿Es el mismo?".
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normTexto, lugarKey, cuitValido, medidaDe, medidaLabel, nombreKey, precioMedida, candidatos, tidyNombre, eanValido,
} from '../lib/productos.mjs';

test('normTexto: sin acentos, mayúsculas ni signos, y el número separado de la unidad', () => {
  assert.equal(normTexto('UNIÓN  Yerba 1kg.'), 'union yerba 1 kg');
  assert.equal(normTexto('union yerba 1 KG'), 'union yerba 1 kg');
  assert.equal(normTexto('X500'), 'x 500');
});

test('lugarKey: con CUIT manda el CUIT; sin CUIT, la cadena; siempre con la dirección', () => {
  assert.equal(lugarKey({ cuit: '30-68731043-4', cadena: 'Carrefour', direccion: 'Av. Cabildo 2200' }), 'cuit 30687310434|av cabildo 2200');
  assert.equal(lugarKey({ cuit: '30687310434', cadena: 'INC SA', direccion: 'Av Cabildo 2200' }), 'cuit 30687310434|av cabildo 2200');
  assert.equal(lugarKey({ cadena: 'Coto', direccion: '' }), 'coto|');
  assert.equal(lugarKey({ cuit: '123', cadena: 'Día', direccion: 'Mitre 10' }), 'dia|mitre 10');
  assert.equal(cuitValido('30687310434'), '30-68731043-4');
  assert.equal(cuitValido('12'), '');
});

test('medidaDe pasa a g, ml o u; medidaLabel la vuelve a decir', () => {
  assert.deepEqual(medidaDe(1, 'kg'), { medida: 1000, unidad: 'g' });
  assert.deepEqual(medidaDe(1.5, 'l'), { medida: 1500, unidad: 'ml' });
  assert.deepEqual(medidaDe(500, 'g'), { medida: 500, unidad: 'g' });
  assert.deepEqual(medidaDe(4, 'u'), { medida: 4, unidad: 'u' });
  assert.equal(medidaDe(0, 'g'), null);
  assert.equal(medidaDe(3, 'docenas'), null);
  assert.equal(medidaLabel(1000, 'g'), '1 kg');
  assert.equal(medidaLabel(500, 'g'), '500 g');
  assert.equal(medidaLabel(1500, 'ml'), '1,5 L');
  assert.equal(medidaLabel(4, 'u'), '4 u');
  assert.equal(medidaLabel(null, ''), '');
});

test('precioMedida: por kg lo que va por peso o en gramos, por litro, por unidad del pack', () => {
  assert.equal(precioMedida({ precio_unit: 46435, unidad: 'kg' }), 46435);
  assert.equal(precioMedida({ precio_unit: 4999, unidad: 'u', medida: 500, medida_unidad: 'g' }), 9998);
  assert.equal(precioMedida({ precio_unit: 5890, unidad: 'u', medida: 1000, medida_unidad: 'ml' }), 5890);
  assert.equal(precioMedida({ precio_unit: 2957.5, unidad: 'u', medida: 4, medida_unidad: 'u' }), 739.38);
  assert.equal(precioMedida({ precio_unit: 100, unidad: 'u', medida: null, medida_unidad: '' }), null);
});

test('candidatos: palabras en común, con la misma medida si las dos la dicen', () => {
  const productos = [
    { id: 'a', marca: 'Playadito', nombre: 'Yerba mate', medida: 1000, medida_unidad: 'g' },
    { id: 'b', marca: 'Playadito', nombre: 'Yerba mate', medida: 500, medida_unidad: 'g' },
    { id: 'c', marca: 'Taragüí', nombre: 'Yerba mate', medida: 1000, medida_unidad: 'g' },
    { id: 'd', marca: 'Matarazzo', nombre: 'Fideos tirabuzón', medida: 500, medida_unidad: 'g' },
  ];
  const r = candidatos({ marca: 'Playadito', nombre: 'Yerba mate suave', medida: 1000, medida_unidad: 'g' }, productos);
  assert.deepEqual(r.map((c) => c.producto.id), ['a']);
  // Sin medida en el renglón, entran los dos tamaños.
  assert.deepEqual(candidatos({ marca: 'Playadito', nombre: 'Yerba mate' }, productos).map((c) => c.producto.id), ['a', 'b']);
  // Sin marca, la Taragüí también puede ser.
  assert.deepEqual(candidatos({ nombre: 'Yerba mate' }, productos).map((c) => c.producto.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(candidatos({ nombre: 'Leche entera' }, productos), []);
});

test('nombreKey, tidyNombre y eanValido', () => {
  assert.equal(nombreKey({ marca: 'Playadito', nombre: 'Yerba mate', medida: 1000, medida_unidad: 'g' }), 'playadito yerba mate 1 kg');
  assert.equal(tidyNombre('QUESO REGGIANITO HORMA'), 'Queso Reggianito Horma');
  assert.equal(tidyNombre('Yerba mate'), 'Yerba mate');
  assert.equal(eanValido('7790387000108'), '7790387000108');
  assert.equal(eanValido('7790387000107'), '');
  assert.equal(eanValido('abc'), '');
});
