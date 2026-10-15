import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const aqui = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url));
const MARCA_SRC = aqui('../../packages/brand/src');

/**
 * Configuración de pruebas **separada** de `vite.config.ts` a propósito: el
 * complemento que inyecta el logo de arranque exige el hueco
 * `<!--CEIBA_SPINNER-->` en `index.html` y aborta si falta, cosa que no tiene
 * sentido en un entorno de pruebas sin HTML de entrada.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^@ceiba\/brand$/, replacement: `${MARCA_SRC}/index.ts` },
      { find: /^@ceiba\/brand\/(.*)$/, replacement: `${MARCA_SRC}/$1` },
      { find: /^@\/(.*)$/, replacement: `${aqui('./src')}/$1` },
    ],
    dedupe: ['vue'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    reporters: ['verbose'],
    css: false,
  },
});
