import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { z } from 'zod';
import { Publico } from '../../platform/auth/decorators.ts';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../../platform/config/app-config.ts';
import { Inject } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { PipeZod } from '../../platform/validation/zod.pipe.ts';
import { CLAVE_PRINCIPAL, type Principal } from '../../platform/auth/principal.ts';
import { cabecera, type PeticionHttp, type RespuestaHttp } from '../../platform/http/http-types.ts';
import { esSlugAdmisible } from './access-code.ts';
import { esquemaAcceder } from './dto/sharing.dto.ts';
import { ServicioDeAccesoCompartido } from './share-access.service.ts';
import { ServicioDeContenidoCompartido } from './share-content.service.ts';
import { ServicioDeSesionesCompartidas } from './share-session.service.ts';
import {
  borrarCookieDeComparticion,
  emitirCookieDeComparticion,
  type PrincipalDeComparticion,
} from './share-principal.ts';
import {
  GuardDeSesionCompartida,
  RequiereOperacionCompartida,
  Visitante,
  rechazarCodigoEnLaUrl,
} from './share-session.guard.ts';
import { AccesoCompartidoInvalido } from './sharing.errors.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * SUPERFICIE PÚBLICA DE LA COMPARTICIÓN. Sin cuenta, sin sesión de usuario.
 *
 * Todas las rutas van marcadas `@Publico()` porque el `GuardDeSesion` global
 * exige sesión de usuario por defecto. Eso **no** las deja sin control: las de
 * contenido pasan por `GuardDeSesionCompartida`, que es más estricto que el
 * guard de usuario (deniega si falta el decorador de operación).
 *
 * El `GuardCsrf` global **sigue aplicando** a los POST de aquí, y es correcto:
 * un tercero no debe poder forzar desde otro sitio que el navegador de la
 * víctima canjee un código o cierre su sesión de compartición. La página de
 * acceso obtiene el testigo en el `GET /share/:slug`, que es donde el guard lo
 * acuña.
 *
 * ── Cabeceras de la página de acceso (C-CODE-05) ───────────────────────────
 * Cada respuesta lleva `Referrer-Policy: no-referrer` y `Cache-Control:
 * no-store`. La primera garantiza que, aunque alguien construya una URL con el
 * código dentro, el `Referer` no se lo lleve a ningún recurso externo; la
 * segunda evita que un proxy o el disco guarden la respuesta.
 * ════════════════════════════════════════════════════════════════════════════
 */
@Controller('share')
@Publico()
export class ControladorPublicoDeComparticion {
  constructor(
    private readonly acceso: ServicioDeAccesoCompartido,
    private readonly contenido: ServicioDeContenidoCompartido,
    private readonly sesiones: ServicioDeSesionesCompartidas,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  // -------------------------------------------------------------------------
  // Página de acceso
  // -------------------------------------------------------------------------

  /**
   * Estado de la página **sin exponer la colección** (§6). Devuelve lo mismo
   * para un enlace inexistente, revocado o caducado que para uno privado vivo:
   * `code_required`. No se puede enumerar slugs desde aquí.
   */
  @Get(':slug')
  async estado(
    @Param('slug') slug: string,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ estado: string }> {
    rechazarCodigoEnLaUrl(peticion);
    cabecerasDeLaPaginaDeAcceso(respuesta);
    if (!esSlugAdmisible(slug)) return { estado: 'code_required' };
    return { estado: await this.acceso.estadoDeLaPagina(slug) };
  }

  /**
   * Canjea el código por una **sesión de compartición con estado**.
   *
   * El código viaja **sólo aquí**, en el cuerpo de un POST. Nunca en la URL,
   * nunca en un GET, nunca en una cabecera.
   */
  @Post(':slug/access')
  @HttpCode(200)
  async acceder(
    @Param('slug') slug: string,
    @Body(new PipeZod(esquemaAcceder)) cuerpo: z.infer<typeof esquemaAcceder>,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ permission: string; expiresAt: string; collectionName: string | null }> {
    rechazarCodigoEnLaUrl(peticion);
    cabecerasDeLaPaginaDeAcceso(respuesta);

    // Un slug con forma inadmisible NO se ataja: se manda igualmente al
    // servicio, que paga el señuelo y el piso de tiempo. Devolver 400 aquí
    // sería un oráculo de forma, barato de explotar.
    const concedido = await this.acceso.acceder(esSlugAdmisible(slug) ? slug : '', cuerpo.code, {
      ip: peticion.ip ?? '0.0.0.0',
      userAgent: cabecera(peticion, 'user-agent'),
      usuarioAutenticadoId: usuarioDe(peticion),
    });

    emitirCookieDeComparticion(
      respuesta,
      this.config,
      concedido.sesion.valorCookie,
      concedido.sesion.expiraEn,
      this.reloj.ahora(),
    );

    return {
      permission: concedido.sesion.permiso,
      expiresAt: concedido.sesion.expiraEn.toISOString(),
      collectionName: null,
    };
  }

  // -------------------------------------------------------------------------
  // Sesión de compartición
  // -------------------------------------------------------------------------

  @Get('session/me')
  @UseGuards(GuardDeSesionCompartida)
  @RequiereOperacionCompartida('leer_coleccion')
  sesionActual(@Visitante() visitante: PrincipalDeComparticion | undefined): {
    permission: string;
    expiresAt: string;
    canExport: boolean;
    canExecute: boolean;
  } {
    if (visitante === undefined) throw new AccesoCompartidoInvalido();
    return {
      permission: visitante.permiso,
      expiresAt: visitante.expiraEn.toISOString(),
      canExport: visitante.permiteExportar,
      canExecute: visitante.permiteEjecutar,
    };
  }

  @Post('session/logout')
  @HttpCode(204)
  @UseGuards(GuardDeSesionCompartida)
  @RequiereOperacionCompartida('leer_coleccion')
  async cerrarSesion(
    @Visitante() visitante: PrincipalDeComparticion | undefined,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<void> {
    if (visitante === undefined) throw new AccesoCompartidoInvalido();
    await this.sesiones.cerrar(visitante.sesionId, 'logout');
    borrarCookieDeComparticion(respuesta, this.config);
  }

  // -------------------------------------------------------------------------
  // Contenido. La colección sale de la SESIÓN, no de la URL.
  // -------------------------------------------------------------------------

  @Get('content/collection')
  @UseGuards(GuardDeSesionCompartida)
  @RequiereOperacionCompartida('leer_coleccion')
  async coleccion(
    @Visitante() visitante: PrincipalDeComparticion | undefined,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ collection: unknown }> {
    if (visitante === undefined) throw new AccesoCompartidoInvalido();
    cabecerasDeLaPaginaDeAcceso(respuesta);
    return { collection: await this.contenido.coleccion(visitante) };
  }

  @Get('content/requests/:requestId')
  @UseGuards(GuardDeSesionCompartida)
  @RequiereOperacionCompartida('leer_solicitud')
  async solicitud(
    @Visitante() visitante: PrincipalDeComparticion | undefined,
    @Param('requestId') requestId: string,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ request: unknown }> {
    if (visitante === undefined) throw new AccesoCompartidoInvalido();
    cabecerasDeLaPaginaDeAcceso(respuesta);
    return { request: await this.contenido.solicitud(visitante, requestId) };
  }

  @Get('content/export')
  @UseGuards(GuardDeSesionCompartida)
  @RequiereOperacionCompartida('exportar')
  async exportar(
    @Visitante() visitante: PrincipalDeComparticion | undefined,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<Record<string, unknown>> {
    if (visitante === undefined) throw new AccesoCompartidoInvalido();
    cabecerasDeLaPaginaDeAcceso(respuesta);
    return this.contenido.exportar(visitante);
  }
}

function cabecerasDeLaPaginaDeAcceso(respuesta: RespuestaHttp): void {
  respuesta.header('Referrer-Policy', 'no-referrer');
  respuesta.header('Cache-Control', 'no-store');
}

/**
 * Identidad del visitante **si además tiene sesión de usuario**. Sólo alimenta
 * `share_access_attempts.authenticated_user_id`: no concede nada, y en
 * particular no sustituye al código. Una sesión de usuario no abre un enlace
 * privado por sí sola.
 */
function usuarioDe(peticion: PeticionHttp): string | null {
  const principal = (peticion as Record<string, unknown>)[CLAVE_PRINCIPAL] as
    | Principal
    | undefined;
  return principal?.usuarioId ?? null;
}
