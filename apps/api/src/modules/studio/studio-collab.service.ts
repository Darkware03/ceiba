import { CLIENTE_PRISMA } from '../../platform/persistence/prisma/prisma-client.ts';
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import {
  ACCION_AUDITORIA,
  SERVICIO_DE_AUDITORIA,
  type ServicioDeAuditoria,
} from '../../platform/audit/ports.js';
import type { Principal as PrincipalAutenticado } from '../../platform/auth/principal.js';
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
  ): Promise<{ workspace: { id: string; name: string; slug: string; ownerId: string }; rol: RolColaboracion }> {
    const ws = await this.prisma.client.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, name: true, slug: true, ownerId: true },
    });
    if (!ws) {
      throw new ErrorNoEncontrado('El espacio de trabajo no existe.');
    }

    if (principal.esPlatformAdmin || ws.ownerId === principal.userId) {
      return { workspace: ws, rol: 'owner' };
    }

    const miembro = await this.prisma.client.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: principal.userId,
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
        where: { id: workspace.ownerId },
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
      role: m.userId === workspace.ownerId ? ('owner' as const) : (m.role as RolColaboracion),
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
        invitedBy: { select: { id: true, email: true, displayName: true } },
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
      invitedBy: inv.invitedBy,
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

    const rawToken = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    const creada = await this.prisma.client.invitation.create({
      data: {
        workspaceId,
        email: emailLimpio,
        role: rolAsignado,
        tokenHash,
        invitedByUserId: principal.userId,
        status: 'pending',
        expiresAt,
      },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.INVITACION_CREADA,
      actorUserId: principal.userId,
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
    const tokenLimpio = rawToken.trim();
    if (!tokenLimpio) {
      throw new ErrorValidacion('El token de invitación es obligatorio.');
    }
    const tokenHash = createHash('sha256').update(tokenLimpio).digest('hex');
    const inv = await this.prisma.client.invitation.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { id: true, name: true, slug: true, description: true } },
        invitedBy: { select: { id: true, email: true, displayName: true } },
      },
    });

    if (!inv) {
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
      invitedBy: inv.invitedBy,
    };
  }

  async aceptarInvitacion(rawToken: string, principal: PrincipalAutenticado) {
    const tokenLimpio = rawToken.trim();
    if (!tokenLimpio) {
      throw new ErrorValidacion('El token de invitación es obligatorio.');
    }
    const tokenHash = createHash('sha256').update(tokenLimpio).digest('hex');

    const inv = await this.prisma.client.invitation.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { id: true, name: true, slug: true, ownerId: true, deletedAt: true } },
      },
    });

    if (!inv || inv.workspace.deletedAt) {
      throw new ErrorNoEncontrado('La invitación no existe o el espacio fue eliminado.');
    }

    if (inv.status === 'revoked') {
      throw new ErrorConflicto('Esta invitación fue revocada por un administrador.');
    }

    if (inv.expiresAt.getTime() < Date.now()) {
      throw new ErrorConflicto('Esta invitación ha expirado.');
    }

    const rolFinal: RolColaboracion =
      inv.workspace.ownerId === principal.userId ? 'owner' : (inv.role as RolColaboracion);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: inv.workspaceId,
            userId: principal.userId,
          },
        },
        create: {
          workspaceId: inv.workspaceId,
          userId: principal.userId,
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
            acceptedByUserId: principal.userId,
          },
        });
      }
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.INVITACION_ACEPTADA,
      actorUserId: principal.userId,
      workspaceId: inv.workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: principal.userId,
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

  async cambiarRolMiembro(
    workspaceId: string,
    targetUserId: string,
    nuevoRol: 'viewer' | 'editor' | 'executor' | 'admin',
    principal: PrincipalAutenticado,
  ) {
    const { workspace } = await this.verificarRolMinimo(workspaceId, principal, 'admin');

    if (targetUserId === workspace.ownerId) {
      throw new ErrorConflicto('No se puede cambiar el rol del propietario del espacio.');
    }

    const miembro = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      include: { user: { select: { email: true, displayName: true } } },
    });

    if (!miembro) {
      throw new ErrorNoEncontrado('El usuario no es miembro de este espacio.');
    }

    const actualizado = await this.prisma.client.workspaceMember.update({
      where: { id: miembro.id },
      data: { role: nuevoRol },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.MIEMBRO_ROL_CAMBIADO,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: miembro.id,
      detalles: {
        targetUserId,
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

    if (targetUserId === workspace.ownerId) {
      throw new ErrorConflicto('No se puede eliminar al propietario del espacio.');
    }

    const miembro = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      include: { user: { select: { email: true, displayName: true } } },
    });

    if (!miembro) {
      throw new ErrorNoEncontrado('El miembro no existe en este espacio.');
    }

    await this.prisma.client.workspaceMember.delete({
      where: { id: miembro.id },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.MIEMBRO_ELIMINADO,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: miembro.id,
      detalles: {
        removedUserId: targetUserId,
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
      actorUserId: principal.userId,
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
          createdBy: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);

    return {
      changes: auditRows.map((row) => ({
        id: row.id.toString(),
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
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
        changelog: v.changelog,
        createdAt: v.createdAt.toISOString(),
        createdBy: v.createdBy,
        snapshot: v.snapshot,
      })),
    };
  }
}
