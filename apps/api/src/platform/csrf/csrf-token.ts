import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Testigo anti-CSRF de **doble envío firmado** (ADR-0009 §5, barrera 2).
 *
 * Forma: `<nonce>.<hmac>` en base64url, donde
 * `hmac = HMAC-SHA256(CEIBA_CSRF_SECRET, nonce)`.
 *
 * El mismo valor viaja en dos sitios:
 *   - cookie `__Host-ceiba_csrf`, **sin** `HttpOnly` (la SPA debe leerla),
 *   - cabecera `x-ceiba-csrf`.
 *
 * Un atacante entre sitios puede provocar que el navegador envíe la cookie,
 * pero no puede **leerla** (política de origen) y por tanto no puede poner la
 * cabecera. La firma añade que tampoco puede inyectar una cookie de su
 * invención desde un subdominio: el prefijo `__Host-` ya lo impide en el
 * navegador, y la firma lo impide también en el servidor.
 *
 * DESVIACIÓN DECLARADA respecto al ADR-0009 §5, que dice «Implementado con
 * `@fastify/csrf-protection`». Aquí se implementa como **guard de Nest** y no
 * como hook de Fastify, por una razón del propio ADR: el §7.3 y el ADR-0001 §6
 * exigen que los controles sean **enumerables** («un control que no se puede
 * enumerar no se puede auditar») y que sean **el mismo objeto** en REST,
 * WebSocket y colas. Un `onRequest` de Fastify queda fuera del recorrido del
 * `RouterExplorer` y fuera del contenedor de DI: la prueba que recorre las
 * rutas no lo vería. El mecanismo criptográfico es el mismo que el de la
 * librería (doble envío con HMAC); lo que cambia es el punto de aplicación.
 * Queda a decisión de `darkware`/`software-architect` si se revierte.
 */

export class TestigoCsrf {
  readonly #secreto: string;

  constructor(secreto: string) {
    if (secreto.length < 32) {
      throw new Error('el secreto CSRF debe tener al menos 32 caracteres');
    }
    this.#secreto = secreto;
  }

  /** Acuña un testigo nuevo. Se hace también SIN sesión (ADR-0009 §5). */
  acunar(): string {
    const nonce = randomBytes(32).toString('base64url');
    return `${nonce}.${this.#firmar(nonce)}`;
  }

  /** `true` sólo si el valor tiene la forma correcta y la firma es válida. */
  esValido(valor: string | undefined): boolean {
    if (typeof valor !== 'string') return false;
    const partes = valor.split('.');
    if (partes.length !== 2) return false;
    const [nonce, firma] = partes as [string, string];
    if (nonce.length === 0 || firma.length === 0) return false;
    return comparacionConstante(this.#firmar(nonce), firma);
  }

  #firmar(nonce: string): string {
    return createHmac('sha256', this.#secreto).update(nonce, 'utf8').digest('base64url');
  }
}

export const TESTIGO_CSRF = Symbol('TESTIGO_CSRF');

/** Comparación de cadenas en tiempo constante, tolerante a longitudes distintas. */
export function comparacionConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
