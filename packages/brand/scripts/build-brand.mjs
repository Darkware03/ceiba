#!/usr/bin/env node
/**
 * Deriva todos los artefactos de marca desde la unica fuente de verdad
 * `assets/ceiba-mark.svg` (trazada desde el PNG original del logo).
 *
 * Salidas:
 *   assets/ceiba-mark-mono.svg   marca monocroma (semilla del mismo color)
 *   assets/favicon.svg           icono con fondo carbon y esquinas redondeadas
 *   assets/apple-touch-icon.svg  variante solida 180x180
 *   src/mark-path.ts             datos de trazado para componentes Vue
 *   src/mark-path.js             mismo modulo en ESM plano (demo sin bundler)
 *   assets/ceiba-spinner.svg     marca pre-escalada para girar sin recortarse
 *
 * Uso: node scripts/build-brand.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const COLORS = {
  carbon: '#0E100F',
  bone: '#F3F1E7',
  sage: '#9DBE8C',
};

const svg = readFileSync(resolve(root, 'assets/ceiba-mark.svg'), 'utf8');

const grab = (cls) => {
  const re = new RegExp(`<path[^>]*class="${cls}"[^>]*\\sd="([^"]+)"`);
  const m = svg.match(re);
  if (!m) throw new Error(`no se encontro el trazado .${cls} en ceiba-mark.svg`);
  return m[1];
};

const tree = grab('ceiba-mark__tree');
const seed = grab('ceiba-mark__seed');

const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
if (viewBox !== '0 0 256 256') {
  throw new Error(`viewBox inesperado: ${viewBox} (se esperaba "0 0 256 256")`);
}

const header = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"';

/* --- escala de giro ---------------------------------------------------
 * Un SVG recorta al viewBox. La marca ocupa el cuadro completo, asi que al
 * rotarla las esquinas se saldrian (medido: 19,8 px a 43 grados). Se calcula
 * el radio circunscrito real y se deriva la escala que mantiene la marca
 * dentro del circulo inscrito en cualquier angulo. No se fija a mano para que
 * siga siendo correcta si se vuelve a trazar el logo.
 */
const C = 128;
const pts = [];
for (const d of [tree, seed]) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
}
const maxR = Math.max(...pts.map(([x, y]) => Math.hypot(x - C, y - C)));
const SPIN_SCALE = Math.floor((C / maxR) * 1000) / 1000;
const spinOpen = `<g transform="translate(${C} ${C}) scale(${SPIN_SCALE}) translate(-${C} -${C})">`;

writeFileSync(
  resolve(root, 'assets/ceiba-mark-mono.svg'),
  `${header} role="img" aria-label="CEIBA">
  <path fill="currentColor" fill-rule="evenodd" d="${tree}"/>
  <path fill="currentColor" d="${seed}"/>
</svg>
`,
);

writeFileSync(
  resolve(root, 'assets/favicon.svg'),
  `${header} role="img" aria-label="CEIBA API Studio">
  <rect width="256" height="256" rx="56" fill="${COLORS.carbon}"/>
  <g transform="translate(128 128) scale(0.78) translate(-128 -128)">
    <path fill="${COLORS.bone}" fill-rule="evenodd" d="${tree}"/>
    <path fill="${COLORS.sage}" d="${seed}"/>
  </g>
</svg>
`,
);

writeFileSync(
  resolve(root, 'assets/apple-touch-icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="180" height="180" role="img" aria-label="CEIBA API Studio">
  <rect width="256" height="256" fill="${COLORS.carbon}"/>
  <g transform="translate(128 128) scale(0.72) translate(-128 -128)">
    <path fill="${COLORS.bone}" fill-rule="evenodd" d="${tree}"/>
    <path fill="${COLORS.sage}" d="${seed}"/>
  </g>
</svg>
`,
);

writeFileSync(
  resolve(root, 'assets/ceiba-spinner.svg'),
  `${header} role="img" aria-label="Cargando">
  ${spinOpen}
    <path fill="${COLORS.bone}" fill-rule="evenodd" d="${tree}"/>
    <path fill="${COLORS.sage}" d="${seed}"/>
  </g>
</svg>
`,
);

writeFileSync(
  resolve(root, 'src/mark-path.js'),
  `/* GENERADO POR scripts/build-brand.mjs - NO EDITAR A MANO.
 * Copia en ESM plano para la pagina de verificacion, que se sirve sin bundler.
 */
export const CEIBA_VIEWBOX = '0 0 256 256';
export const CEIBA_TREE_PATH =
  '${tree}';
export const CEIBA_SEED_PATH =
  '${seed}';
export const CEIBA_SPIN_SCALE = ${SPIN_SCALE};
export const CEIBA_SPIN_TRANSFORM =
  'translate(${C} ${C}) scale(${SPIN_SCALE}) translate(-${C} -${C})';
export const CEIBA_COLORS = ${JSON.stringify(COLORS, null, 2).replace(/\n/g, '\n  ')};
`,
);

writeFileSync(
  resolve(root, 'src/mark-path.ts'),
  `/* GENERADO POR scripts/build-brand.mjs - NO EDITAR A MANO.
 * Fuente: assets/ceiba-mark.svg, trazada desde el PNG original de marca.
 */
export const CEIBA_VIEWBOX = '0 0 256 256';

/** Silueta del arbol. Usa fill-rule="evenodd". */
export const CEIBA_TREE_PATH =
  '${tree}';

/** Disco (semilla/fruto) en verde salvia. */
export const CEIBA_SEED_PATH =
  '${seed}';

/** Escala que impide que la marca se recorte contra el viewBox al rotar.
 *  Calculada desde el radio circunscrito del trazado; la valida
 *  \`scripts/check-spin.mjs\` barriendo los 360 grados. */
export const CEIBA_SPIN_SCALE = ${SPIN_SCALE};

/** Transformacion lista para usar en el <g> del spinner. */
export const CEIBA_SPIN_TRANSFORM =
  'translate(${C} ${C}) scale(${SPIN_SCALE}) translate(-${C} -${C})';

export const CEIBA_COLORS = ${JSON.stringify(COLORS, null, 2).replace(/\n/g, '\n  ')} as const;
`,
);

const bytes = (p) => readFileSync(resolve(root, p)).length;
for (const f of [
  'assets/ceiba-mark.svg',
  'assets/ceiba-mark-mono.svg',
  'assets/favicon.svg',
  'assets/apple-touch-icon.svg',
  'assets/ceiba-spinner.svg',
  'src/mark-path.ts',
  'src/mark-path.js',
]) {
  console.log(`  ${String(bytes(f)).padStart(7)} B  ${f}`);
}
console.log(`radio circunscrito ${maxR.toFixed(2)} -> escala de giro ${SPIN_SCALE}`);
console.log('marca generada desde assets/ceiba-mark.svg');
