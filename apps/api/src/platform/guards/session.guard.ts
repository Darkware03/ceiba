import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../config/app-config.ts';
import { META_PUBLICO } from '../auth/decorators.ts';
import { CLAVE_PRINCIPAL, type ContextoDePeticion } from '../auth/principal.ts';
import { PUERTO_DE_SESION, type PuertoDeSesion } from '../auth/ports.ts';
import { emitirCookieDeSesion } from '../auth/cookies.ts';
import { RELOJ, type Reloj } from '../time/clock.ts';
import { cabecera, type PeticionHttp, type RespuestaHttp } from '../http/http-types.ts';

/**
 * Exige sesión válida en **todas** las rutas salvo las marcadas `@Publico()`.
 *
 * Denegar por defecto es la mitad del control; la otra mitad es que se pueda
 * **enumerar** qué rutas están marcadas públicas, cosa que hace
 * `test/route-inventory.test.ts` recorriendo el inventario de rutas.
 *
 * Si la validación rota la sesión (ADR-0009 §4), el guard emite la cookie nueva
 * en esta misma respuesta: la rotación es transparente para el cliente.
 */
@Injectable()
export class GuardDeSesion implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
    @Inject(PUERTO_DE_SESION) private readonly sesiones: PuertoDeSesion,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;

    const esPublico = this.reflector.getAllAndOverride<boolean>(META_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (esPublico === true) return true;

    const http = contexto.switchToHttp();
    const peticion = http.getRequest<PeticionHttp>();
    const respuesta = http.getResponse<RespuestaHttp>();

    const contextoPeticion: ContextoDePeticion = {
      ip: peticion.ip ?? '0.0.0.0',
      userAgent: cabecera(peticion, 'user-agent'),
    };

    const resultado = await this.sesiones.validar(
      peticion.cookies?.[this.config.cookies.nombreSesion],
      contextoPeticion,
    );

    (peticion as Record<string, unknown>)[CLAVE_PRINCIPAL] = resultado.principal;

    if (resultado.cookieNueva !== undefined) {
      emitirCookieDeSesion(
        respuesta,
        this.config,
        resultado.cookieNueva.valor,
        resultado.cookieNueva.expiraEn,
        this.reloj.ahora(),
      );
    }
    return true;
  }
}
