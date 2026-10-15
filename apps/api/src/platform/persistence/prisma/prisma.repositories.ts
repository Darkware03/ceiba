import type { RolDeWorkspace } from '../../guards/roles.ts';
import { esRolDeWorkspace } from '../../guards/roles.ts';
import type {
  EstadoDeCicloDeVida,
  EstadoDeMembresia,
  EstadoDeUsuario,
  FilaColeccion,
  FilaMiembroDeWorkspace,
  FilaSesion,
  FilaUsuario,
  FilaWorkspace,
  MotivoDeRevocacion,
  VisibilidadDeColeccion,
} from '../records.ts';
import type {
  DatosNuevaColeccion,
  DatosNuevaSesion,
  DatosNuevoUsuario,
  DatosNuevoWorkspace,
  RepositorioDeColecciones,
  RepositorioDeSesiones,
  RepositorioDeUsuarios,
  RepositorioDeWorkspaces,
} from '../repositories.ts';
import type {
  ClientePrismaCeiba,
  FilaColeccionPrisma,
  FilaMiembroPrisma,
  FilaSesionPrisma,
  FilaUsuarioPrisma,
  FilaWorkspacePrisma,
} from './prisma-client.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ADAPTADORES PRISMA — **[NO VERIFICADO]. ESCRITO, NO EJECUTADO.**
 *
 * No hay PostgreSQL en este contenedor, el cliente Prisma no está generado
 * (ver `prisma-client.ts`) y las migraciones están prohibidas. Ninguna línea de
 * este fichero se ha ejecutado nunca. Las pruebas de este entregable usan
 * exclusivamente los repositorios en memoria.
 *
 * Lo que sí aporta: deja escrita la traducción puerto -> esquema, con los
 * nombres de campo reales del cliente generado desde `prisma/schema/*.prisma`,
 * para que la rebanada siguiente no la invente otra vez.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Mapeos fila Prisma -> proyección de la aplicación
// ---------------------------------------------------------------------------

const ESTADOS_DE_USUARIO = new Set(['active', 'invited', 'suspended', 'deactivated']);
const ESTADOS_DE_MEMBRESIA = new Set(['active', 'suspended', 'removed']);
const ESTADOS_DE_CICLO = new Set(['active', 'archived']);
const VISIBILIDADES = new Set(['private', 'link_public', 'link_private']);

function aUsuario(fila: FilaUsuarioPrisma): FilaUsuario {
  return {
    ...fila,
    status: (ESTADOS_DE_USUARIO.has(fila.status) ? fila.status : 'suspended') as EstadoDeUsuario,
  };
}

function aSesion(fila: FilaSesionPrisma): FilaSesion {
  return { ...fila, revokedReason: fila.revokedReason as MotivoDeRevocacion | null };
}

function aWorkspace(fila: FilaWorkspacePrisma): FilaWorkspace {
  return {
    ...fila,
    status: (ESTADOS_DE_CICLO.has(fila.status) ? fila.status : 'archived') as EstadoDeCicloDeVida,
  };
}

function aMiembro(fila: FilaMiembroPrisma): FilaMiembroDeWorkspace {
  return {
    ...fila,
    // Un rol fuera del enum se degrada a `viewer`; nunca se eleva. Fallo cerrado.
    role: (esRolDeWorkspace(fila.role) ? fila.role : 'viewer') as RolDeWorkspace,
    status: (ESTADOS_DE_MEMBRESIA.has(fila.status)
      ? fila.status
      : 'removed') as EstadoDeMembresia,
  };
}

function aColeccion(fila: FilaColeccionPrisma): FilaColeccion {
  return {
    ...fila,
    visibility: (VISIBILIDADES.has(fila.visibility)
      ? fila.visibility
      : 'private') as VisibilidadDeColeccion,
    status: (ESTADOS_DE_CICLO.has(fila.status) ? fila.status : 'archived') as EstadoDeCicloDeVida,
  };
}

// ---------------------------------------------------------------------------

export class RepositorioDeUsuariosPrisma implements RepositorioDeUsuarios {
  constructor(private readonly prisma: ClientePrismaCeiba) {}

  async buscarPorCorreo(correo: string): Promise<FilaUsuario | null> {
    // `users.email` es `citext` en PostgreSQL: la unicidad y la comparación ya
    // son insensibles a mayúsculas en el motor. No se añade `mode:'insensitive'`
    // porque con citext sería redundante y desactivaría el índice.
    const fila = await this.prisma.user.findFirst({
      where: { email: correo.trim(), deletedAt: null },
    });
    return fila === null ? null : aUsuario(fila);
  }

  async buscarPorId(id: string): Promise<FilaUsuario | null> {
    const fila = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    return fila === null ? null : aUsuario(fila);
  }

  async crear(datos: DatosNuevoUsuario, ahora: Date): Promise<FilaUsuario> {
    const fila = await this.prisma.user.create({
      data: {
        email: datos.email,
        passwordHash: datos.passwordHash,
        passwordUpdatedAt: ahora,
        displayName: datos.displayName,
        locale: datos.locale ?? 'es',
        timezone: datos.timezone ?? 'UTC',
        status: datos.status ?? 'active',
        createdAt: ahora,
        updatedAt: ahora,
      },
    });
    return aUsuario(fila);
  }

  async registrarFalloDeAcceso(
    id: string,
    fallosConsecutivos: number,
    bloqueadoHasta: Date | null,
    ahora: Date,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: fallosConsecutivos, lockedUntil: bloqueadoHasta, updatedAt: ahora },
    });
  }

  async registrarAccesoCorrecto(id: string, ahora: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: ahora, updatedAt: ahora },
    });
  }

  async actualizarContrasena(id: string, hashPhc: string, ahora: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: hashPhc, passwordUpdatedAt: ahora, updatedAt: ahora },
    });
  }
}

// ---------------------------------------------------------------------------

export class RepositorioDeSesionesPrisma implements RepositorioDeSesiones {
  constructor(private readonly prisma: ClientePrismaCeiba) {}

  async crear(datos: DatosNuevaSesion): Promise<FilaSesion> {
    const fila = await this.prisma.session.create({
      data: {
        userId: datos.userId,
        tokenSelector: datos.tokenSelector,
        tokenVerifierHash: datos.tokenVerifierHash,
        parentSessionId: datos.parentSessionId,
        userAgent: datos.userAgent,
        clientIp: datos.clientIp,
        deviceLabel: datos.deviceLabel,
        issuedAt: datos.issuedAt,
        lastSeenAt: datos.issuedAt,
        absoluteExpiresAt: datos.absoluteExpiresAt,
        idleExpiresAt: datos.idleExpiresAt,
      },
    });
    return aSesion(fila);
  }

  async buscarPorSelector(selector: string): Promise<FilaSesion | null> {
    const fila = await this.prisma.session.findUnique({ where: { tokenSelector: selector } });
    return fila === null ? null : aSesion(fila);
  }

  async buscarPorId(id: string): Promise<FilaSesion | null> {
    const fila = await this.prisma.session.findUnique({ where: { id } });
    return fila === null ? null : aSesion(fila);
  }

  async buscarHijaViva(idPadre: string): Promise<FilaSesion | null> {
    const fila = await this.prisma.session.findFirst({
      where: { parentSessionId: idPadre, revokedAt: null },
      orderBy: { issuedAt: 'desc' },
    });
    return fila === null ? null : aSesion(fila);
  }

  async listarVivasDeUsuario(usuarioId: string, ahora: Date): Promise<readonly FilaSesion[]> {
    const filas = await this.prisma.session.findMany({
      where: {
        userId: usuarioId,
        revokedAt: null,
        absoluteExpiresAt: { gt: ahora },
        idleExpiresAt: { gt: ahora },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return filas.map(aSesion);
  }

  async tocarUltimaActividad(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { lastSeenAt, idleExpiresAt } });
  }

  async revocar(id: string, ahora: Date, motivo: MotivoDeRevocacion): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: ahora, revokedReason: motivo },
    });
  }

  /**
   * Transcripción literal del `WITH RECURSIVE` del ADR-0009 §4, incluidas sus
   * tres precisiones: la raíz por `parent_session_id IS NULL` (no por id más
   * bajo), `UNION` y no `UNION ALL` en el descenso (corta ciclos), y la rama
   * `NOT EXISTS` que revoca todo lo vivo del usuario si la familia saliera
   * vacía. **Nunca 0 filas ante una reutilización.**
   *
   * Va por SQL crudo a propósito: Prisma no expresa CTE recursivas.
   */
  async revocarFamilia(
    sesionId: string,
    usuarioId: string,
    ahora: Date,
    motivo: MotivoDeRevocacion,
  ): Promise<number> {
    const sql = `
WITH RECURSIVE ancestros AS (
    SELECT id, parent_session_id FROM sessions WHERE id = $1::uuid
  UNION ALL
    SELECT s.id, s.parent_session_id
      FROM sessions s JOIN ancestros a ON s.id = a.parent_session_id
),
raiz AS (
    SELECT id FROM ancestros WHERE parent_session_id IS NULL
),
familia AS (
    SELECT id FROM raiz
  UNION
    SELECT s.id FROM sessions s JOIN familia f ON s.parent_session_id = f.id
)
UPDATE sessions SET revoked_at = $3::timestamptz, revoked_reason = $4
 WHERE revoked_at IS NULL
   AND (
     id IN (SELECT id FROM familia)
     OR (NOT EXISTS (SELECT 1 FROM familia) AND user_id = $2::uuid)
   )`;
    return this.prisma.$executeRawUnsafe(sql, sesionId, usuarioId, ahora, motivo);
  }

  async revocarTodasDeUsuario(
    usuarioId: string,
    ahora: Date,
    motivo: MotivoDeRevocacion,
    exceptoId?: string,
  ): Promise<number> {
    const resultado = await this.prisma.session.updateMany({
      where: {
        userId: usuarioId,
        revokedAt: null,
        ...(exceptoId === undefined ? {} : { id: { not: exceptoId } }),
      },
      data: { revokedAt: ahora, revokedReason: motivo },
    });
    return resultado.count;
  }
}

// ---------------------------------------------------------------------------

export class RepositorioDeWorkspacesPrisma implements RepositorioDeWorkspaces {
  constructor(private readonly prisma: ClientePrismaCeiba) {}

  async crearConPropietario(datos: DatosNuevoWorkspace, ahora: Date): Promise<FilaWorkspace> {
    // Una sola transacción: el esquema exige que todo workspace vivo tenga al
    // menos un miembro activo con role='owner'.
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          slug: datos.slug,
          name: datos.name,
          description: datos.description,
          ownerUserId: datos.ownerUserId,
          createdAt: ahora,
          updatedAt: ahora,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: datos.ownerUserId,
          role: 'owner',
          status: 'active',
          joinedAt: ahora,
          updatedAt: ahora,
        },
      });
      return aWorkspace(workspace);
    });
  }

  async buscarPorId(id: string): Promise<FilaWorkspace | null> {
    const fila = await this.prisma.workspace.findFirst({ where: { id, deletedAt: null } });
    return fila === null ? null : aWorkspace(fila);
  }

  async buscarPorSlug(slug: string): Promise<FilaWorkspace | null> {
    const fila = await this.prisma.workspace.findFirst({ where: { slug, deletedAt: null } });
    return fila === null ? null : aWorkspace(fila);
  }

  async listarDeUsuario(usuarioId: string): Promise<readonly FilaWorkspace[]> {
    const filas = await this.prisma.workspace.findMany({
      where: {
        deletedAt: null,
        workspaceMembers: { some: { userId: usuarioId, status: 'active' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return filas.map(aWorkspace);
  }

  async actualizar(
    id: string,
    cambios: { readonly name?: string; readonly description?: string | null },
    ahora: Date,
  ): Promise<FilaWorkspace | null> {
    const resultado = await this.prisma.workspace.updateMany({
      where: { id, deletedAt: null },
      data: { ...cambios, updatedAt: ahora },
    });
    if (resultado.count === 0) return null;
    return this.buscarPorId(id);
  }

  async borrarLogicamente(id: string, porUsuarioId: string, ahora: Date): Promise<boolean> {
    const resultado = await this.prisma.workspace.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: ahora, deletedByUserId: porUsuarioId, updatedAt: ahora },
    });
    return resultado.count > 0;
  }

  async buscarMembresia(
    workspaceId: string,
    usuarioId: string,
  ): Promise<FilaMiembroDeWorkspace | null> {
    const fila = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: usuarioId } },
    });
    return fila === null ? null : aMiembro(fila);
  }

  async listarMiembros(workspaceId: string): Promise<readonly FilaMiembroDeWorkspace[]> {
    const filas = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, status: { not: 'removed' } },
      orderBy: { joinedAt: 'asc' },
    });
    return filas.map(aMiembro);
  }

  async altaDeMiembro(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    invitadoPorUsuarioId: string,
    ahora: Date,
  ): Promise<FilaMiembroDeWorkspace> {
    const fila = await this.prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: usuarioId,
        role: rol,
        status: 'active',
        invitedByUserId: invitadoPorUsuarioId,
        joinedAt: ahora,
        updatedAt: ahora,
      },
    });
    return aMiembro(fila);
  }

  async cambiarRol(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    ahora: Date,
  ): Promise<FilaMiembroDeWorkspace | null> {
    const resultado = await this.prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: usuarioId, status: { not: 'removed' } },
      data: { role: rol, updatedAt: ahora },
    });
    if (resultado.count === 0) return null;
    return this.buscarMembresia(workspaceId, usuarioId);
  }

  async expulsarMiembro(workspaceId: string, usuarioId: string, ahora: Date): Promise<boolean> {
    const resultado = await this.prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: usuarioId, status: { not: 'removed' } },
      data: { status: 'removed', removedAt: ahora, updatedAt: ahora },
    });
    return resultado.count > 0;
  }
}

// ---------------------------------------------------------------------------

export class RepositorioDeColeccionesPrisma implements RepositorioDeColecciones {
  constructor(private readonly prisma: ClientePrismaCeiba) {}

  async crear(datos: DatosNuevaColeccion, ahora: Date): Promise<FilaColeccion> {
    const fila = await this.prisma.collection.create({
      data: {
        workspaceId: datos.workspaceId,
        slug: datos.slug,
        name: datos.name,
        description: datos.description,
        createdByUserId: datos.createdByUserId,
        sortKey: ahora.getTime().toString(36),
        createdAt: ahora,
        updatedAt: ahora,
      },
    });
    return aColeccion(fila);
  }

  async buscarPorId(id: string): Promise<FilaColeccion | null> {
    const fila = await this.prisma.collection.findFirst({ where: { id, deletedAt: null } });
    return fila === null ? null : aColeccion(fila);
  }

  async buscarPorSlug(workspaceId: string, slug: string): Promise<FilaColeccion | null> {
    const fila = await this.prisma.collection.findFirst({
      where: { workspaceId, slug, deletedAt: null },
    });
    return fila === null ? null : aColeccion(fila);
  }

  async listarPorWorkspace(workspaceId: string): Promise<readonly FilaColeccion[]> {
    const filas = await this.prisma.collection.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { sortKey: 'asc' },
    });
    return filas.map(aColeccion);
  }

  async actualizar(
    id: string,
    cambios: { readonly name?: string; readonly description?: string | null },
    ahora: Date,
  ): Promise<FilaColeccion | null> {
    const resultado = await this.prisma.collection.updateMany({
      where: { id, deletedAt: null },
      data: { ...cambios, lockVersion: { increment: 1 }, updatedAt: ahora },
    });
    if (resultado.count === 0) return null;
    return this.buscarPorId(id);
  }

  async borrarLogicamente(id: string, porUsuarioId: string, ahora: Date): Promise<boolean> {
    const resultado = await this.prisma.collection.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: ahora, deletedByUserId: porUsuarioId, updatedAt: ahora },
    });
    return resultado.count > 0;
  }

  async workspaceIdDe(coleccionId: string): Promise<string | null> {
    const fila = await this.prisma.collection.findFirst({
      where: { id: coleccionId, deletedAt: null },
      select: { workspaceId: true },
    });
    return fila === null ? null : fila.workspaceId;
  }
}
