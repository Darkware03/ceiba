import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../../platform/config/app-config.ts';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { Publico, Usuario } from '../../platform/auth/decorators.ts';
import type { Principal } from '../../platform/auth/principal.ts';
import {
  borrarCookieDeSesion,
  emitirCookieCsrf,
  emitirCookieDeSesion,
} from '../../platform/auth/cookies.ts';
import { TESTIGO_CSRF, TestigoCsrf } from '../../platform/csrf/csrf-token.ts';
import { NoAutenticado, RecursoNoEncontrado } from '../../platform/errors/domain-errors.ts';
import { PipeZod } from '../../platform/validation/zod.pipe.ts';
import { cabecera, type PeticionHttp, type RespuestaHttp } from '../../platform/http/http-types.ts';
import { ServicioDeIdentidad } from './identity.service.ts';
import { ServicioDeSesiones } from './session.service.ts';
import {
  esquemaCambioDeContrasena,
  esquemaInicioDeSesion,
  esquemaRegistro,
  esquemaVerificacionMfa,
  type EntradaDeCambioDeContrasena,
  type EntradaDeInicioDeSesion,
  type EntradaDeRegistro,
  type EntradaDeVerificacionMfa,
} from './dto/identity.dto.ts';

/**
 * Familia «Autenticación» de la §19 del prompt maestro, bajo `/api/v1/auth`.
 *
 * Nada aquí lleva `@Publico()` por comodidad: sólo lo llevan las cuatro rutas
 * que **tienen** que funcionar sin sesión (acuñar CSRF, registro, inicio y
 * segundo factor). Todo lo demás exige sesión por omisión, y
 * `test/route-inventory.test.ts` lo comprueba recorriendo las rutas.
 *
 * El CSRF lo aplica el guard global **también** a `/auth/login`: el *login
 * CSRF* es real (fija la sesión del atacante en el navegador de la víctima).
 */
@Controller('auth')
export class ControladorDeIdentidad {
  constructor(
    private readonly identidad: ServicioDeIdentidad,
    private readonly sesiones: ServicioDeSesiones,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(TESTIGO_CSRF) private readonly testigos: TestigoCsrf,
  ) {}

  // -------------------------------------------------------------------------

  /**
   * Acuña la cookie CSRF **sin sesión**. Es el endpoint explícito del
   * ADR-0009 §5 para que la SPA tenga testigo antes de su primer envío.
   */
  @Publico()
  @Get('csrf')
  obtenerCsrf(@Res({ passthrough: true }) respuesta: RespuestaHttp): { csrfToken: string } {
    const testigo = this.testigos.acunar();
    emitirCookieCsrf(respuesta, this.config, testigo);
    return { csrfToken: testigo };
  }

  @Publico()
  @Post('register')
  @HttpCode(201)
  async registrar(
    @Body(new PipeZod(esquemaRegistro)) cuerpo: EntradaDeRegistro,
    @Req() peticion: PeticionHttp,
  ): Promise<{ usuario: unknown }> {
    const perfil = await this.identidad.registrar(
      cuerpo.email,
      cuerpo.password,
      cuerpo.displayName,
      contextoDe(peticion),
    );
    return { usuario: perfil };
  }

  @Publico()
  @Post('login')
  @HttpCode(200)
  async iniciarSesion(
    @Body(new PipeZod(esquemaInicioDeSesion)) cuerpo: EntradaDeInicioDeSesion,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<unknown> {
    const resultado = await this.identidad.iniciarSesion(
      cuerpo.email,
      cuerpo.password,
      contextoDe(peticion),
    );
    return this.#responderInicio(resultado, respuesta);
  }

  @Publico()
  @Post('mfa/verify')
  @HttpCode(200)
  async verificarMfa(
    @Body(new PipeZod(esquemaVerificacionMfa)) cuerpo: EntradaDeVerificacionMfa,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<unknown> {
    const resultado = await this.identidad.verificarSegundoFactor(
      cuerpo.retoId,
      cuerpo.retoTestigo,
      cuerpo.codigo,
      contextoDe(peticion),
    );
    return this.#responderInicio(resultado, respuesta);
  }

  // -------------------------------------------------------------------------

  @Get('me')
  async yo(@Usuario() principal: Principal): Promise<{ usuario: unknown }> {
    const perfil = await this.identidad.perfilDe(principal.usuarioId);
    if (perfil === null) throw new NoAutenticado('usuario_inexistente');
    return { usuario: perfil };
  }

  /**
   * Refresco **explícito** con rotación. La rotación también ocurre sola cada
   * `CEIBA_SESSION_ROTATE_AFTER` dentro del guard; este endpoint existe para
   * que el cliente la pueda forzar (por ejemplo al volver de segundo plano).
   */
  @Post('refresh')
  @HttpCode(200)
  async refrescar(
    @Usuario() principal: Principal,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ rotada: true; expiraEn: string }> {
    const actual = await this.sesiones.buscarPorId(principal.sesionId);
    if (actual === null) throw new NoAutenticado('sesion_inexistente');
    const rotada = await this.sesiones.rotar(actual, contextoDe(peticion), 'rotated');
    emitirCookieDeSesion(
      respuesta,
      this.config,
      rotada.cookie.valor,
      rotada.cookie.expiraEn,
      this.reloj.ahora(),
    );
    return { rotada: true, expiraEn: rotada.cookie.expiraEn.toISOString() };
  }

  @Post('logout')
  @HttpCode(204)
  async cerrarSesion(
    @Usuario() principal: Principal,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<void> {
    await this.sesiones.cerrar(principal.sesionId, principal.usuarioId, contextoDe(peticion).ip);
    borrarCookieDeSesion(respuesta, this.config);
  }

  @Post('sessions/revoke-all')
  @HttpCode(200)
  async cerrarTodas(
    @Usuario() principal: Principal,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ revocadas: number }> {
    const revocadas = await this.sesiones.cerrarTodas(
      principal.usuarioId,
      contextoDe(peticion).ip,
    );
    borrarCookieDeSesion(respuesta, this.config);
    return { revocadas };
  }

  @Get('sessions')
  async listarSesiones(@Usuario() principal: Principal): Promise<{ sesiones: unknown[] }> {
    const filas = await this.sesiones.listar(principal.usuarioId);
    // Se exponen los campos del §9 y NINGUNO del testigo: ni `tokenSelector`
    // ni `tokenVerifierHash` salen nunca de la API.
    return {
      sesiones: filas.map((fila) => ({
        id: fila.id,
        deviceLabel: fila.deviceLabel,
        userAgent: fila.userAgent,
        clientIp: fila.clientIp,
        lastSeenAt: fila.lastSeenAt.toISOString(),
        issuedAt: fila.issuedAt.toISOString(),
        esLaActual: fila.id === principal.sesionId,
      })),
    };
  }

  @Delete('sessions/:sesionId')
  @HttpCode(204)
  async cerrarUna(
    @Usuario() principal: Principal,
    @Param('sesionId') sesionId: string,
    @Req() peticion: PeticionHttp,
  ): Promise<void> {
    const cerrada = await this.sesiones.cerrarUna(
      sesionId,
      principal.usuarioId,
      contextoDe(peticion).ip,
    );
    // Si no es suya, 404: nunca se confirma que la sesión de otro exista.
    if (!cerrada) throw new RecursoNoEncontrado('Sesión no encontrada.');
  }

  @Post('password')
  @HttpCode(200)
  async cambiarContrasena(
    @Usuario() principal: Principal,
    @Body(new PipeZod(esquemaCambioDeContrasena)) cuerpo: EntradaDeCambioDeContrasena,
    @Req() peticion: PeticionHttp,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ): Promise<{ sesionesRevocadas: 'todas_menos_la_actual' }> {
    const rotada = await this.identidad.cambiarContrasena(
      principal.usuarioId,
      principal.sesionId,
      cuerpo.contrasenaActual,
      cuerpo.contrasenaNueva,
      contextoDe(peticion),
    );
    emitirCookieDeSesion(
      respuesta,
      this.config,
      rotada.cookie.valor,
      rotada.cookie.expiraEn,
      this.reloj.ahora(),
    );
    return { sesionesRevocadas: 'todas_menos_la_actual' };
  }

  // -------------------------------------------------------------------------

  #responderInicio(
    resultado: Awaited<ReturnType<ServicioDeIdentidad['iniciarSesion']>>,
    respuesta: RespuestaHttp,
  ): unknown {
    if (resultado.tipo === 'mfa_requerido') {
      return {
        mfaRequerido: true,
        retoId: resultado.retoId,
        retoTestigo: resultado.retoTestigo,
        expiraEn: resultado.expiraEn.toISOString(),
      };
    }
    emitirCookieDeSesion(
      respuesta,
      this.config,
      resultado.sesion.cookie.valor,
      resultado.sesion.cookie.expiraEn,
      this.reloj.ahora(),
    );
    // §5: el testigo CSRF se ROTA al iniciar sesión, para que el previo a la
    // autenticación no siga siendo válido después.
    emitirCookieCsrf(respuesta, this.config, this.testigos.acunar());
    return { usuario: resultado.perfil };
  }
}

function contextoDe(peticion: PeticionHttp): { ip: string; userAgent: string | undefined } {
  return { ip: peticion.ip ?? '0.0.0.0', userAgent: cabecera(peticion, 'user-agent') };
}
