import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';
import { Recurso, RequiereRolDeWorkspace, Usuario } from '../../platform/auth/decorators.ts';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../../platform/config/app-config.ts';
import { idDeUsuario, type Principal } from '../../platform/auth/principal.ts';
import { PipeZod } from '../../platform/validation/zod.pipe.ts';
import type { PeticionHttp } from '../../platform/http/http-types.ts';
import { esquemaCrearEnlace, esquemaRotarCodigo } from './dto/sharing.dto.ts';
import {
  ServicioDeAdministracionDeComparticion,
  vistaDeCodigo,
  vistaDeEnlace,
  type VistaDeEnlace,
} from './sharing-admin.service.ts';
import { RepositorioDeComparticion } from './sharing.repository.ts';
import type { PermisoDeComparticion } from './share-policy.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * RUTAS DEL PROPIETARIO. Dos controladores, por la misma razón que en
 * `collection.controller.ts`:
 *
 *  - lo que cuelga de la **colección** resuelve el recurso `collection`;
 *  - lo que cuelga de **un enlace** resuelve el recurso `shared_link`, que
 *    `ServicioDeAdministracionDeComparticion` registra como resolutor.
 *
 * En ningún caso se autoriza por posesión del identificador: el guard traduce
 * el recurso a su `workspace_id` y consulta `workspace_members`.
 *
 * `editor` y no `viewer` para crear, rotar y revocar: publicar una colección es
 * una decisión de escritura sobre su visibilidad. Leer la lista de enlaces y la
 * auditoría sí baja a `viewer`, que es quien ya puede ver la colección.
 * ════════════════════════════════════════════════════════════════════════════
 */
@Controller('collections/:collectionId/shares')
export class ControladorDeComparticionDeColeccion {
  constructor(
    private readonly admin: ServicioDeAdministracionDeComparticion,
    private readonly repo: RepositorioDeComparticion,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
  ) {}

  @Post()
  @HttpCode(201)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async crear(
    @Usuario() principal: Principal,
    @Param('collectionId') collectionId: string,
    @Body(new PipeZod(esquemaCrearEnlace)) cuerpo: z.infer<typeof esquemaCrearEnlace>,
    @Req() peticion: PeticionHttp,
  ): Promise<{
    share: VistaDeEnlace;
    inviteUrl: string;
    accessCode: string | null;
    aviso: string;
  }> {
    const workspaceId = workspaceDe(peticion);
    const creado = await this.admin.crearEnlace(
      collectionId,
      workspaceId,
      {
        permission: cuerpo.permission as PermisoDeComparticion,
        requiresAccessCode: cuerpo.requiresAccessCode,
        allowExport: cuerpo.allowExport,
        allowExecution: cuerpo.allowExecution,
        includeExamples: cuerpo.includeExamples,
        expiresAt: cuerpo.expiresAt ?? null,
        maxViews: cuerpo.maxViews ?? null,
        codeLabel: cuerpo.codeLabel ?? null,
        codeExpiresAt: cuerpo.codeExpiresAt ?? null,
        codeMaxUses: cuerpo.codeMaxUses ?? null,
        guardarPista: cuerpo.storeHint,
      },
      idDeUsuario(principal),
      ipDe(peticion),
    );

    const vista = vistaDeEnlace(creado.enlace, creado.codigo, this.config.urlPublica);

    return {
      share: vista,
      // FASE 7, P7 — campo ADITIVO, mismo valor que `share.url`.
      //
      // No es redundancia gratuita: la prueba de aceptación de P7 es que el
      // frontend obtenga «en UNA sola llamada un enlace que se pueda pegar en un
      // chat», tanto de un workspace como de una colección. El workspace lo
      // devuelve en `inviteUrl` (`studio-collab.service.ts`), así que la
      // colección lo devuelve con EL MISMO NOMBRE. Un solo campo que leer en los
      // dos casos, en vez de que la interfaz tenga que saber de qué tipo de
      // recurso venía la respuesta para elegir dónde mirar.
      //
      // `share.url` se conserva intacto: hay pruebas de la fase 5 que lo leen.
      inviteUrl: vista.url,
      // ÚNICA vez que el código sale de la API. No hay ninguna ruta que lo
      // devuelva después, porque no existe en ninguna columna.
      accessCode: creado.codigoEnClaro,
      aviso:
        'El código se muestra una sola vez y no se puede recuperar: no se guarda en claro ' +
        'en ninguna parte. Si se pierde, rota el código.',
    };
  }

  @Get()
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'collection', parametro: 'collectionId' })
  async listar(
    @Param('collectionId') collectionId: string,
  ): Promise<{ shares: readonly VistaDeEnlace[]; visibility: string | null }> {
    return {
      shares: await this.admin.listarEnlaces(collectionId, this.config.urlPublica),
      visibility: await this.repo.leerVisibilidad(collectionId),
    };
  }
}

@Controller('shares/:sharedLinkId')
export class ControladorDeEnlacesCompartidos {
  constructor(
    private readonly admin: ServicioDeAdministracionDeComparticion,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
  ) {}

  @Get()
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'shared_link', parametro: 'sharedLinkId' })
  async obtener(
    @Param('sharedLinkId') sharedLinkId: string,
  ): Promise<{ share: VistaDeEnlace; liveSessions: number }> {
    return {
      share: await this.admin.obtenerEnlace(sharedLinkId, this.config.urlPublica),
      liveSessions: await this.admin.sesionesVivas(sharedLinkId),
    };
  }

  /**
   * Revocación. C-CODE-06: efecto **inmediato** y **en cascada** sobre todas
   * las sesiones abiertas desde el enlace, en la misma transacción.
   */
  @Post('revoke')
  @HttpCode(200)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'shared_link', parametro: 'sharedLinkId' })
  async revocar(
    @Usuario() principal: Principal,
    @Param('sharedLinkId') sharedLinkId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<{ revokedSessions: number; revokedCodes: number }> {
    const efecto = await this.admin.revocarEnlace(
      sharedLinkId,
      idDeUsuario(principal),
      ipDe(peticion),
    );
    return { revokedSessions: efecto.sesionesRevocadas, revokedCodes: efecto.codigosRevocados };
  }

  @Post('codes')
  @HttpCode(201)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'shared_link', parametro: 'sharedLinkId' })
  async rotarCodigo(
    @Usuario() principal: Principal,
    @Param('sharedLinkId') sharedLinkId: string,
    @Body(new PipeZod(esquemaRotarCodigo)) cuerpo: z.infer<typeof esquemaRotarCodigo>,
    @Req() peticion: PeticionHttp,
  ): Promise<{ code: unknown; accessCode: string; closedSessions: number }> {
    const rotado = await this.admin.rotarCodigo(
      sharedLinkId,
      {
        codeLabel: cuerpo.codeLabel ?? null,
        codeExpiresAt: cuerpo.codeExpiresAt ?? null,
        codeMaxUses: cuerpo.codeMaxUses ?? null,
        guardarPista: cuerpo.storeHint,
      },
      idDeUsuario(principal),
      ipDe(peticion),
    );
    return {
      code: vistaDeCodigo(rotado.codigo),
      accessCode: rotado.codigoEnClaro,
      closedSessions: rotado.sesionesCerradas,
    };
  }

  @Delete('codes/:codeId')
  @HttpCode(200)
  @RequiereRolDeWorkspace('editor')
  @Recurso({ tipo: 'shared_link', parametro: 'sharedLinkId' })
  async revocarCodigo(
    @Usuario() principal: Principal,
    @Param('sharedLinkId') sharedLinkId: string,
    @Param('codeId') codeId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<{ closedSessions: number }> {
    const efecto = await this.admin.revocarCodigo(
      sharedLinkId,
      codeId,
      idDeUsuario(principal),
      ipDe(peticion),
    );
    return { closedSessions: efecto.sesionesCerradas };
  }

  /**
   * **La auditoría del propietario.** Aquí —y sólo aquí— la causa real de cada
   * rechazo es visible: `invalid_code`, `expired`, `revoked`, `rate_limited`,
   * `locked_out` o `success`. Desde fuera las tres primeras son la misma
   * respuesta, el mismo cuerpo y el mismo tiempo (C-CODE-04).
   *
   * No incluye el código intentado, ni entero ni parcial: `share_access_attempts`
   * no lo guarda, para no convertir el registro de seguridad en un diccionario.
   */
  @Get('audit')
  @RequiereRolDeWorkspace('viewer')
  @Recurso({ tipo: 'shared_link', parametro: 'sharedLinkId' })
  async auditoria(
    @Param('sharedLinkId') sharedLinkId: string,
    @Query('limit') limite?: string,
  ): Promise<{ attempts: unknown[]; summary: Record<string, number> }> {
    const tope = Math.min(Math.max(Number.parseInt(limite ?? '100', 10) || 100, 1), 500);
    const resultado = await this.admin.auditoriaDeEnlace(sharedLinkId, tope);
    return {
      attempts: resultado.intentos.map((intento) => ({
        id: intento.id,
        result: intento.result,
        shareAccessCodeId: intento.shareAccessCodeId,
        clientIpPrefix: intento.clientIpPrefix,
        attemptedAt: intento.attemptedAt.toISOString(),
      })),
      summary: { ...resultado.resumen },
    };
  }
}

function ipDe(peticion: PeticionHttp): string {
  return peticion.ip ?? '0.0.0.0';
}

/** El `GuardDeAutorizacion` deja aquí el workspace ya resuelto del recurso. */
function workspaceDe(peticion: PeticionHttp): string {
  const valor = (peticion as Record<string, unknown>)['ceibaWorkspaceId'];
  if (typeof valor !== 'string' || valor.length === 0) {
    // No debería ocurrir: el guard corre antes. Si ocurriera, fallar cerrado es
    // mejor que inventar un workspace.
    throw new Error('workspace no resuelto por el guard de autorización');
  }
  return valor;
}
