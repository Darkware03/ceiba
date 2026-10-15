/**
 * SUPERFICIE PÚBLICA de `workspace` (ADR-0004 §2).
 *
 * El puerto de autorización NO se publica aquí a propósito: lo declara
 * `platform/auth/ports.ts` y este módulo sólo lo implementa. Publicarlo también
 * aquí invitaría a que `platform` lo importara y reintroduciría el ciclo que el
 * ADR-0009 §7.3 prohíbe expresamente.
 */
export { ModuloDeWorkspaces } from './workspace.module.ts';
export { ServicioDeWorkspaces } from './workspace.service.ts';
