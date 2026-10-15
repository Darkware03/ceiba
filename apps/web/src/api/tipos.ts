/**
 * Tipos del contrato REST, **transcritos de los controladores reales** de
 * `apps/api/src/modules/`. No hay aquí ni un campo inventado.
 *
 * Origen de cada forma:
 *  - `PerfilPublico`      -> `identity.service.ts` (`perfilDe`)
 *  - `Workspace`          -> `workspace.controller.ts` (`vistaWorkspace`)
 *  - `MiembroDeWorkspace` -> `workspace.controller.ts` (`vistaMiembro`)
 *  - `Coleccion`          -> `collection.controller.ts` (`vista`)
 *  - `SesionActiva`       -> `identity.controller.ts` (`listarSesiones`)
 *
 * HUECO: el ADR-0004 §4 quiere estos tipos en `packages/contracts/src/rest/`,
 * compartidos por API y web. `packages/` no está en mi ámbito de escritura, así
 * que aquí hay una **copia manual** que puede desincronizarse. Ver FRONTEND.md.
 */

/** Jerarquía normativa del ADR-0009 §7.5: `owner > admin > editor > executor > viewer`. */
export const ROLES_DE_WORKSPACE = ['owner', 'admin', 'editor', 'executor', 'viewer'] as const;
export type RolDeWorkspace = (typeof ROLES_DE_WORKSPACE)[number];

export interface PerfilPublico {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status?: string;
  readonly mfaEnabled?: boolean;
}

export interface Workspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly ownerUserId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MiembroDeWorkspace {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: RolDeWorkspace;
  readonly status: string;
  readonly joinedAt: string;
}

export interface Coleccion {
  readonly id: string;
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly status: string;
  readonly lockVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SesionActiva {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly userAgent: string | null;
  readonly clientIp: string | null;
  readonly lastSeenAt: string;
  readonly issuedAt: string;
  readonly esLaActual: boolean;
}

/**
 * `POST /auth/login` y `POST /auth/mfa/verify` devuelven **una de dos cosas**
 * (`identity.controller.ts#responderInicio`). La unión discriminada obliga a
 * tratar el caso de segundo factor en vez de ignorarlo.
 */
export type RespuestaDeInicio =
  | { readonly usuario: PerfilPublico }
  | {
      readonly mfaRequerido: true;
      readonly retoId: string;
      readonly retoTestigo: string;
      readonly expiraEn: string;
    };

export function exigeSegundoFactor(
  respuesta: RespuestaDeInicio,
): respuesta is Extract<RespuestaDeInicio, { mfaRequerido: true }> {
  return 'mfaRequerido' in respuesta && respuesta.mfaRequerido === true;
}

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface EntradaDeRegistro {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface EntradaDeInicioDeSesion {
  readonly email: string;
  readonly password: string;
}

export interface EntradaCrearWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly description?: string | null;
}

export interface EntradaActualizarWorkspace {
  readonly name?: string;
  readonly description?: string | null;
}

export interface EntradaCrearColeccion {
  readonly slug: string;
  readonly name: string;
  readonly description?: string | null;
}

export interface EntradaActualizarColeccion {
  readonly name?: string;
  readonly description?: string | null;
}

// ---------------------------------------------------------------------------
// Reglas de validación, copiadas de los esquemas Zod de la API
// ---------------------------------------------------------------------------

/** `esquemaSlug` de `workspace.dto.ts`. */
export const PATRON_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const LONGITUD_MINIMA_SLUG = 2;
export const LONGITUD_MAXIMA_SLUG = 64;

/** `esquemaContrasena` de `identity.dto.ts`: la entropía la pone la longitud. */
export const LONGITUD_MINIMA_CONTRASENA = 12;
export const LONGITUD_MAXIMA_CONTRASENA = 512;

/** Deriva un slug legal a partir de un nombre, para no obligar a teclearlo. */
export function slugDesdeNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, LONGITUD_MAXIMA_SLUG)
    .replace(/-+$/gu, '');
}

export function errorDeSlug(slug: string): string | null {
  if (slug.length < LONGITUD_MINIMA_SLUG) return 'El identificador necesita al menos 2 caracteres.';
  if (slug.length > LONGITUD_MAXIMA_SLUG) return 'El identificador no puede superar 64 caracteres.';
  if (!PATRON_SLUG.test(slug)) {
    return 'El identificador admite minúsculas, dígitos y guiones (sin guiones al principio ni al final).';
  }
  return null;
}
