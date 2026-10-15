/**
 * Backoff exponencial de inicio de sesión (ADR-0009 §8).
 *
 * «**Backoff exponencial, no bloqueo binario**, por la misma razón que
 * C-CODE-03: un bloqueo duro permite que un tercero deje fuera a un usuario
 * legítimo.»
 *
 * Diseño:
 *  - Los primeros `FALLOS_SIN_PENALIZACION` intentos no cuestan nada: un error
 *    de tecleo no debe penalizar.
 *  - A partir de ahí el retardo **dobla** en cada fallo, con techo. El techo
 *    existe para que la cuenta no quede inutilizable: el atacante paga un coste
 *    creciente, el legítimo espera como mucho `TECHO_MS`.
 *  - Un inicio de sesión correcto reinicia el contador a cero.
 */

export const FALLOS_SIN_PENALIZACION = 3;
export const BASE_MS = 2_000;
export const TECHO_MS = 900_000; // 15 min

export function calcularBackoffMs(fallosConsecutivos: number): number {
  if (!Number.isFinite(fallosConsecutivos) || fallosConsecutivos <= FALLOS_SIN_PENALIZACION) {
    return 0;
  }
  const exponente = Math.min(fallosConsecutivos - FALLOS_SIN_PENALIZACION - 1, 40);
  const retardo = BASE_MS * 2 ** exponente;
  return Math.min(retardo, TECHO_MS);
}

/** Instante hasta el que la cuenta queda en espera, o `null` si no hay penalización. */
export function calcularBloqueoHasta(fallosConsecutivos: number, ahora: Date): Date | null {
  const retardo = calcularBackoffMs(fallosConsecutivos);
  if (retardo === 0) return null;
  return new Date(ahora.getTime() + retardo);
}
