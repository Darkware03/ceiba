import { Injectable, Logger } from '@nestjs/common';

/**
 * Obtención de la semilla TOTP de un usuario.
 *
 * `users.mfa_secret_id` apunta a `secrets`, donde la semilla vive **cifrada**
 * con la clave maestra (`CEIBA_SECRETS_MASTER_KEY`). El criptosistema de
 * secretos en reposo es de `appsec-engineer` y **no está implementado**: el
 * módulo `vault` no existe todavía en `apps/api`.
 *
 * Por eso aquí hay un puerto y una implementación que **falla cerrado**:
 * devuelve `null`, con lo que el segundo factor nunca valida y la sesión nunca
 * se emite. Lo contrario —inventar un descifrado o leer la semilla en claro—
 * sería escribir una puerta trasera para poder marcar una casilla.
 */
export interface ProveedorDeSemillaTotp {
  obtenerSemilla(mfaSecretId: string): Promise<Buffer | null>;
}

export const PROVEEDOR_DE_SEMILLA_TOTP = Symbol('PROVEEDOR_DE_SEMILLA_TOTP');

@Injectable()
export class ProveedorDeSemillaTotpNoDisponible implements ProveedorDeSemillaTotp {
  readonly #log = new Logger('totp');

  async obtenerSemilla(mfaSecretId: string): Promise<Buffer | null> {
    this.#log.warn(
      `Segundo factor solicitado (secreto ${mfaSecretId}) pero el módulo de secretos en reposo ` +
        'no está implementado en esta ronda. Se deniega (fallo cerrado).',
    );
    return null;
  }
}
