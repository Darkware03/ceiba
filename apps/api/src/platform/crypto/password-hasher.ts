import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Hash de contraseñas con Argon2id, perfil del ADR-0009 §8 (m=19456, t=2, p=1,
 * sal de 16 bytes, formato PHC). Es el mismo perfil que el proyecto usa para
 * los códigos de colección privada: un solo perfil criptográfico en el producto.
 */

export const PERFIL_ARGON2ID = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  saltLength: 16,
});

export interface HasherDeContrasena {
  hashear(contrasenaEnClaro: string): Promise<string>;
  /**
   * Verifica una contraseña contra un hash PHC. **Nunca lanza**: un hash
   * corrupto o de otro algoritmo devuelve `false`, porque una excepción aquí
   * sería distinguible desde fuera y rompería la no enumeración.
   */
  verificar(hashPhc: string, contrasenaEnClaro: string): Promise<boolean>;
  /**
   * Hash señuelo (C-CODE-04 / ADR-0009 §8). Se verifica contra él cuando el
   * correo NO existe, para que el coste y por tanto el tiempo de respuesta sean
   * indistinguibles del caso «existe pero la contraseña es incorrecta».
   */
  hashSenuelo(): Promise<string>;
}

export const HASHER_DE_CONTRASENA = Symbol('HASHER_DE_CONTRASENA');

export class HasherArgon2id implements HasherDeContrasena {
  /**
   * El señuelo se calcula UNA vez y se reutiliza. Recalcularlo en cada intento
   * fallido doblaría el coste del camino inexistente respecto al existente, que
   * es justo la diferencia de tiempo que se quiere eliminar.
   */
  #senuelo: Promise<string> | undefined;

  async hashear(contrasenaEnClaro: string): Promise<string> {
    return argon2.hash(contrasenaEnClaro, PERFIL_ARGON2ID);
  }

  async verificar(hashPhc: string, contrasenaEnClaro: string): Promise<boolean> {
    try {
      return await argon2.verify(hashPhc, contrasenaEnClaro);
    } catch {
      return false;
    }
  }

  hashSenuelo(): Promise<string> {
    this.#senuelo ??= argon2.hash(randomBytes(32).toString('base64url'), PERFIL_ARGON2ID);
    return this.#senuelo;
  }
}
