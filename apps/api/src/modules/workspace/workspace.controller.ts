import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { Recurso, RequiereRolDeWorkspace, Usuario } from '../../platform/auth/decorators.ts';
import type { Principal } from '../../platform/auth/principal.ts';
import { PipeZod } from '../../platform/validation/zod.pipe.ts';
import type { PeticionHttp } from '../../platform/http/http-types.ts';
import type { FilaMiembroDeWorkspace, FilaWorkspace } from '../../platform/persistence/records.ts';
import { ServicioDeWorkspaces } from './workspace.service.ts';
import {
  esquemaActualizarWorkspace,
  esquemaAnadirMiembro,
  esquemaCambiarRol,
  esquemaCrearWorkspace,
  type EntradaActualizarWorkspace,
  type EntradaAnadirMiembro,
  type EntradaCambiarRol,
  type EntradaCrearWorkspace,
} from './dto/workspace.dto.ts';

/**
 * Familias «Workspaces» y «Miembros» de la §19.
 *
 * Cada ruta acotada a un workspace declara **las dos** cosas: el rol mínimo
 * (`@RequiereRolDeWorkspace`) y de dónde sale el recurso (`@Recurso`). Si
 * faltara el segundo, el guard **deniega**: un decorador olvidado no abre la
 * puerta. `test/route-inventory.test.ts` comprueba además que ninguna ruta con
 * `:workspaceId` o `:collectionId` se quede sin ellos.
 *
 * Los roles salen de la matriz normativa del ADR-0009 §7.5:
 *   - leer            -> `viewer`
 *   - ajustes/miembros-> `admin`
 *   - borrar          -> `owner`
 */
@Controller('workspaces')
export class ControladorDeWorkspaces {
  constructor(private readonly servicio: ServicioDeWorkspaces) {}

  @Post()
  @HttpCode(201)
  async crear(
    @Usuario() principal: Principal,
    @Body(new PipeZod(esquemaCrearWorkspace)) cuerpo: EntradaCrearWorkspace,
    @Req() peticion: PeticionHttp,
  ): Promise<{ workspace: unknown }> {
    const fila = await this.servicio.crear(
      principal.usuarioId,
      {
        slug: cuerpo.slug,
        name: cuerpo.name,
        description: cuerpo.description ?? null,
      },
      ipDe(peticion),
    );
    return { workspace: vistaWorkspace(fila) };
  }

  /** Sólo los workspaces donde el usuario tiene membresía activa. */
  @Get()
  async listar(@Usuario() principal: Principal): Promise<{ workspaces: unknown[] }> {
    const filas = await this.servicio.listarDeUsuario(principal.usuarioId);
    return { workspaces: filas.map(vistaWorkspace) };
  }

  @Get(':workspaceId')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async obtener(@Param('workspaceId') workspaceId: string): Promise<{ workspace: unknown }> {
    return { workspace: vistaWorkspace(await this.servicio.obtener(workspaceId)) };
  }

  @Patch(':workspaceId')
  @RequiereRolDeWorkspace('admin')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async actualizar(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body(new PipeZod(esquemaActualizarWorkspace)) cuerpo: EntradaActualizarWorkspace,
    @Req() peticion: PeticionHttp,
  ): Promise<{ workspace: unknown }> {
    const fila = await this.servicio.actualizar(
      workspaceId,
      principal.usuarioId,
      cuerpo,
      ipDe(peticion),
    );
    return { workspace: vistaWorkspace(fila) };
  }

  @Delete(':workspaceId')
  @HttpCode(204)
  @RequiereRolDeWorkspace('owner')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async borrar(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<void> {
    await this.servicio.borrar(workspaceId, principal.usuarioId, ipDe(peticion));
  }

  // -------------------------------------------------------------------------

  @Get(':workspaceId/members')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async listarMiembros(
    @Param('workspaceId') workspaceId: string,
  ): Promise<{ miembros: unknown[] }> {
    const filas = await this.servicio.listarMiembros(workspaceId);
    return { miembros: filas.map(vistaMiembro) };
  }

  @Post(':workspaceId/members')
  @HttpCode(201)
  @RequiereRolDeWorkspace('admin')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async anadirMiembro(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body(new PipeZod(esquemaAnadirMiembro)) cuerpo: EntradaAnadirMiembro,
    @Req() peticion: PeticionHttp,
  ): Promise<{ miembro: unknown }> {
    const miembro = await this.servicio.anadirMiembro(
      workspaceId,
      cuerpo.email,
      cuerpo.role,
      principal.usuarioId,
      ipDe(peticion),
    );
    return { miembro: vistaMiembro(miembro) };
  }

  @Patch(':workspaceId/members/:usuarioId')
  @RequiereRolDeWorkspace('admin')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async cambiarRol(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('usuarioId') usuarioId: string,
    @Body(new PipeZod(esquemaCambiarRol)) cuerpo: EntradaCambiarRol,
    @Req() peticion: PeticionHttp,
  ): Promise<{ miembro: unknown }> {
    const miembro = await this.servicio.cambiarRol(
      workspaceId,
      usuarioId,
      cuerpo.role,
      principal.usuarioId,
      ipDe(peticion),
    );
    return { miembro: vistaMiembro(miembro) };
  }

  @Delete(':workspaceId/members/:usuarioId')
  @HttpCode(204)
  @RequiereRolDeWorkspace('admin')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async expulsar(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('usuarioId') usuarioId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<void> {
    await this.servicio.expulsar(workspaceId, usuarioId, principal.usuarioId, ipDe(peticion));
  }
}

function vistaWorkspace(fila: FilaWorkspace): Record<string, unknown> {
  return {
    id: fila.id,
    slug: fila.slug,
    name: fila.name,
    description: fila.description,
    ownerUserId: fila.ownerUserId,
    status: fila.status,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

function vistaMiembro(fila: FilaMiembroDeWorkspace): Record<string, unknown> {
  return {
    id: fila.id,
    workspaceId: fila.workspaceId,
    userId: fila.userId,
    role: fila.role,
    status: fila.status,
    joinedAt: fila.joinedAt.toISOString(),
  };
}

/** La IP ya viene resuelta por el `trustProxy` acotado (ADR-0009 §6.1). */
function ipDe(peticion: PeticionHttp): string {
  return peticion.ip ?? '0.0.0.0';
}
