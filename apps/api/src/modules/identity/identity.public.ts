/**
 * SUPERFICIE PÚBLICA de `identity` (ADR-0004 §2).
 *
 * Lo único importable desde fuera del módulo. **Nunca** repositorios, nunca
 * entidades de Prisma, nunca utilidades internas.
 */
export { ModuloDeIdentidad } from './identity.module.ts';
export type { PerfilPublico } from './identity.service.ts';
