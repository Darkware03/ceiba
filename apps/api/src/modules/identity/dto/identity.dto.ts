import { z } from 'zod';

/**
 * Esquemas de entrada de `identity`.
 *
 * NOTA DE CONTRATO: el ADR-0004 §4 manda que estos tipos vivan en
 * `packages/contracts/src/rest/`. **`packages/` no está en mi ámbito de
 * escritura en esta ronda**, así que viven aquí y quedan declarados como HUECO
 * para moverlos cuando `packages/contracts` exista.
 */

/** Mínimo de 12 caracteres: la entropía la pone la longitud, no los símbolos. */
export const esquemaContrasena = z
  .string()
  .min(12, 'la contraseña debe tener al menos 12 caracteres')
  .max(512, 'la contraseña no puede superar 512 caracteres');

export const esquemaCorreo = z
  .email('correo no válido')
  .max(320, 'el correo no puede superar 320 caracteres');

export const esquemaRegistro = z.object({
  email: esquemaCorreo,
  password: esquemaContrasena,
  displayName: z.string().trim().min(1, 'el nombre es obligatorio').max(120),
});
export type EntradaDeRegistro = z.infer<typeof esquemaRegistro>;

export const esquemaInicioDeSesion = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(512),
});
export type EntradaDeInicioDeSesion = z.infer<typeof esquemaInicioDeSesion>;

export const esquemaVerificacionMfa = z.object({
  retoId: z.string().min(1).max(64),
  retoTestigo: z.string().min(1).max(256),
  codigo: z.string().trim().regex(/^\d{6}$/u, 'el código TOTP son 6 dígitos'),
});
export type EntradaDeVerificacionMfa = z.infer<typeof esquemaVerificacionMfa>;

export const esquemaCambioDeContrasena = z.object({
  contrasenaActual: z.string().min(1).max(512),
  contrasenaNueva: esquemaContrasena,
});
export type EntradaDeCambioDeContrasena = z.infer<typeof esquemaCambioDeContrasena>;
