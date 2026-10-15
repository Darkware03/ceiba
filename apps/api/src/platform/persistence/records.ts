import type { RolDeWorkspace } from '../guards/roles.ts';

/**
 * Proyecciones de las filas que `apps/api` necesita, con los nombres de campo
 * del cliente Prisma generado desde `prisma/schema/*.prisma` (commit `a2c03bb`).
 *
 * NO son un modelo de datos paralelo: son el subconjunto de columnas que esta
 * ronda usa. `prisma/` y `docs/schema/` **no son de mi ámbito** y no se tocan.
 * Si falta algo, se declara como HUECO en el informe; no se añade aquí.
 */

export type EstadoDeUsuario = 'active' | 'invited' | 'suspended' | 'deactivated';
export type EstadoDeMembresia = 'active' | 'suspended' | 'removed';
export type EstadoDeCicloDeVida = 'active' | 'archived';
export type VisibilidadDeColeccion = 'private' | 'link_public' | 'link_private';

/**
 * Vocabulario normativo de `sessions.revoked_reason`, cerrado por el ADR-0009
 * §4. La columna es texto libre en el esquema; el tipo la cierra aquí.
 */
export const MOTIVOS_DE_REVOCACION = [
  'logout',
  'logout_all',
  'rotated',
  'reuse_detected',
  'expired_idle',
  'expired_absolute',
  'password_changed',
  'mfa_changed',
  'admin_revoked',
  'membership_revoked',
  'user_deactivated',
] as const;
export type MotivoDeRevocacion = (typeof MOTIVOS_DE_REVOCACION)[number];

export interface FilaUsuario {
  readonly id: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly passwordHash: string | null;
  readonly passwordUpdatedAt: Date | null;
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
  readonly status: EstadoDeUsuario;
  readonly mfaEnabled: boolean;
  readonly mfaSecretId: string | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface FilaSesion {
  readonly id: string;
  readonly userId: string;
  readonly tokenSelector: string;
  readonly tokenVerifierHash: Uint8Array;
  readonly parentSessionId: string | null;
  readonly userAgent: string | null;
  readonly clientIp: string | null;
  readonly deviceLabel: string | null;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: MotivoDeRevocacion | null;
}

export interface FilaWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly ownerUserId: string;
  readonly allowPublicSharing: boolean;
  readonly status: EstadoDeCicloDeVida;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface FilaMiembroDeWorkspace {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: RolDeWorkspace;
  readonly status: EstadoDeMembresia;
  readonly invitedByUserId: string | null;
  readonly joinedAt: Date;
  readonly updatedAt: Date;
  readonly removedAt: Date | null;
}

export interface FilaColeccion {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: VisibilidadDeColeccion;
  readonly sortKey: string;
  readonly status: EstadoDeCicloDeVida;
  readonly lockVersion: number;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly deletedByUserId: string | null;
}
