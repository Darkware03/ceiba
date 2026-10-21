import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buscarInfraccionesDeEstandar,
  raizDeWeb,
  tokensDeMarca,
  type Regla,
} from '../scripts/check-estandar-visual';

/**
 * EL ESTÁNDAR VISUAL, COMPROBADO (BRIEF-FASE4 §2.3).
 *
 * El cliente pidió «que todas las vistas sean bajo el estándar que definiste».
 * Afirmarlo no vale: esta prueba recorre el árbol real de `apps/web/src` y se
 * pone roja en cuanto alguien escribe un `#rrggbb`, inventa un token, se saca
 * un spinner de la manga o pinta una espera sin el logo girando.
 *
 * Es la misma implementación que ejecuta `pnpm run check:estandar-visual`, a
 * propósito: una sola regla, imposible que la prueba y el CLI divergan.
 */
describe('estándar visual de CEIBA (BRIEF-FASE4 §2)', () => {
  it('ninguna vista infringe el estándar', () => {
    const hallazgos = buscarInfraccionesDeEstandar(raizDeWeb());

    // Mensaje útil cuando falle: fichero, línea, regla y motivo.
    const detalle = hallazgos
      .map((h) => `${h.fichero}:${h.linea} [${h.regla}] ${h.motivo}\n    ${h.texto}`)
      .join('\n');

    expect(detalle).toBe('');
    expect(hallazgos).toHaveLength(0);
  });

  it('los tokens se leen del paquete de marca, que es la fuente única', () => {
    const tokens = tokensDeMarca(raizDeWeb());

    // Una muestra de cada familia del §2.2: color, espacio, radio, tipografía.
    expect(tokens.has('--ceiba-bg')).toBe(true);
    expect(tokens.has('--ceiba-accent')).toBe(true);
    expect(tokens.has('--ceiba-space-4')).toBe(true);
    expect(tokens.has('--ceiba-radius-md')).toBe(true);
    expect(tokens.has('--ceiba-text-sm')).toBe(true);
    expect(tokens.has('--ceiba-font-mono')).toBe(true);
    // Y uno que no existe, para que la comprobación anterior signifique algo.
    expect(tokens.has('--espacio-4')).toBe(false);
  });

  /**
   * Un escáner que no detecta nada nunca dejaría la prueba de arriba en verde
   * para siempre sin aportar ninguna garantía. Aquí se le da un árbol
   * temporal con una infracción de cada regla y se comprueba que las ve.
   */
  it('el comprobador detecta de verdad cada infracción', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ceiba-estandar-'));
    mkdirSync(join(raiz, 'src', 'views'), { recursive: true });

    writeFileSync(
      join(raiz, 'src', 'views', 'VistaMala.vue'),
      [
        '<template>',
        '  <div class="mala">',
        '    <button type="button">Guardar</button>',
        '    <p>Cargando…</p>',
        '  </div>',
        '</template>',
        '',
        '<style scoped>',
        '.mala {',
        '  color: #ff0000;',
        '  background: rgb(10 10 10 / 50%);',
        '  border-color: red;',
        '  gap: var(--espacio-3);',
        '  animation: girar-rueda 1s linear infinite;',
        '}',
        '.mi-spinner { width: 16px; }',
        '@keyframes girar-rueda { from { opacity: 0; } }',
        '</style>',
        '',
      ].join('\n'),
      'utf8',
    );

    // Árbol temporal: los tokens reales se inyectan desde el paquete de marca,
    // porque el fixture no cuelga del repositorio.
    const hallazgos = buscarInfraccionesDeEstandar(raiz, tokensDeMarca(raizDeWeb()));
    const reglas = new Set<Regla>(hallazgos.map((h) => h.regla));

    expect(reglas.has('color-literal')).toBe(true);
    expect(reglas.has('color-nombrado')).toBe(true);
    expect(reglas.has('token-fantasma')).toBe(true);
    expect(reglas.has('spinner-ajeno')).toBe(true);
    expect(reglas.has('espera-sin-marca')).toBe(true);
    expect(reglas.has('boton-crudo')).toBe(true);

    // Y que señala dónde: fichero y línea, no un «algo falla».
    const literal = hallazgos.find((h) => h.regla === 'color-literal');
    expect(literal?.fichero).toBe('src/views/VistaMala.vue');
    expect(literal?.linea).toBeGreaterThan(0);
  });

  /**
   * Las dos exenciones del comprobador existen por un motivo concreto y hay
   * que dejarlas ancladas: si alguien las amplía sin querer, esto lo avisa.
   */
  it('no marca lo que legítimamente no es una infracción', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ceiba-estandar-ok-'));
    mkdirSync(join(raiz, 'src', 'views'), { recursive: true });

    writeFileSync(
      join(raiz, 'src', 'views', 'VistaBuena.vue'),
      [
        '<template>',
        '  <div class="buena">',
        // Una pestaña NO es un botón: `CeibaBoton` no la representa.
        '    <button type="button" role="tab" :aria-selected="true">Cabeceras</button>',
        // Una espera CON la marca girando al lado sí vale.
        '    <CeibaSpinner size="md" />',
        '    <p>Cargando…</p>',
        // Un texto largo que empieza por gerundio no es un indicador de espera.
        '    <p>Ejecutando desde el navegador sólo se leen las cabeceras permitidas por CORS.</p>',
        '  </div>',
        '</template>',
        '',
        '<style scoped>',
        '.buena {',
        '  gap: var(--ceiba-space-3);',
        '  color: var(--ceiba-text-muted);',
        '  --alto-propio: 12rem;',
        '  height: var(--alto-propio);',
        '}',
        '</style>',
        '',
      ].join('\n'),
      'utf8',
    );

    const hallazgos = buscarInfraccionesDeEstandar(raiz, tokensDeMarca(raizDeWeb()));
    const detalle = hallazgos
      .map((h) => `${h.fichero}:${h.linea} [${h.regla}] ${h.motivo}`)
      .join('\n');

    expect(detalle).toBe('');
  });
});
