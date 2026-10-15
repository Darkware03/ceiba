import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Patrón selector/verificador del ADR-0009 §2, impuesto por las columnas
 * `sessions.token_selector` y `sessions.token_verifier_hash` del esquema.
 *
 *  - selector:     128 bits. Mitad PÚBLICA. Se busca por índice único -> O(1).
 *  - verificador:  256 bits. Mitad SECRETA. Sólo se guarda su SHA-256.
 *  - cookie:       `<selector>.<verificador>`, base64url, opaco, sin PII.
 *
 * Por qué SHA-256 y no Argon2id: el verificador son 256 bits aleatorios, no hay
 * diccionario que atacar, y un KDF lento convertiría cada petición autenticada
 * en trabajo costoso. La contraseña, que sí es de baja entropía, va con
 * Argon2id (ver `password-hasher.ts`). Es la razón textual del ADR-0009 §2.
 */

export const BYTES_SELECTOR = 16; // 128 bits
export const BYTES_VERIFICADOR = 32; // 256 bits

export interface TestigoDeSesion {
  readonly selector: string;
  readonly verificador: string;
  /** Valor que viaja en la cookie. El verificador en claro NO se persiste. */
  readonly valorCookie: string;
  readonly hashVerificador: Buffer;
}

export function generarTestigoDeSesion(): TestigoDeSesion {
  const selector = randomBytes(BYTES_SELECTOR).toString('base64url');
  const verificador = randomBytes(BYTES_VERIFICADOR).toString('base64url');
  return {
    selector,
    verificador,
    valorCookie: `${selector}.${verificador}`,
    hashVerificador: hashearVerificador(verificador),
  };
}

export function hashearVerificador(verificador: string): Buffer {
  return createHash('sha256').update(verificador, 'utf8').digest();
}

export interface TestigoDescompuesto {
  readonly selector: string;
  readonly verificador: string;
}

/**
 * Descompone el valor de la cookie. Devuelve `null` ante cualquier forma que no
 * sea exactamente `selector.verificador` con ambas partes no vacías: una cookie
 * malformada es un 401 idéntico a los demás, nunca un error distinguible.
 */
export function descomponerTestigo(valorCookie: string | undefined): TestigoDescompuesto | null {
  if (typeof valorCookie !== 'string') return null;
  const partes = valorCookie.split('.');
  if (partes.length !== 2) return null;
  const [selector, verificador] = partes as [string, string];
  if (selector.length === 0 || verificador.length === 0) return null;
  return { selector, verificador };
}

/**
 * Comparación en tiempo constante del verificador contra el hash almacenado.
 *
 * `timingSafeEqual` lanza si las longitudes difieren, y esa excepción sería a su
 * vez un canal lateral: se comprueba la longitud primero y se devuelve `false`
 * sin lanzar. Ambos operandos son SHA-256 (32 bytes), así que una longitud
 * distinta sólo ocurre con datos corruptos en la fila.
 */
export function verificadorCoincide(verificador: string, hashAlmacenado: Uint8Array): boolean {
  const calculado = hashearVerificador(verificador);
  const almacenado = Buffer.from(
    hashAlmacenado.buffer,
    hashAlmacenado.byteOffset,
    hashAlmacenado.byteLength,
  );
  if (calculado.length !== almacenado.length) return false;
  return timingSafeEqual(calculado, almacenado);
}
