import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Reto de segundo factor entre la contraseña y la sesión (ADR-0009 §8).
 *
 * > **HUECO declarado por el propio ADR-0009 y asumido aquí:** «no hay modelo
 * > para el reto de segundo factor entre la contraseña y la sesión — creo que
 * > pertenece a `database-engineer`». No existe tabla donde viva este reto y
 * > **no la invento**: `prisma/` y `docs/schema/` no son mi ámbito.
 *
 * Consecuencia honesta, sin maquillar: este almacén es **en memoria del
 * proceso**. Eso significa que hoy el 2FA
 *   - **no sobrevive a un reinicio** de la API, y
 *   - **no funciona con más de una instancia** salvo con sesiones pegajosas,
 *     que `ARQUITECTURA.md` §7.2 eliminó a propósito.
 * Es utilizable para desarrollo y está probado de punta a punta, pero **no se
 * declara listo para producción** hasta que exista la tabla.
 */

export interface RetoMfa {
  readonly id: string;
  readonly usuarioId: string;
  readonly expiraEn: Date;
}

export interface RetoMfaEmitido extends RetoMfa {
  /** Mitad secreta; se entrega al cliente UNA vez y no se persiste en claro. */
  readonly testigo: string;
}

export interface AlmacenDeRetosMfa {
  crear(usuarioId: string, ahora: Date, ttlMs: number): Promise<RetoMfaEmitido>;
  /** Consume el reto: un solo uso. `null` si no existe, caducó o no coincide. */
  consumir(retoId: string, testigo: string, ahora: Date): Promise<RetoMfa | null>;
}

export const ALMACEN_DE_RETOS_MFA = Symbol('ALMACEN_DE_RETOS_MFA');

interface Entrada {
  readonly id: string;
  readonly usuarioId: string;
  readonly hashTestigo: Buffer;
  readonly expiraEn: Date;
}

export class AlmacenDeRetosMfaEnMemoria implements AlmacenDeRetosMfa {
  readonly #retos = new Map<string, Entrada>();

  async crear(usuarioId: string, ahora: Date, ttlMs: number): Promise<RetoMfaEmitido> {
    this.#purgar(ahora);
    const id = randomUUID();
    const testigo = randomBytes(32).toString('base64url');
    const expiraEn = new Date(ahora.getTime() + ttlMs);
    this.#retos.set(id, {
      id,
      usuarioId,
      hashTestigo: createHash('sha256').update(testigo, 'utf8').digest(),
      expiraEn,
    });
    return { id, usuarioId, expiraEn, testigo };
  }

  async consumir(retoId: string, testigo: string, ahora: Date): Promise<RetoMfa | null> {
    this.#purgar(ahora);
    const entrada = this.#retos.get(retoId);
    if (entrada === undefined) return null;
    const calculado = createHash('sha256').update(testigo, 'utf8').digest();
    if (
      calculado.length !== entrada.hashTestigo.length ||
      !timingSafeEqual(calculado, entrada.hashTestigo)
    ) {
      return null;
    }
    // Un solo uso: se elimina aunque el TOTP luego falle. Reintentar exige un
    // reto nuevo, lo que acota la fuerza bruta sobre los 6 dígitos.
    this.#retos.delete(retoId);
    if (entrada.expiraEn.getTime() <= ahora.getTime()) return null;
    return { id: entrada.id, usuarioId: entrada.usuarioId, expiraEn: entrada.expiraEn };
  }

  #purgar(ahora: Date): void {
    for (const [id, entrada] of this.#retos) {
      if (entrada.expiraEn.getTime() <= ahora.getTime()) this.#retos.delete(id);
    }
  }
}
