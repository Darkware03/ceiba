import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Recurso, RequiereRolDeWorkspace, Usuario } from '../../platform/auth/decorators.ts';
import type { Principal } from '../../platform/auth/principal.ts';
import { PipeZod } from '../../platform/validation/zod.pipe.ts';
import type { PeticionHttp } from '../../platform/http/http-types.ts';
import type { FilaColeccion } from '../../platform/persistence/records.ts';
import { esquemaSlug } from '../workspace/dto/workspace.dto.ts';
import { ServicioDeColecciones } from './collection.service.ts';

export const esquemaCrearColeccion = z.object({
  slug: esquemaSlug,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
});

export const esquemaActualizarColeccion = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'no hay nada que actualizar',
  });

/**
 * Rutas de colecciones, en dos controladores por una razón concreta:
 *
 *  - Las de **creación y listado** cuelgan del workspace
 *    (`/workspaces/:workspaceId/collections`), porque ahí el recurso a resolver
 *    ES el workspace.
 *  - Las de **un elemento** cuelgan de `/collections/:collectionId`, porque ahí
 *    hay que resolver la colección a su `workspace_id` antes de autorizar. Es
 *    literalmente el §19 del prompt maestro: «no permitas que conocer un ID sea
 *    suficiente para acceder a un recurso privado».
 */
@Controller('workspaces/:workspaceId/collections')
export class ControladorDeColeccionesDeWorkspace {
  constructor(private readonly servicio: ServicioDeColecciones) {}

  @Post()
  @HttpCode(201)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async crear(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body(new PipeZod(esquemaCrearColeccion)) cuerpo: z.infer<typeof esquemaCrearColeccion>,
    @Req() peticion: PeticionHttp,
  ): Promise<{ coleccion: unknown }> {
    const fila = await this.servicio.crear(
      workspaceId,
      { slug: cuerpo.slug, name: cuerpo.name, description: cuerpo.description ?? null },
      principal.usuarioId,
      ipDe(peticion),
    );
    return { coleccion: vista(fila) };
  }

  @Get()
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async listar(@Param('workspaceId') workspaceId: string): Promise<{ colecciones: unknown[] }> {
    const filas = await this.servicio.listar(workspaceId);
    return { colecciones: filas.map(vista) };
  }
}

@Controller('collections')
export class ControladorDeColecciones {
  constructor(private readonly servicio: ServicioDeColecciones) {}

  @Get(':collectionId')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async obtener(@Param('collectionId') collectionId: string): Promise<{ coleccion: unknown }> {
    return { coleccion: vista(await this.servicio.obtener(collectionId)) };
  }

  @Patch(':collectionId')
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async actualizar(
    @Usuario() principal: Principal,
    @Param('collectionId') collectionId: string,
    @Body(new PipeZod(esquemaActualizarColeccion))
    cuerpo: z.infer<typeof esquemaActualizarColeccion>,
    @Req() peticion: PeticionHttp,
  ): Promise<{ coleccion: unknown }> {
    const fila = await this.servicio.actualizar(
      collectionId,
      cuerpo,
      principal.usuarioId,
      ipDe(peticion),
    );
    return { coleccion: vista(fila) };
  }

  @Delete(':collectionId')
  @HttpCode(204)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async borrar(
    @Usuario() principal: Principal,
    @Param('collectionId') collectionId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<void> {
    await this.servicio.borrar(collectionId, principal.usuarioId, ipDe(peticion));
  }
}

function vista(fila: FilaColeccion): Record<string, unknown> {
  return {
    id: fila.id,
    workspaceId: fila.workspaceId,
    slug: fila.slug,
    name: fila.name,
    description: fila.description,
    visibility: fila.visibility,
    status: fila.status,
    lockVersion: fila.lockVersion,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

function ipDe(peticion: PeticionHttp): string {
  return peticion.ip ?? '0.0.0.0';
}
