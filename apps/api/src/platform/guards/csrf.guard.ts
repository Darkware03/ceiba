import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { CONFIGURACION_APP, NOMBRE_CABECERA_CSRF, type ConfiguracionApp } from '../config/app-config.ts';
import { TESTIGO_CSRF, TestigoCsrf, comparacionConstante } from '../csrf/csrf-token.ts';
import { CsrfInvalido } from '../errors/domain-errors.ts';
import { emitirCookieCsrf } from '../auth/cookies.ts';
import {
  cabecera,
  esMetodoMutante,
  type PeticionHttp,
  type RespuestaHttp,
} from '../http/http-types.ts';

/**
 * CSRF **siempre activo**, no «cuando corresponda» (ADR-0009 §5 y decisión C-31).
 *
 * Tres barreras, y aquí se aplican la 2 y la 3 (la 1, `SameSite=Lax`, la aplica
 * el navegador al emitir la cookie):
 *
 *   2. **Doble envío firmado.** `__Host-ceiba_csrf` (legible por la SPA) debe
 *      coincidir con la cabecera `x-ceiba-csrf`, y el valor debe llevar una
 *      firma HMAC válida. Un atacante entre sitios puede hacer que el navegador
 *      mande la cookie, pero no puede leerla y por tanto no puede poner la
 *      cabecera.
 *   3. **`Origin`/`Referer`.** Debe coincidir con `CEIBA_PUBLIC_URL`. Si no
 *      llega ninguna de las dos, **se deniega**. Falla CERRADO.
 *
 * ALCANCE: `POST`, `PUT`, `PATCH` y `DELETE`, **sin excepciones**, incluido
 * `POST /auth/login` (el *login CSRF* es real: fija la sesión del atacante en
 * el navegador de la víctima). No hay decorador para saltárselo: no existe
 * `@SinCsrf`, a propósito.
 *
 * En los métodos seguros el guard **acuña** la cookie CSRF si falta, que es de
 * donde sale el testigo del primer POST (§5).
 */
@Injectable()
export class GuardCsrf implements CanActivate {
  constructor(
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
    @Inject(TESTIGO_CSRF) private readonly testigos: TestigoCsrf,
  ) {}

  canActivate(contexto: ExecutionContext): boolean {
    if (contexto.getType() !== 'http') return true;

    const http = contexto.switchToHttp();
    const peticion = http.getRequest<PeticionHttp>();
    const respuesta = http.getResponse<RespuestaHttp>();

    if (!esMetodoMutante(peticion.method)) {
      this.#acunarSiFalta(peticion, respuesta);
      return true;
    }

    this.#comprobarOrigen(peticion);
    this.#comprobarDobleEnvio(peticion);
    return true;
  }

  /** Barrera 3. Sin `Origin` ni `Referer` utilizables, se deniega. */
  #comprobarOrigen(peticion: PeticionHttp): void {
    const origen = cabecera(peticion, 'origin');
    if (typeof origen === 'string' && origen.length > 0 && origen !== 'null') {
      if (origen !== this.config.origenPublico) {
        throw new CsrfInvalido('Origen no permitido.');
      }
      return;
    }

    const referer = cabecera(peticion, 'referer');
    if (typeof referer === 'string' && referer.length > 0) {
      let origenDelReferer: string;
      try {
        origenDelReferer = new URL(referer).origin;
      } catch {
        throw new CsrfInvalido('Origen no permitido.');
      }
      if (origenDelReferer !== this.config.origenPublico) {
        throw new CsrfInvalido('Origen no permitido.');
      }
      return;
    }

    // Ni Origin ni Referer: fallo CERRADO.
    throw new CsrfInvalido('Falta la cabecera Origin o Referer en una operación mutante.');
  }

  /** Barrera 2. */
  #comprobarDobleEnvio(peticion: PeticionHttp): void {
    const deLaCookie = peticion.cookies?.[this.config.cookies.nombreCsrf];
    const deLaCabecera = cabecera(peticion, NOMBRE_CABECERA_CSRF);

    if (typeof deLaCookie !== 'string' || deLaCookie.length === 0) {
      throw new CsrfInvalido('Falta el testigo CSRF.');
    }
    if (typeof deLaCabecera !== 'string' || deLaCabecera.length === 0) {
      throw new CsrfInvalido('Falta el testigo CSRF.');
    }
    if (!comparacionConstante(deLaCookie, deLaCabecera)) {
      throw new CsrfInvalido('Testigo CSRF no coincidente.');
    }
    if (!this.testigos.esValido(deLaCookie)) {
      throw new CsrfInvalido('Testigo CSRF no válido.');
    }
  }

  #acunarSiFalta(peticion: PeticionHttp, respuesta: RespuestaHttp): void {
    const actual = peticion.cookies?.[this.config.cookies.nombreCsrf];
    if (typeof actual === 'string' && this.testigos.esValido(actual)) return;
    emitirCookieCsrf(respuesta, this.config, this.testigos.acunar());
  }
}
