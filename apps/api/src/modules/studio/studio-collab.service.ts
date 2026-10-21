import { CLIENTE_PRISMA } from '../../platform/persistence/prisma/prisma-client.ts';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import {
  BYTES_SELECTOR,
  BYTES_VERIFICADOR,
  descomponerTestigo,
  hashearVerificador,
  verificadorCoincide,
} from '../../platform/crypto/session-token.js';

import {
  ACCION_AUDITORIA,
  SERVICIO_DE_AUDITORIA,
  type ServicioDeAuditoria,
} from '../../platform/audit/ports.js';
import {
  aBytesDePrisma,
  idDeUsuario,
  type Principal as PrincipalAutenticado,
} from '../../platform/auth/principal.js';
import {
  AccesoProhibido as ErrorAccesoDenegado,
  ConflictoDeEstado as ErrorConflicto,
  RecursoNoEncontrado as ErrorNoEncontrado,
  DatosDeEntradaInvalidos as ErrorValidacion,
} from '../../platform/errors/domain-errors.js';
import { PrismaClientService as ClientePrisma } from '../../platform/persistence/prisma/prisma-client.js';

export type RolColaboracion = 'owner' | 'admin' | 'editor' | 'executor' | 'viewer';

const JERARQUIA_ROLES: Record<RolColaboracion, number> = {
  viewer: 10,
  executor: 20,
  editor: 30,
  admin: 40,
  owner: 50,
};

@Injectable()
export class StudioCollaborationService {
  constructor(
    @Inject(CLIENTE_PRISMA) private readonly prisma: ClientePrisma,
    @Inject(SERVICIO_DE_AUDITORIA)
    private readonly auditoria: ServicioDeAuditoria,
  ) {}

  async verificarRolMinimo(
    workspaceId: string,
    principal: PrincipalAutenticado,
    rolMinimo: RolColaboracion,
  ): Promise<{
    workspace: {
      id: string;
      name: string;
      slug: string;
      ownerUserId: string;
      historyRetentionDays: number;
    };
    rol: RolColaboracion;
  }> {
    // `ownerUserId`, no `ownerId`: el campo del esquema esta denormalizado desde
    // `workspace_members` y se llama asi. Este `select` lo ejecuta TODO metodo
    // publico del modulo, de modo que el nombre equivocado tumbaba las 27 rutas
    // antes de llegar a ninguna otra consulta.
    const ws = await this.prisma.client.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      // `historyRetentionDays` viaja aqui porque `request_history.expires_at` y
      // `collection_runs.expires_at` son OBLIGATORIOS y sin default: cada
      // insercion necesita la politica del workspace, y esta consulta ya se
      // ejecuta en todas las rutas. Evita un viaje extra por peticion.
      select: {
        id: true,
        name: true,
        slug: true,
        ownerUserId: true,
        historyRetentionDays: true,
      },
    });
    if (!ws) {
      throw new ErrorNoEncontrado('El espacio de trabajo no existe.');
    }

    if (principal.esPlatformAdmin || ws.ownerUserId === idDeUsuario(principal)) {
      return { workspace: ws, rol: 'owner' };
    }

    const miembro = await this.prisma.client.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: idDeUsuario(principal),
        },
      },
      select: { role: true },
    });

    if (!miembro) {
      throw new ErrorAccesoDenegado('No eres miembro de este espacio de trabajo.');
    }

    const rolActual = miembro.role as RolColaboracion;
    if ((JERARQUIA_ROLES[rolActual] ?? 0) < JERARQUIA_ROLES[rolMinimo]) {
      throw new ErrorAccesoDenegado(
        `Tu permiso actual (${rolActual}) es de solo lectura o insuficiente. Se requiere al menos '${rolMinimo}'.`,
      );
    }

    return { workspace: ws, rol: rolActual };
  }

  async listarMiembros(workspaceId: string, principal: PrincipalAutenticado) {
    const { workspace, rol } = await this.verificarRolMinimo(workspaceId, principal, 'viewer');

    const [owner, miembros] = await Promise.all([
      this.prisma.client.user.findUnique({
        where: { id: workspace.ownerUserId },
        select: { id: true, email: true, displayName: true },
      }),
      this.prisma.client.workspaceMember.findMany({
        where: { workspaceId },
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);

    const lista = miembros.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      displayName: m.user.displayName,
      role: m.userId === workspace.ownerUserId ? ('owner' as const) : (m.role as RolColaboracion),
      permissions: {
        canView: true,
        canExecute: (JERARQUIA_ROLES[m.role as RolColaboracion] ?? 0) >= JERARQUIA_ROLES.executor,
        canEdit: (JERARQUIA_ROLES[m.role as RolColaboracion] ?? 0) >= JERARQUIA_ROLES.editor,
        canManageMembers: (JERARQUIA_ROLES[m.role as RolColaboracion] ?? 0) >= JERARQUIA_ROLES.admin,
      },
      joinedAt: m.joinedAt.toISOString(),
    }));

    if (owner && !lista.some((m) => m.userId === owner.id)) {
      lista.unshift({
        id: `owner-${owner.id}`,
        userId: owner.id,
        email: owner.email,
        displayName: owner.displayName,
        role: 'owner',
        permissions: {
          canView: true,
          canExecute: true,
          canEdit: true,
          canManageMembers: true,
        },
        joinedAt: new Date(0).toISOString(),
      });
    }

    return {
      myRole: rol,
      permissions: {
        canView: true,
        canExecute: JERARQUIA_ROLES[rol] >= JERARQUIA_ROLES.executor,
        canEdit: JERARQUIA_ROLES[rol] >= JERARQUIA_ROLES.editor,
        canManageMembers: JERARQUIA_ROLES[rol] >= JERARQUIA_ROLES.admin,
      },
      members: lista,
    };
  }

  async listarInvitaciones(workspaceId: string, principal: PrincipalAutenticado) {
    await this.verificarRolMinimo(workspaceId, principal, 'viewer');

    const rows = await this.prisma.client.invitation.findMany({
      where: { workspaceId },
      include: {
        invitedByUser: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows.map((inv) => ({
      id: inv.id,
      workspaceId: inv.workspaceId,
      email: inv.email,
      role: inv.role as RolColaboracion,
      modeLabel: inv.role === 'viewer' ? 'Solo mostrar (Lectura)' : 'Mostrar y editar (Colaborador)',
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      acceptedAt: inv.acceptedAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
      invitedBy: inv.invitedByUser,
    }));
  }

  async crearInvitacion(
    workspaceId: string,
    input: { email?: string; role: 'viewer' | 'editor' | 'executor' | 'admin'; expiresInDays?: number },
    principal: PrincipalAutenticado,
  ) {
    const { workspace } = await this.verificarRolMinimo(workspaceId, principal, 'admin');

    const emailLimpio = (input.email?.trim().toLowerCase() || 'enlace-compartido@ceiba.local');
    const rolAsignado = input.role || 'viewer';
    const dias = Math.min(Math.max(input.expiresInDays ?? 7, 1), 30);

    // PATRON SELECTOR/VERIFICADOR, no un hash unico.
    //
    // El codigo original guardaba `tokenHash` (sha256 hex) en una columna que no
    // existe y buscaba por ella con `findUnique`, lo que Prisma rechaza porque
    // el unico indice unico de `invitations` es `uq_invitations_selector`. El
    // esquema impone el mismo patron que las sesiones (ADR-0009 §2): mitad
    // publica indexada y mitad secreta de la que solo se guarda el SHA-256.
    // Se reutilizan los ayudantes de `platform/crypto/session-token.ts` en vez
    // de volver a escribir la comparacion en tiempo constante.
    const selector = randomBytes(BYTES_SELECTOR).toString('base64url');
    const verificador = randomBytes(BYTES_VERIFICADOR).toString('base64url');
    const rawToken = `${selector}.${verificador}`;
    const expiresAt = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    const creada = await this.prisma.client.invitation.create({
      data: {
        workspaceId,
        email: emailLimpio,
        role: rolAsignado,
        tokenSelector: selector,
        tokenVerifierHash: aBytesDePrisma(hashearVerificador(verificador)),
        invitedByUserId: idDeUsuario(principal),
        status: 'pending',
        expiresAt,
      },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.INVITACION_CREADA,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'invitation',
      recursoId: creada.id,
      detalles: {
        workspaceName: workspace.name,
        invitedEmail: emailLimpio,
        role: rolAsignado,
        accessMode: rolAsignado === 'viewer' ? 'solo_mostrar' : 'mostrar_y_editar',
      },
    });

    return {
      id: creada.id,
      workspaceId,
      workspaceName: workspace.name,
      email: creada.email,
      role: creada.role as RolColaboracion,
      modeLabel: creada.role === 'viewer' ? 'Solo mostrar (Lectura)' : 'Mostrar y editar (Colaborador)',
      status: creada.status,
      expiresAt: creada.expiresAt.toISOString(),
      inviteToken: rawToken,
      invitePath: `/invitacion/${rawToken}`,
    };
  }

  async obtenerInvitacionPorToken(rawToken: string) {
    const partes = descomponerTestigo(rawToken.trim());
    if (!partes) {
      throw new ErrorValidacion('El token de invitación es obligatorio.');
    }
    const inv = await this.prisma.client.invitation.findUnique({
      where: { tokenSelector: partes.selector },
      include: {
        workspace: { select: { id: true, name: true, slug: true, description: true } },
        invitedByUser: { select: { id: true, email: true, displayName: true } },
      },
    });

    // Mismo error para «no existe» y para «el verificador no casa»: distinguirlos
    // convertiria el endpoint en un oraculo de selectores validos.
    if (!inv || !verificadorCoincide(partes.verificador, inv.tokenVerifierHash)) {
      throw new ErrorNoEncontrado('La invitación no existe o el enlace es inválido.');
    }

    const expirada = inv.expiresAt.getTime() < Date.now();
    const estadoEfectivo = inv.status === 'pending' && expirada ? 'expired' : inv.status;

    return {
      id: inv.id,
      status: estadoEfectivo,
      email: inv.email,
      role: inv.role as RolColaboracion,
      modeLabel: inv.role === 'viewer' ? 'Solo mostrar (Lectura)' : 'Mostrar y editar (Colaborador)',
      expiresAt: inv.expiresAt.toISOString(),
      workspace: inv.workspace,
      invitedBy: inv.invitedByUser,
    };
  }

  async aceptarInvitacion(rawToken: string, principal: PrincipalAutenticado) {
    const partes = descomponerTestigo(rawToken.trim());
    if (!partes) {
      throw new ErrorValidacion('El token de invitación es obligatorio.');
    }

    const inv = await this.prisma.client.invitation.findUnique({
      where: { tokenSelector: partes.selector },
      include: {
        workspace: {
          select: { id: true, name: true, slug: true, ownerUserId: true, deletedAt: true },
        },
      },
    });

    if (
      !inv ||
      !verificadorCoincide(partes.verificador, inv.tokenVerifierHash) ||
      inv.workspace.deletedAt
    ) {
      throw new ErrorNoEncontrado('La invitación no existe o el espacio fue eliminado.');
    }

    if (inv.status === 'revoked') {
      throw new ErrorConflicto('Esta invitación fue revocada por un administrador.');
    }

    if (inv.expiresAt.getTime() < Date.now()) {
      throw new ErrorConflicto('Esta invitación ha expirado.');
    }

    const rolFinal: RolColaboracion =
      inv.workspace.ownerUserId === idDeUsuario(principal) ? 'owner' : (inv.role as RolColaboracion);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: inv.workspaceId,
            userId: idDeUsuario(principal),
          },
        },
        create: {
          workspaceId: inv.workspaceId,
          userId: idDeUsuario(principal),
          // El propietario nunca llega aqui con rol `owner` en la tabla: el enum
          // lo admite, pero la propiedad vive en `workspaces.owner_user_id`.
          role: rolFinal,
          invitedByUserId: inv.invitedByUserId,
        },
        update: {
          role: rolFinal,
        },
      });

      if (inv.status === 'pending') {
        await tx.invitation.update({
          where: { id: inv.id },
          data: {
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedByUserId: idDeUsuario(principal),
          },
        });
      }
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.INVITACION_ACEPTADA,
      actorUserId: idDeUsuario(principal),
      workspaceId: inv.workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: idDeUsuario(principal),
      detalles: {
        invitationId: inv.id,
        role: rolFinal,
        userEmail: principal.email,
      },
    });

    return {
      workspaceId: inv.workspace.id,
      workspaceName: inv.workspace.name,
      role: rolFinal,
      modeLabel: rolFinal === 'viewer' ? 'Solo mostrar (Lectura)' : 'Mostrar y editar (Colaborador)',
    };
  }

  /**
   * Resuelve un miembro por **cualquiera de sus dos identificadores**.
   *
   * El controlador expone el parámetro de ruta como `:memberId`, pero el código
   * original lo buscaba siempre por la clave compuesta `(workspaceId, userId)`.
   * Con un `WorkspaceMember.id` real —que es lo que devuelve
   * `GET /collaboration` en `members[].id`— la búsqueda daba 404 siempre. Ambos
   * son `String`, así que el tipado no lo detecta: se acepta el id de fila y, si
   * no casa, el id de usuario.
   */
  async #resolverMiembro(workspaceId: string, idOUsuarioId: string) {
    const porId = await this.prisma.client.workspaceMember.findUnique({
      where: { id: idOUsuarioId },
      include: { user: { select: { email: true, displayName: true } } },
    });
    if (porId && porId.workspaceId === workspaceId) return porId;

    return this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: idOUsuarioId } },
      include: { user: { select: { email: true, displayName: true } } },
    });
  }

  async cambiarRolMiembro(
    workspaceId: string,
    targetUserId: string,
    nuevoRol: 'viewer' | 'editor' | 'executor' | 'admin',
    principal: PrincipalAutenticado,
  ) {
    const { workspace } = await this.verificarRolMinimo(workspaceId, principal, 'admin');

    if (targetUserId === workspace.ownerUserId) {
      throw new ErrorConflicto('No se puede cambiar el rol del propietario del espacio.');
    }

    const miembro = await this.#resolverMiembro(workspaceId, targetUserId);

    if (!miembro) {
      throw new ErrorNoEncontrado('El usuario no es miembro de este espacio.');
    }

    if (miembro.userId === workspace.ownerUserId) {
      throw new ErrorConflicto('No se puede cambiar el rol del propietario del espacio.');
    }

    const actualizado = await this.prisma.client.workspaceMember.update({
      where: { id: miembro.id },
      data: { role: nuevoRol },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.MIEMBRO_ROL_CAMBIADO,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: miembro.id,
      detalles: {
        targetUserId: miembro.userId,
        targetEmail: miembro.user.email,
        previousRole: miembro.role,
        newRole: nuevoRol,
      },
    });

    return {
      id: actualizado.id,
      userId: actualizado.userId,
      role: actualizado.role as RolColaboracion,
    };
  }

  async eliminarMiembro(
    workspaceId: string,
    targetUserId: string,
    principal: PrincipalAutenticado,
  ) {
    const { workspace } = await this.verificarRolMinimo(workspaceId, principal, 'admin');

    if (targetUserId === workspace.ownerUserId) {
      throw new ErrorConflicto('No se puede eliminar al propietario del espacio.');
    }

    const miembro = await this.#resolverMiembro(workspaceId, targetUserId);

    if (!miembro) {
      throw new ErrorNoEncontrado('El miembro no existe en este espacio.');
    }

    if (miembro.userId === workspace.ownerUserId) {
      throw new ErrorConflicto('No se puede eliminar al propietario del espacio.');
    }

    await this.prisma.client.workspaceMember.delete({
      where: { id: miembro.id },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.MIEMBRO_ELIMINADO,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: miembro.id,
      detalles: {
        removedUserId: miembro.userId,
        removedEmail: miembro.user.email,
      },
    });
  }

  async revocarInvitacion(
    workspaceId: string,
    invitationId: string,
    principal: PrincipalAutenticado,
  ) {
    await this.verificarRolMinimo(workspaceId, principal, 'admin');

    const inv = await this.prisma.client.invitation.findFirst({
      where: { id: invitationId, workspaceId },
    });
    if (!inv) {
      throw new ErrorNoEncontrado('La invitación no existe.');
    }

    await this.prisma.client.invitation.update({
      where: { id: inv.id },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.INVITACION_REVOCADA,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'invitation',
      recursoId: inv.id,
      detalles: { email: inv.email, role: inv.role },
    });
  }

  async listarHistorialModificaciones(
    workspaceId: string,
    principal: PrincipalAutenticado,
    opciones?: { collectionId?: string; limit?: number },
  ) {
    await this.verificarRolMinimo(workspaceId, principal, 'viewer');

    const limit = Math.min(Math.max(opciones?.limit ?? 80, 1), 200);

    const [auditRows, versionRows] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where: { workspaceId },
        include: {
          actorUser: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: { occurredAt: 'desc' },
        take: limit,
      }),
      this.prisma.client.collectionVersion.findMany({
        where: {
          collection: {
            workspaceId,
            ...(opciones?.collectionId ? { id: opciones.collectionId } : {}),
          },
        },
        include: {
          collection: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);

    return {
      changes: auditRows.map((row) => ({
        id: row.id.toString(),
        action: row.action,
        // En el esquema las columnas son `target_type` / `target_id`. Se
        // mantienen los nombres `resourceType`/`resourceId` en la RESPUESTA
        // porque son los que ya consume `apps/web`; lo que cambia es de donde
        // se leen, no el contrato HTTP.
        resourceType: row.targetType,
        resourceId: row.targetId,
        occurredAt: row.occurredAt.toISOString(),
        actor: row.actorUser
          ? {
              id: row.actorUser.id,
              email: row.actorUser.email,
              displayName: row.actorUser.displayName,
            }
          : null,
        details: (row.metadata ?? {}) as Record<string, unknown>,
      })),
      collectionVersions: versionRows.map((v) => ({
        id: v.id,
        collectionId: v.collectionId,
        collectionName: v.collection.name,
        versionNumber: v.versionNumber,
        label: v.label,
        changelog: v.changeSummary,
        createdAt: v.createdAt.toISOString(),
        createdBy: v.createdByUser,
        snapshot: v.snapshotInline,
      })),
    };
  }
}
