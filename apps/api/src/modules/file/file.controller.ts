import { Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Recurso, RequiereRolDeWorkspace, Usuario } from '../../platform/auth/decorators.ts';
import type { Principal } from '../../platform/auth/principal.ts';
import type { PeticionHttp } from '../../platform/http/http-types.ts';
import { ServicioDeFicheros } from './file.service.ts';
import { TipoDeMedioNoSoportado } from './file.tokens.ts';

/**
 * Las tres rutas del §2.2 del BRIEF-FASE7.
 *
 *     POST   /api/v1/workspaces/:workspaceId/files   multipart, campo `file`
 *     GET    /api/v1/files/:fileId                   metadatos, NUNCA bytes
 *     DELETE /api/v1/files/:fileId                   borrado lógico
 *
 * Dos controladores por el mismo motivo que en `request.controller.ts`: en la
 * subida el recurso que autoriza **es el workspace**; en las otras dos es el
 * fichero, que el guard resuelve a su workspace por el registro de
 * resolutores.
 *
 * Roles (matriz del ADR-0009 §7.5, sin inventar ninguno): subir y borrar son
 * escritura → `editor`; leer metadatos → `viewer`. Las mutantes exigen además
 * el testigo `x-ceiba-csrf`, que aplica el `GuardCsrf` global.
 *
 * **El cuerpo NO pasa por `PipeZod`.** No es JSON: es un `Buffer` que deja el
 * analizador de tipo de contenido registrado en `ModuloDeFicheros`. La
 * validación la hace el servicio, que es quien conoce el formato.
 */
@Controller('workspaces/:workspaceId/files')
export class ControladorDeSubidaDeFicheros {
  constructor(private readonly servicio: ServicioDeFicheros) {}

  @Post()
  @HttpCode(201)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'workspace', parametro: 'workspaceId' })
  async subir(
    @Usuario() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<Record<string, unknown>> {
    const cuerpo = cuerpoBinarioDe(peticion);
    const fichero = await this.servicio.subir(
      workspaceId,
      cuerpo,
      cabecera(peticion, 'content-type'),
      principal.usuarioId,
      ipDe(peticion),
    );
    return { file: fichero, fichero };
  }
}

@Controller('files')
export class ControladorDeFicheros {
  constructor(private readonly servicio: ServicioDeFicheros) {}

  @Get(':fileId')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'file', parametro: 'fileId' })
  async obtener(@Param('fileId') fileId: string): Promise<Record<string, unknown>> {
    const fichero = await this.servicio.obtener(fileId);
    return { file: fichero, fichero };
  }

  @Delete(':fileId')
  @HttpCode(204)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'file', parametro: 'fileId' })
  async borrar(
    @Usuario() principal: Principal,
    @Param('fileId') fileId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<void> {
    await this.servicio.borrar(fileId, principal.usuarioId, ipDe(peticion));
  }
}

/**
 * El analizador registrado devuelve un `Buffer`. Si llega otra cosa es que el
 * `Content-Type` no era multipart y Fastify usó otro analizador: 415, no un
 * 500 por intentar leer propiedades de un objeto cualquiera.
 */
function cuerpoBinarioDe(peticion: PeticionHttp): Buffer {
  const cuerpo = (peticion as unknown as { body?: unknown }).body;
  if (Buffer.isBuffer(cuerpo)) return cuerpo;
  throw new TipoDeMedioNoSoportado(
    'Esta ruta sólo acepta multipart/form-data con el campo «file».',
  );
}

function cabecera(peticion: PeticionHttp, nombre: string): string | undefined {
  const cabeceras = (peticion as unknown as { headers?: Record<string, unknown> }).headers ?? {};
  const valor = cabeceras[nombre];
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor) && typeof valor[0] === 'string') return valor[0];
  return undefined;
}

function ipDe(peticion: PeticionHttp): string {
  return peticion.ip ?? '0.0.0.0';
}
