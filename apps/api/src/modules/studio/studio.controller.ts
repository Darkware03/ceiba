import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import {
  UsuarioActual as PrincipalActual,
  RutaSinAutorizacionDeRecurso as RutaAutenticadaSinRecurso,
} from '../../platform/auth/decorators.js';
import { idDeUsuario, type PrincipalUsuario } from '../../platform/auth/principal.js';
import {
  StudioCollaborationService,
  type RolColaboracion,
} from './studio-collab.service.js';
import {
  StudioService,
  type EjecutarPeticionInput,
  type VariableEntornoInput,
} from './studio-core.service.js';

@Controller()
export class StudioController {
  constructor(
    @Inject(StudioService) private readonly studio: StudioService,
    @Inject(StudioCollaborationService)
    private readonly collaboration: StudioCollaborationService,
  ) {}

  @Get('workspaces/:workspaceId/settings')
  @RutaAutenticadaSinRecurso()
  async getSettings(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.studio.obtenerConfiguracionWorkspace(workspaceId, principal);
  }

  @Patch('workspaces/:workspaceId/settings')
  @RutaAutenticadaSinRecurso()
  async updateSettings(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      requestHistoryDays?: number;
      collectionRunsDays?: number;
      auditLogsDays?: number;
      versionSnapshotsKeep?: number;
      retention?: {
        requestHistoryDays?: number;
        collectionRunsDays?: number;
        auditLogsDays?: number;
        versionSnapshotsKeep?: number;
      };
    },
  ) {
    return this.studio.actualizarConfiguracionWorkspace(
      workspaceId,
      {
        name: body?.name,
        description: body?.description,
        requestHistoryDays: body?.requestHistoryDays ?? body?.retention?.requestHistoryDays,
        collectionRunsDays: body?.collectionRunsDays ?? body?.retention?.collectionRunsDays,
        auditLogsDays: body?.auditLogsDays ?? body?.retention?.auditLogsDays,
        versionSnapshotsKeep:
          body?.versionSnapshotsKeep ?? body?.retention?.versionSnapshotsKeep,
      },
      principal,
    );
  }

  @Get('workspaces/:workspaceId/collaboration')
  @RutaAutenticadaSinRecurso()
  async getCollaboration(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    const [members, invitations] = await Promise.all([
      this.collaboration.listarMiembros(workspaceId, principal),
      this.collaboration.listarInvitaciones(workspaceId, principal),
    ]);
    return { workspaceId, members, invitations };
  }

  @Get('workspaces/:workspaceId/invitations')
  @RutaAutenticadaSinRecurso()
  async listInvitations(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    const invitations = await this.collaboration.listarInvitaciones(workspaceId, principal);
    return { items: invitations, invitations };
  }

  @Post('workspaces/:workspaceId/invitations')
  @RutaAutenticadaSinRecurso()
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body()
    body: {
      email?: string;
      role?: RolColaboracion;
      mode?: 'view' | 'edit';
      expiresInDays?: number;
    },
  ) {
    const role: 'viewer' | 'editor' | 'executor' | 'admin' =
      body?.role && body.role !== 'owner'
        ? body.role
        : body?.mode === 'view'
          ? 'viewer'
          : 'editor';

    const created = await this.collaboration.crearInvitacion(
      workspaceId,
      {
        email: body?.email,
        role,
        expiresInDays: body?.expiresInDays,
      },
      principal,
    );
    return {
      ...created,
      invitation: created,
    };
  }

  @Put('workspaces/:workspaceId/members/:memberId/role')
  @RutaAutenticadaSinRecurso()
  async updateMemberRolePut(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body() body: { role?: RolColaboracion; mode?: 'view' | 'edit' },
  ) {
    const role: 'viewer' | 'editor' | 'executor' | 'admin' =
      body?.role && body.role !== 'owner'
        ? body.role
        : body?.mode === 'view'
          ? 'viewer'
          : 'editor';
    return this.collaboration.cambiarRolMiembro(workspaceId, memberId, role, principal);
  }

  @Delete('workspaces/:workspaceId/collaboration/members/:memberId')
  @RutaAutenticadaSinRecurso()
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.collaboration.eliminarMiembro(workspaceId, memberId, principal);
  }

  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  @RutaAutenticadaSinRecurso()
  async revokeInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('invitationId') invitationId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.collaboration.revocarInvitacion(workspaceId, invitationId, principal);
  }

  @Get('invitations/:token')
  @RutaAutenticadaSinRecurso()
  async getInvitationByToken(@Param('token') token: string) {
    const invitation = await this.collaboration.obtenerInvitacionPorToken(token);
    return { ...invitation, invitation };
  }

  @Post('invitations/:token/accept')
  @RutaAutenticadaSinRecurso()
  async acceptInvitationByToken(
    @Param('token') token: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.collaboration.aceptarInvitacion(token, principal);
  }

  @Get('workspaces/:workspaceId/environments')
  @RutaAutenticadaSinRecurso()
  async listEnvironments(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    const items = await this.studio.listarEntornos(workspaceId, principal);
    return { items, environments: items };
  }

  @Post('workspaces/:workspaceId/environments')
  @RutaAutenticadaSinRecurso()
  @HttpCode(HttpStatus.CREATED)
  async createEnvironment(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body()
    body: {
      name: string;
      description?: string | null;
      color?: string | null;
      isDefault?: boolean;
      variables?: VariableEntornoInput[];
    },
  ) {
    const environment = await this.studio.crearEntorno(
      workspaceId,
      {
        name: body?.name ?? '',
        description: body?.description,
        color: body?.color,
        isDefault: body?.isDefault,
        variables: body?.variables,
      },
      principal,
    );
    return { ...environment, environment };
  }

  @Put('workspaces/:workspaceId/environments/:environmentId')
  @RutaAutenticadaSinRecurso()
  async updateEnvironmentInWorkspace(
    @Param('environmentId') environmentId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      color?: string | null;
      isDefault?: boolean;
      variables?: VariableEntornoInput[];
    },
  ) {
    const environment = await this.studio.actualizarEntorno(environmentId, body ?? {}, principal);
    return { ...environment, environment };
  }

  @Patch('environments/:environmentId')
  @RutaAutenticadaSinRecurso()
  async updateEnvironmentDirect(
    @Param('environmentId') environmentId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body()
    body: {
      name?: string;
      description?: string | null;
      color?: string | null;
      isDefault?: boolean;
      variables?: VariableEntornoInput[];
    },
  ) {
    const environment = await this.studio.actualizarEntorno(environmentId, body ?? {}, principal);
    return { ...environment, environment };
  }

  @Delete('workspaces/:workspaceId/environments/:environmentId')
  @RutaAutenticadaSinRecurso()
  async deleteEnvironmentInWorkspace(
    @Param('environmentId') environmentId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.studio.eliminarEntorno(environmentId, principal);
  }

  @Delete('environments/:environmentId')
  @RutaAutenticadaSinRecurso()
  async deleteEnvironmentDirect(
    @Param('environmentId') environmentId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.studio.eliminarEntorno(environmentId, principal);
  }

  @Post('workspaces/:workspaceId/execute')
  @RutaAutenticadaSinRecurso()
  async executeInWorkspace(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body() body: EjecutarPeticionInput,
  ) {
    return this.studio.ejecutarPeticion(workspaceId, body, principal);
  }

  @Post('requests/execute')
  @RutaAutenticadaSinRecurso()
  async executeLegacy(
    @PrincipalActual() principal: PrincipalUsuario,
    @Body()
    body: {
      workspaceId?: string;
      requestId?: string | null;
      environmentId?: string | null;
      metodo?: string;
      method?: string;
      url?: string;
      cabeceras?: Array<{ clave?: string; valor?: string; activa?: boolean }>;
      headers?: Array<{ key: string; value: string; enabled?: boolean }>;
      parametrosConsulta?: Array<{ clave?: string; valor?: string; activa?: boolean }>;
      queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
      cuerpo?: { tipo?: string; contenido?: string };
      bodyType?: string;
      body?: string | null;
      timeoutMs?: number;
    },
  ) {
    let wsId = body?.workspaceId;
    if (!wsId) {
      // `ownerUserId` y `workspaceMembers`: ni `ownerId` ni `members` existen en
      // el modelo `Workspace`. Con la fachada en `any` esto compilaba y Prisma
      // lo rechazaba en ejecucion con `PrismaClientValidationError`.
      const firstWs = await this.studio['prisma'].client.workspace.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { ownerUserId: idDeUsuario(principal) },
            { workspaceMembers: { some: { userId: idDeUsuario(principal) } } },
          ],
        },
        select: { id: true },
      });
      wsId = firstWs?.id ?? '';
    }

    const headers =
      body?.headers ??
      (body?.cabeceras ?? []).map((h) => ({
        key: String(h.clave ?? ''),
        value: String(h.valor ?? ''),
        enabled: h.activa !== false,
      }));
    const queryParams =
      body?.queryParams ??
      (body?.parametrosConsulta ?? []).map((q) => ({
        key: String(q.clave ?? ''),
        value: String(q.valor ?? ''),
        enabled: q.activa !== false,
      }));
    const rawBodyType = body?.bodyType ?? body?.cuerpo?.tipo ?? 'none';
    const bodyType =
      rawBodyType === 'ninguno' ? 'none' : rawBodyType === 'texto' ? 'raw' : rawBodyType;
    const bodyText = body?.body ?? body?.cuerpo?.contenido ?? null;

    return this.studio.ejecutarPeticion(
      wsId ?? '',
      {
        requestId: body?.requestId ?? null,
        environmentId: body?.environmentId ?? null,
        method: String(body?.method ?? body?.metodo ?? 'GET'),
        url: String(body?.url ?? ''),
        headers,
        queryParams,
        bodyType,
        body: bodyText,
        timeoutMs: body?.timeoutMs,
      },
      principal,
    );
  }

  @Get('workspaces/:workspaceId/history/requests')
  @RutaAutenticadaSinRecurso()
  async listRequestHistory(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Query('limit') limit?: string,
  ) {
    const items = await this.studio.listarHistorialPeticiones(
      workspaceId,
      principal,
      limit ? Number(limit) : 100,
    );
    return { items };
  }

  @Get('workspaces/:workspaceId/history/changes')
  @RutaAutenticadaSinRecurso()
  async listChangeHistory(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Query('limit') limit?: string,
  ) {
    return this.collaboration.listarHistorialModificaciones(
      workspaceId,
      principal,
      { limit: limit ? Number(limit) : 100 },
    );
  }

  @Get('workspaces/:workspaceId/history')
  @RutaAutenticadaSinRecurso()
  async getCombinedHistory(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Query('limit') limit?: string,
  ) {
    const max = limit ? Number(limit) : 100;
    const [requests, changes] = await Promise.all([
      this.studio.listarHistorialPeticiones(workspaceId, principal, max),
      this.collaboration.listarHistorialModificaciones(workspaceId, principal, { limit: max }),
    ]);
    return {
      requests,
      auditLogs: (changes as any).auditLogs ?? changes.changes,
      collectionVersions: changes.collectionVersions,
    };
  }

  @Get('workspaces/:workspaceId/runs')
  @RutaAutenticadaSinRecurso()
  async listRuns(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    const items = await this.studio.listarEjecucionesColeccion(workspaceId, principal);
    return { items, runs: items };
  }

  @Post('workspaces/:workspaceId/runs')
  @RutaAutenticadaSinRecurso()
  @HttpCode(HttpStatus.CREATED)
  async runCollection(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body() body: { collectionId: string; environmentId?: string | null },
  ) {
    const run = await this.studio.ejecutarColeccion(
      workspaceId,
      String(body?.collectionId ?? ''),
      body?.environmentId ?? null,
      principal,
    );
    return { ...run, run };
  }

  @Get('workspaces/:workspaceId/documentation')
  @RutaAutenticadaSinRecurso()
  async getDocumentation(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.studio.generarDocumentacion(workspaceId, principal);
  }

  @Get('workspaces/:workspaceId/collections/:collectionId/export')
  @RutaAutenticadaSinRecurso()
  async exportCollectionInWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Param('collectionId') collectionId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    return this.studio.exportarColeccion(workspaceId, collectionId, principal);
  }

  @Get('collections/:collectionId/export')
  @RutaAutenticadaSinRecurso()
  async exportCollectionDirect(
    @Param('collectionId') collectionId: string,
    @PrincipalActual() principal: PrincipalUsuario,
  ) {
    const col = await this.studio['prisma'].client.collection.findFirst({
      where: { id: collectionId, deletedAt: null },
      select: { workspaceId: true },
    });
    return this.studio.exportarColeccion(col?.workspaceId ?? '', collectionId, principal);
  }

  @Post('workspaces/:workspaceId/collections/import')
  @RutaAutenticadaSinRecurso()
  @HttpCode(HttpStatus.CREATED)
  async importCollection(
    @Param('workspaceId') workspaceId: string,
    @PrincipalActual() principal: PrincipalUsuario,
    @Body() body: Record<string, unknown>,
  ) {
    const payload =
      body && typeof body.bundle === 'object' && body.bundle !== null
        ? (body.bundle as Record<string, unknown>)
        : (body ?? {});
    return this.studio.importarColeccion(workspaceId, payload, principal);
  }
}
