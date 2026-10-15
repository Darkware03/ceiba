import { z } from 'zod';
import { ROLES_DE_WORKSPACE } from '../../../platform/guards/roles.ts';

/** `slug`: identificador estable en URL, independiente del nombre (esquema). */
export const esquemaSlug = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'el slug admite minúsculas, dígitos y guiones');

export const esquemaCrearWorkspace = z.object({
  slug: esquemaSlug,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type EntradaCrearWorkspace = z.infer<typeof esquemaCrearWorkspace>;

export const esquemaActualizarWorkspace = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'no hay nada que actualizar',
  });
export type EntradaActualizarWorkspace = z.infer<typeof esquemaActualizarWorkspace>;

export const esquemaAnadirMiembro = z.object({
  email: z.email().max(320),
  role: z.enum(ROLES_DE_WORKSPACE),
});
export type EntradaAnadirMiembro = z.infer<typeof esquemaAnadirMiembro>;

export const esquemaCambiarRol = z.object({ role: z.enum(ROLES_DE_WORKSPACE) });
export type EntradaCambiarRol = z.infer<typeof esquemaCambiarRol>;
