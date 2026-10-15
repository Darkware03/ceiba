import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import {
  CEIBA_SEED_PATH,
  CEIBA_SPIN_TRANSFORM,
  CEIBA_TREE_PATH,
  CEIBA_VIEWBOX,
  // `mark-path.js` (no `.ts`) para que este fichero de configuración no
  // dependa de la transpilación de TypeScript del paquete de marca.
} from '../../packages/brand/src/mark-path.js';

const aqui = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url));

const RAIZ_REPO = aqui('../..');
const MARCA_SRC = aqui('../../packages/brand/src');

/**
 * Inyecta el logo giratorio en `index.html` **antes** de que exista Vue.
 *
 * Por qué un complemento y no un `<img src="ceiba-spinner.svg">`: un SVG
 * cargado como imagen queda aislado del CSS de la página, así que no puede
 * heredar `currentColor` ni `var(--ceiba-accent)` y se vería con el blanco
 * cálido quemado sobre el tema claro. Inyectando el SVG *en línea*, las clases
 * `.ceiba-spinner__tree` y `.ceiba-spinner__seed` de `loader.css` sí aplican y
 * el arranque sigue al tema.
 *
 * Por qué no copiar los trazados dentro del HTML: `docs/BRAND.md §2` dice que
 * los derivados de la marca se regeneran y «no se editan a mano». Aquí se leen
 * de `packages/brand/src/mark-path.js`, que es la salida oficial de
 * `scripts/build-brand.mjs`. Si la marca se vuelve a trazar, esto sigue siendo
 * correcto sin tocar `apps/web`.
 */
function ceibaSpinnerDeArranque(): Plugin {
  const svg =
    `<svg class="ceiba-spinner ceiba-spinner--xl" viewBox="${CEIBA_VIEWBOX}" ` +
    `aria-hidden="true" focusable="false">` +
    `<g transform="${CEIBA_SPIN_TRANSFORM}">` +
    `<path class="ceiba-spinner__tree" fill-rule="evenodd" d="${CEIBA_TREE_PATH}"/>` +
    `<path class="ceiba-spinner__seed" d="${CEIBA_SEED_PATH}"/>` +
    `</g></svg>`;

  return {
    name: 'ceiba-spinner-de-arranque',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('<!--CEIBA_SPINNER-->')) {
          // Fallo ruidoso: si alguien quita el hueco, el arranque se quedaría
          // sin logo girando y eso es un requisito explícito del cliente.
          throw new Error(
            'index.html no contiene el hueco <!--CEIBA_SPINNER-->: la pantalla de arranque ' +
              'se quedaría sin el logo girando (docs/BRAND.md §4).',
          );
        }
        return html.replace('<!--CEIBA_SPINNER-->', svg);
      },
    },
  };
}

export default defineConfig({
  plugins: [vue(), ceibaSpinnerDeArranque()],

  resolve: {
    // `@ceiba/brand` se consume por ruta porque `apps/web` se instala con
    // `--ignore-workspace` (regla dura de la fase: no tocar el lockfile de la
    // raíz), así que pnpm no enlaza el paquete del workspace.
    alias: [
      { find: /^@ceiba\/brand$/, replacement: `${MARCA_SRC}/index.ts` },
      { find: /^@ceiba\/brand\/(.*)$/, replacement: `${MARCA_SRC}/$1` },
      { find: /^@\/(.*)$/, replacement: `${aqui('./src')}/$1` },
    ],
    // Las SFC de `packages/brand` importan `vue` y, al estar fuera de
    // `apps/web`, la resolución de Node no llegaría a `apps/web/node_modules`.
    // `dedupe` fuerza una sola copia resuelta desde la raíz del proyecto.
    dedupe: ['vue'],
  },

  server: {
    fs: {
      // Necesario para servir `packages/brand` en desarrollo.
      allow: [RAIZ_REPO],
    },
    proxy: {
      // En desarrollo la SPA y la API deben compartir ORIGEN: el ADR-0009 §6.3
      // lo exige («origen único»), y sin él la cookie `__Host-` no viaja y el
      // guard CSRF rechaza por `Origin` no permitido.
      '/api': {
        target: process.env.CEIBA_API_ORIGIN ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
