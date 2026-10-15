import type { Reloj } from '../time/clock.ts';

/**
 * `RateLimitStore` — la **misma** interfaz que C-CODE-03, por mandato explícito
 * del ADR-0009 («detrás de la misma interfaz `RateLimitStore` de C-CODE-03
 * —memoria en desarrollo, Redis en producción— para no tener dos contadores
 * distintos en el producto»).
 *
 * En esta ronda sólo existe la implementación en memoria. La de Redis es de la
 * fase de infraestructura; **no está escrita y no se simula**.
 */
export interface ConteoDeLimite {
  readonly contador: number;
  /** Milisegundos que faltan para que la ventana expire. */
  readonly restanteMs: number;
}

export interface RateLimitStore {
  incrementar(clave: string, ventanaMs: number): Promise<ConteoDeLimite>;
  leer(clave: string): Promise<ConteoDeLimite | null>;
  reiniciar(clave: string): Promise<void>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

interface Entrada {
  contador: number;
  expiraEnMs: number;
}

/** Implementación en memoria. Válida para un solo proceso; no para producción. */
export class RateLimitStoreEnMemoria implements RateLimitStore {
  readonly #entradas = new Map<string, Entrada>();

  constructor(private readonly reloj: Reloj) {}

  async incrementar(clave: string, ventanaMs: number): Promise<ConteoDeLimite> {
    const ahora = this.reloj.ahora().getTime();
    const actual = this.#entradas.get(clave);
    if (actual === undefined || actual.expiraEnMs <= ahora) {
      const nueva: Entrada = { contador: 1, expiraEnMs: ahora + ventanaMs };
      this.#entradas.set(clave, nueva);
      return { contador: 1, restanteMs: ventanaMs };
    }
    actual.contador += 1;
    return { contador: actual.contador, restanteMs: actual.expiraEnMs - ahora };
  }

  async leer(clave: string): Promise<ConteoDeLimite | null> {
    const ahora = this.reloj.ahora().getTime();
    const actual = this.#entradas.get(clave);
    if (actual === undefined || actual.expiraEnMs <= ahora) return null;
    return { contador: actual.contador, restanteMs: actual.expiraEnMs - ahora };
  }

  async reiniciar(clave: string): Promise<void> {
    this.#entradas.delete(clave);
  }
}
