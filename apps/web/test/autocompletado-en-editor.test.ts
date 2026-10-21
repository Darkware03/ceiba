import { describe, expect, it } from 'vitest';
import {
  detectarDisparoDeVariable,
  filtrarVariables,
} from '@/composables/usarSugerenciasEnEditor';
import type { VariableDeColeccion } from '@/composables/usarVariablesDeColeccion';

/**
 * P6 dentro del **editor de código** (cuerpo crudo).
 *
 * Aquí se prueban las dos funciones puras que gobiernan el comportamiento:
 * cuándo se dispara la lista y qué entra en ella. El montaje real de
 * CodeMirror **no** se prueba y hay que decir por qué: `jsdom` no implementa
 * `getBoundingClientRect` con medidas reales ni el modelo de cajas, así que
 * `coordsAtPos` devuelve ceros y una prueba de posicionamiento afirmaría algo
 * que no se ha medido. Lo que sí se puede afirmar es la lógica, y es la que
 * decide si la experiencia es correcta.
 *
 * LAS REGLAS DE DISPARO SON LAS MISMAS que las de `CampoConVariables`, y esa
 * es justamente la propiedad que se vigila: si divergieran, la URL y el
 * cuerpo responderían distinto a la misma pulsación.
 */

function variable(key: string, extra: Partial<VariableDeColeccion> = {}): VariableDeColeccion {
  return {
    key,
    scope: 'collection',
    environmentId: 'env-1',
    environmentName: 'Producción',
    isSecret: false,
    isEnabled: true,
    valueKind: 'string',
    preview: `valor de ${key}`,
    shadowed: false,
    ...extra,
  };
}

const APERTURA = '{' + '{';
const CIERRE = '}' + '}';

describe('P6 en el editor · cuándo se abre la lista', () => {
  it('se abre justo tras las dos llaves de apertura', () => {
    const texto = `${APERTURA}`;
    expect(detectarDisparoDeVariable(texto, texto.length)).toEqual({ inicio: 0, consulta: '' });
  });

  it('lo tecleado después filtra', () => {
    const texto = `{"url": "${APERTURA}base`;
    const disparo = detectarDisparoDeVariable(texto, texto.length);
    expect(disparo?.consulta).toBe('base');
    expect(texto.slice(disparo?.inicio ?? 0)).toBe(`${APERTURA}base`);
  });

  it('una variable ya cerrada no deja la lista abierta para siempre', () => {
    const texto = `${APERTURA}base_url${CIERRE}/v1/clientes`;
    expect(detectarDisparoDeVariable(texto, texto.length)).toBeNull();
  });

  it('un espacio después de las llaves cancela el disparo', () => {
    const texto = `${APERTURA}base url`;
    expect(detectarDisparoDeVariable(texto, texto.length)).toBeNull();
  });

  it('sin llaves no hay nada que sugerir', () => {
    expect(detectarDisparoDeVariable('https://api.ejemplo.com', 10)).toBeNull();
  });

  it('se usa la ÚLTIMA apertura, no la primera', () => {
    const texto = `${APERTURA}a${CIERRE}-${APERTURA}b`;
    const disparo = detectarDisparoDeVariable(texto, texto.length);
    expect(disparo?.consulta).toBe('b');
    expect(disparo?.inicio).toBe(texto.lastIndexOf(APERTURA));
  });

  it('sólo cuenta lo que hay ANTES del cursor', () => {
    const texto = `${APERTURA}base_url${CIERRE}`;
    // Cursor justo tras la apertura: la lista debe abrirse aunque más
    // adelante, en el mismo documento, ya haya un cierre.
    const disparo = detectarDisparoDeVariable(texto, APERTURA.length);
    expect(disparo).toEqual({ inicio: 0, consulta: '' });
  });

  it('un cursor imposible no rompe nada', () => {
    expect(detectarDisparoDeVariable('', -5)).toBeNull();
  });
});

describe('P6 en el editor · qué entra en la lista', () => {
  const todas = [variable('base_url'), variable('BASE_TOKEN'), variable('sesión'), variable('otro')];

  it('sin consulta se ofrecen todas', () => {
    expect(filtrarVariables(todas, '')).toHaveLength(4);
  });

  it('filtra por subcadena, sin distinguir mayúsculas', () => {
    expect(filtrarVariables(todas, 'base').map((v) => v.key)).toEqual(['base_url', 'BASE_TOKEN']);
    expect(filtrarVariables(todas, 'URL').map((v) => v.key)).toEqual(['base_url']);
  });

  it('ignora los acentos: quien escribe la consulta es una persona', () => {
    expect(filtrarVariables(todas, 'sesion').map((v) => v.key)).toEqual(['sesión']);
  });

  it('sin coincidencias devuelve una lista vacía, no todas', () => {
    expect(filtrarVariables(todas, 'nada-de-esto')).toHaveLength(0);
  });

  it('una variable secreta se puede sugerir, pero llega sin valor', () => {
    const secretas = [variable('api_key', { isSecret: true, preview: null })];
    const resultado = filtrarVariables(secretas, 'api');
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.isSecret).toBe(true);
    expect(resultado[0]?.preview).toBeNull();
  });
});
