import { z } from 'zod';
import { PERMISOS } from '../share-policy.ts';

/**
 * Contratos de entrada del módulo `sharing`.
 *
 * **Ningún esquema acepta un campo `code` fuera del cuerpo de
 * `POST /share/:slug/access`.** El propietario nunca envía un código: lo recibe
 * generado. No hay forma de fijar un código a mano, y es deliberado: un código
 * elegido por una persona no tiene 80 bits (C-CODE-01), y permitirlo obligaría
 * a tratar Argon2id como última línea en vez de como refuerzo.
 */

const fechaFutura = z
  .string()
  .datetime({ offset: true })
  .transform((valor) => new Date(valor));

export const esquemaCrearEnlace = z.object({
  permission: z.enum(PERMISOS as unknown as [string, ...string[]]).default('viewer'),
  requiresAccessCode: z.boolean().default(true),
  allowExport: z.boolean().default(false),
  allowExecution: z.boolean().default(false),
  includeExamples: z.boolean().default(true),
  expiresAt: fechaFutura.nullish(),
  maxViews: z.number().int().min(1).max(1_000_000).nullish(),
  codeLabel: z.string().trim().min(1).max(120).nullish(),
  codeExpiresAt: fechaFutura.nullish(),
  codeMaxUses: z.number().int().min(1).max(1_000_000).nullish(),
  /** Guardar los 4 últimos caracteres. Por defecto NO: son 20 bits menos. */
  storeHint: z.boolean().default(false),
});

export const esquemaRotarCodigo = z.object({
  codeLabel: z.string().trim().min(1).max(120).nullish(),
  codeExpiresAt: fechaFutura.nullish(),
  codeMaxUses: z.number().int().min(1).max(1_000_000).nullish(),
  storeHint: z.boolean().default(false),
});

/**
 * El cuerpo del acceso. `code` es **opcional** a propósito: un enlace público
 * no lo lleva, y un enlace privado sin código debe fallar por el camino normal
 * —con su hash señuelo y su piso de tiempo—, no con un 422 instantáneo que
 * delataría que el enlace existe y exige código.
 */
export const esquemaAcceder = z.object({
  code: z.string().max(512).nullish(),
});
