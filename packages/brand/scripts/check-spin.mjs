#!/usr/bin/env node
/**
 * Comprobacion geometrica del logo giratorio.
 *
 * Un SVG recorta su contenido al viewBox. Si la marca ocupa todo el cuadro,
 * al rotarla las esquinas se salen y el spinner aparece mutilado. Esta prueba
 * calcula el radio circunscrito real de la marca y verifica que, con el factor
 * de escala del spinner, ningun punto escapa del circulo inscrito en el viewBox
 * para ningun angulo.
 *
 * Uso: node scripts/check-spin.mjs [escala]
 * Salida: codigo 0 si pasa, 1 si falla.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const svg = readFileSync(resolve(root, 'assets/ceiba-mark.svg'), 'utf8');
const SIZE = 256;
const C = SIZE / 2;

const points = [];
for (const m of svg.matchAll(/\sd="([^"]+)"/g)) {
  const nums = m[1].match(/-?\d+(?:\.\d+)?/g) ?? [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push([Number(nums[i]), Number(nums[i + 1])]);
  }
}
if (points.length < 100) {
  console.error(`FALLO: solo se extrajeron ${points.length} puntos del trazado`);
  process.exit(1);
}

let maxR = 0;
let far = null;
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const [x, y] of points) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  const r = Math.hypot(x - C, y - C);
  if (r > maxR) { maxR = r; far = [x, y]; }
}

const scaleArg = Number(process.argv[2]);
// radio util: el circulo inscrito en el viewBox
const SAFE = C;
const recommended = Math.floor((SAFE / maxR) * 1000) / 1000;
const scale = Number.isFinite(scaleArg) && scaleArg > 0 ? scaleArg : recommended;

console.log(`puntos del trazado     : ${points.length}`);
console.log(`bbox en el viewBox     : ${minX.toFixed(1)},${minY.toFixed(1)} -> ${maxX.toFixed(1)},${maxY.toFixed(1)}`);
console.log(`centro de rotacion     : ${C},${C}`);
console.log(`radio circunscrito     : ${maxR.toFixed(2)} (punto mas lejano ${far[0].toFixed(1)},${far[1].toFixed(1)})`);
console.log(`radio seguro (inscrito): ${SAFE.toFixed(2)}`);
console.log(`escala recomendada     : ${recommended}`);
console.log(`escala evaluada        : ${scale}`);

// barrido de angulos: ningun punto puede salir del viewBox
let worst = 0;
let worstAngle = 0;
for (let deg = 0; deg < 360; deg += 1) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  for (const [x, y] of points) {
    const dx = (x - C) * scale, dy = (y - C) * scale;
    const rx = C + dx * cos - dy * sin;
    const ry = C + dx * sin + dy * cos;
    const out = Math.max(-rx, rx - SIZE, -ry, ry - SIZE);
    if (out > worst) { worst = out; worstAngle = deg; }
  }
}

const sinEscala = maxR - SAFE;
console.log(`desbordamiento sin escalar : ${sinEscala.toFixed(2)} px`);
console.log(`desbordamiento con escala  : ${worst.toFixed(4)} px (peor angulo ${worstAngle}deg)`);

if (worst > 0.01) {
  console.error(`\nFALLO: la marca se recorta al girar (${worst.toFixed(2)} px fuera del viewBox).`);
  console.error(`Aplica scale(${recommended}) alrededor de ${C},${C} en el spinner.`);
  process.exit(1);
}
console.log('\nOK: la marca cabe en el viewBox en los 360 grados; el giro no recorta.');
