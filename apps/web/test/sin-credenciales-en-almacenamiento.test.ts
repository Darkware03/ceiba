import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLAVES_PERMITIDAS,
  buscarCredencialesPersistidas,
  raizDeWeb,
} from '../scripts/check-no-token-storage';

/**
 * Prohibición 1 del ADR-0009 §11, decisión **C-31**:
 *
 *   «Tokens de sesión en `localStorage` o `sessionStorage`. Es verificable:
 *    una prueba recorre `apps/web` y falla si aparece `localStorage.setItem`
 *    con algo marcado como credencial.»
 *
 * Aquí está esa prueba, ejecutándose sobre el árbol real de `apps/web`. No es
 * una declaración de intenciones: si alguien añade mañana un
 * `localStorage.setItem('token', …)`, esto se pone rojo.
 */
describe('C-31: ninguna credencial en almacenamiento persistente', () => {
  it('no hay escrituras en localStorage/sessionStorage fuera de la lista blanca', () => {
    const hallazgos = buscarCredencialesPersistidas(raizDeWeb());

    // Mensaje útil cuando falle: qué fichero, qué línea y por qué.
    const detalle = hallazgos
      .map((h) => `${h.fichero}:${h.linea} — ${h.motivo}\n    ${h.texto}`)
      .join('\n');

    expect(detalle).toBe('');
    expect(hallazgos).toHaveLength(0);
  });

  it('la lista blanca sólo contiene preferencias de interfaz, nada de credenciales', () => {
    expect(CLAVES_PERMITIDAS).toEqual(['ceiba.tema']);
  });

  it('el comprobador detecta de verdad una escritura prohibida', () => {
    // Si el escáner no detecta nada nunca, la prueba de arriba sería inútil.
    // Se le da un árbol temporal con una violación evidente.
    const temporal = mkdtempSync(join(tmpdir(), 'ceiba-escaner-'));
    writeFileSync(
      join(temporal, 'malo.ts'),
      "localStorage.setItem('ceiba.session', testigoDeSesion);\n",
      'utf8',
    );

    const hallazgos = buscarCredencialesPersistidas(temporal);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.motivo).toContain('ceiba.session');
  });
});
