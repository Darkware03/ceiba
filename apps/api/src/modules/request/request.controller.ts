import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Recurso, RequiereRolDeWorkspace, Usuario } from '../../platform/auth/decorators.ts';
import type { Principal } from '../../platform/auth/principal.ts';
import { PipeZod } from '../../platform/validation/zod.pipe.ts';
import type { PeticionHttp } from '../../platform/http/http-types.ts';
import {
  esquemaActualizarPeticion,
  esquemaCrearPeticion,
  esquemaDuplicarPeticion,
} from './dto/request.dto.ts';
import { ServicioDePeticiones, vistaDetalle } from './request.service.ts';

/**
 * Las 7 rutas del `BRIEF-FASE6` §1, en dos controladores por el mismo motivo
 * que en `collection.controller.ts`:
 *
 *  - Listar y crear cuelgan de `/collections/:collectionId/requests`, porque
 *    ahí el recurso que hay que resolver **es la colección**.
 *  - El resto cuelga de `/requests/:requestId`, y ahí el recurso es la
 *    petición, que el guard resuelve a su colección y de ahí al workspace.
 *
 * TODAS llevan `@RequiereRolDeWorkspace` + `@Recurso`. Sin el par, el guard
 * lanza 403 por «ruta mal configurada»: falla cerrado a propósito. Los roles
 * salen de la matriz del ADR-0009 §7.5 tal cual está en
 * `platform/guards/roles.ts`: `collection.read` → `viewer`,
 * `collection.write` → `editor` («crear/modificar/borrar colecciones, carpetas,
 * solicitudes»). No se inventa ninguno.
 *
 * Las mutantes exigen además el testigo `x-ceiba-csrf`, que aplica `GuardCsrf`
 * global. Aquí no se repite nada de eso.
 */
@Controller('collections/:collectionId/requests')
export class ControladorDePeticionesDeColeccion {
  constructor(private readonly servicio: ServicioDePeticiones) {}

  /** 1 · `GET /collections/:collectionId/requests` — árbol: carpetas + orden. */
  @Get()
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async listar(@Param('collectionId') collectionId: string): Promise<Record<string, unknown>> {
    const { peticiones, carpetas } = await this.servicio.listar(collectionId);
    return {
      collectionId,
      requests: peticiones,
      peticiones,
      folders: carpetas,
      carpetas,
      total: peticiones.length,
    };
  }

  /** 2 · `POST /collections/:collectionId/requests` */
  @Post()
  @HttpCode(201)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async crear(
    @Usuario() principal: Principal,
    @Param('collectionId') collectionId: string,
    @Body(new PipeZod(esquemaCrearPeticion)) cuerpo: z.infer<typeof esquemaCrearPeticion>,
    @Req() peticion: PeticionHttp,
  ): Promise<Record<string, unknown>> {
    const fila = await this.servicio.crear(
      collectionId,
      cuerpo,
      principal.usuarioId,
      ipDe(peticion),
    );
    return respuesta(fila);
  }
}

@Controller('requests')
export class ControladorDePeticiones {
  constructor(private readonly servicio: ServicioDePeticiones) {}

  /** 3 · `GET /requests/:requestId` */
  @Get(':requestId')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'request', parametro: 'requestId' })
  async obtener(@Param('requestId') requestId: string): Promise<Record<string, unknown>> {
    return respuesta(await this.servicio.obtener(requestId));
  }

  /** 7 · `GET /requests/:requestId/curl` — antes del `:requestId` genérico no
   * hace falta ordenarla: Nest distingue por número de segmentos. */
  @Get(':requestId/curl')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'request', parametro: 'requestId' })
  async curl(
    @Usuario() principal: Principal,
    @Param('requestId') requestId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<Record<string, unknown>> {
    const resultado = await this.servicio.comoCurl(
      requestId,
      principal.usuarioId,
      ipDe(peticion),
    );
    return {
      curl: resultado.curl,
      advertencias: resultado.advertencias,
      // Alias en inglés para el cliente; es el MISMO array.
      warnings: resultado.advertencias,
    };
  }

  /** 4 · `PATCH /requests/:requestId` */
  @Patch(':requestId')
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'request', parametro: 'requestId' })
  async actualizar(
    @Usuario() principal: Principal,
    @Param('requestId') requestId: string,
    @Body(new PipeZod(esquemaActualizarPeticion))
    cuerpo: z.infer<typeof esquemaActualizarPeticion>,
    @Req() peticion: PeticionHttp,
  ): Promise<Record<string, unknown>> {
    const fila = await this.servicio.actualizar(
      requestId,
      cuerpo,
      principal.usuarioId,
      ipDe(peticion),
    );
    return respuesta(fila);
  }

  /** 5 · `DELETE /requests/:requestId` — borrado **lógico**. */
  @Delete(':requestId')
  @HttpCode(204)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'request', parametro: 'requestId' })
  async borrar(
    @Usuario() principal: Principal,
    @Param('requestId') requestId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<void> {
    await this.servicio.borrar(requestId, principal.usuarioId, ipDe(peticion));
  }

  /** 6 · `POST /requests/:requestId/duplicate` */
  @Post(':requestId/duplicate')
  @HttpCode(201)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'request', parametro: 'requestId' })
  async duplicar(
    @Usuario() principal: Principal,
    @Param('requestId') requestId: string,
    @Body(new PipeZod(esquemaDuplicarPeticion)) cuerpo: z.infer<typeof esquemaDuplicarPeticion>,
    @Req() peticion: PeticionHttp,
  ): Promise<Record<string, unknown>> {
    const fila = await this.servicio.duplicar(
      requestId,
      cuerpo,
      principal.usuarioId,
      ipDe(peticion),
    );
    return respuesta(fila);
  }
}

/** Envoltorio único de respuesta, con alias castellano/inglés del mismo objeto. */
function respuesta(fila: Parameters<typeof vistaDetalle>[0]): Record<string, unknown> {
  const vista = vistaDetalle(fila);
  return { request: vista, peticion: vista };
}

function ipDe(peticion: PeticionHttp): string {
  return peticion.ip ?? '0.0.0.0';
}
